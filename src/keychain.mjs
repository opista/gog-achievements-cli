import { GogError } from './errors.mjs';
import { nativeHelperPath } from './assets.mjs';
import { runProcess } from './process.mjs';
export { runProcess } from './process.mjs';

const BACKGROUND_TIMEOUT_MS = 5000;
const KEYCHAIN_APPROVAL_TIMEOUT_MS = 30000;
const PROFILES = {
  darwin: {
    storage: 'macos_keychain',
    unavailable: 'KEYCHAIN_UNAVAILABLE',
    mismatch: 'KEYCHAIN_STORE_FAILED',
    message:
      'Cannot access the Mac Keychain. Unlock it, run auth login, and allow the GOG sign-in helper access when asked.',
  },
  win32: {
    storage: 'windows_dpapi',
    unavailable: 'CREDENTIAL_STORE_UNAVAILABLE',
    mismatch: 'CREDENTIAL_STORE_FAILED',
    message:
      'Cannot access the Windows protected login store. Run npm run build if using source, then retry from your Windows user account.',
  },
};

class NativeVault {
  constructor(
    platform,
    {
      execute = runProcess,
      helperPath = () => nativeHelperPath(platform),
      service = 'gog-achievements-cli',
      account = 'default',
    } = {},
  ) {
    this.platform = platform;
    this.profile = PROFILES[platform];
    this.storage = this.profile.storage;
    this.execute = execute;
    this.helperPath = helperPath;
    this.keychainIdentity = { service, account };
  }

  async invoke(action, secret, { interactive = false, signal } = {}) {
    try {
      const path = typeof this.helperPath === 'function' ? this.helperPath() : this.helperPath;
      const request = {
        action,
        ...(secret === undefined ? {} : { secret }),
        ...(this.platform === 'darwin' ? { ...this.keychainIdentity, interactive } : {}),
      };
      const timeoutMs =
        this.platform === 'darwin' && interactive
          ? KEYCHAIN_APPROVAL_TIMEOUT_MS
          : BACKGROUND_TIMEOUT_MS;
      const result = await this.execute(path, ['--vault'], JSON.stringify(request), {
        timeoutMs,
        signal,
      });
      const event = JSON.parse(result.stdout);
      if (result.code !== 0 || event?.type !== 'vault') throw new Error();
      return event;
    } catch {
      throw new GogError(this.profile.unavailable, this.profile.message, 7);
    }
  }

  async get() {
    const { secret } = await this.invoke('get');
    if (secret === null) return null;
    try {
      if (typeof secret !== 'string') throw new Error();
      return JSON.parse(secret);
    } catch {
      throw new GogError(
        'INVALID_CREDENTIALS',
        'The saved login data is not valid. Sign in again.',
        3,
      );
    }
  }

  async set(session, { interactive = false, signal } = {}) {
    const secret = JSON.stringify(session);
    const timeout = AbortSignal.timeout(
      this.platform === 'darwin' && interactive
        ? KEYCHAIN_APPROVAL_TIMEOUT_MS
        : BACKGROUND_TIMEOUT_MS,
    );
    const options = { interactive, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
    await this.invoke('set', secret, options);
    if ((await this.invoke('get', undefined, options)).secret !== secret) {
      throw new GogError(
        this.profile.mismatch,
        'The saved login data did not match. Sign in again.',
        7,
      );
    }
  }

  async remove() {
    await this.invoke('remove');
  }
}

export class MacKeychain extends NativeVault {
  constructor(options = {}) {
    super('darwin', options);
  }
}

export class WindowsVault extends NativeVault {
  constructor(options = {}) {
    super('win32', options);
  }
}

export function credentialVault(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return new MacKeychain(options);
  if (platform === 'win32') return new WindowsVault(options);
  const unavailable = async () => {
    throw new GogError('UNSUPPORTED_PLATFORM', 'This tool supports macOS and Windows.', 7);
  };
  return { storage: 'unsupported', get: unavailable, set: unavailable, remove: unavailable };
}
