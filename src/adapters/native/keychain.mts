import type {
  ProcessRunner,
  CredentialOptions,
  CredentialVault,
} from '../../application/ports.mjs';

import { fields } from '../../domain/objects.mjs';
export interface VaultOptions {
  platform?: string;
  execute?: ProcessRunner;
  helperPath?: string | (() => string);
  service?: string;
  account?: string;
}
import { GogError } from '../../domain/errors.mjs';
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
  platform: 'darwin' | 'win32';
  profile: (typeof PROFILES)['darwin' | 'win32'];
  storage: string;
  execute: ProcessRunner;
  helperPath: string | (() => string);
  keychainIdentity: { service: string; account: string };
  constructor(
    platform: 'darwin' | 'win32',
    {
      execute = runProcess,
      helperPath = () => nativeHelperPath(platform),
      service = 'gog-achievements-cli',
      account = 'default',
    }: VaultOptions = {},
  ) {
    this.platform = platform;
    this.profile = PROFILES[platform];
    this.storage = this.profile.storage;
    this.execute = execute;
    this.helperPath = helperPath;
    this.keychainIdentity = { service, account };
  }

  async invoke(
    action: 'get' | 'set' | 'remove',
    secret?: string,
    { interactive = false, signal }: CredentialOptions = {},
  ) {
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
      const decoded: unknown = JSON.parse(result.stdout);
      const event = fields(decoded);
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
      const decoded: unknown = JSON.parse(secret);
      return decoded;
    } catch {
      throw new GogError(
        'INVALID_CREDENTIALS',
        'The saved login data is not valid. Sign in again.',
        3,
      );
    }
  }

  async set(session: unknown, { interactive = false, signal }: CredentialOptions = {}) {
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
  constructor(options: VaultOptions = {}) {
    super('darwin', options);
  }
}

export class WindowsVault extends NativeVault {
  constructor(options: VaultOptions = {}) {
    super('win32', options);
  }
}

export function credentialVault(
  options: VaultOptions & { platform?: string } = {},
): CredentialVault {
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return new MacKeychain(options);
  if (platform === 'win32') return new WindowsVault(options);
  const unavailable = () =>
    Promise.reject(
      new GogError('UNSUPPORTED_PLATFORM', 'This tool supports macOS and Windows.', 7),
    );
  return { storage: 'unsupported', get: unavailable, set: unavailable, remove: unavailable };
}
