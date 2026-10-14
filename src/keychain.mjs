import { spawn } from 'node:child_process';
import { GogError } from './errors.mjs';

export async function runProcess(command, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', part => {
      stdout += part;
      if (stdout.length > 128_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', () => {}); // Never relay credential prompts or process errors.
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new GogError('PROCESS_FAILED', 'Cannot start the required Mac command.', 7)); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout }); });
    child.stdin.end(input);
  });
}

export class MacKeychain {
  constructor({ service = 'gog-achievements-cli', account = 'default', createEntry, platform = process.platform } = {}) {
    this.service = service;
    this.account = account;
    this.platform = platform;
    this.createEntry = createEntry ?? (async () => {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return new AsyncEntry(this.service, this.account);
    });
    this.entry = null;
  }

  async invoke(method, ...values) {
    if (this.platform !== 'darwin') throw new GogError('MAC_REQUIRED', 'This version stores login details in the Mac Keychain.', 7);
    try {
      this.entry ??= await this.createEntry();
      return await this.entry[method](...values, AbortSignal.timeout(5000));
    } catch {
      throw new GogError('KEYCHAIN_UNAVAILABLE', 'Cannot access the Mac Keychain. Unlock your login Keychain and retry from Terminal.', 7);
    }
  }

  async get() {
    const secret = await this.invoke('getPassword');
    if (secret === null) return null;
    try { return JSON.parse(secret); }
    catch { throw new GogError('INVALID_CREDENTIALS', 'The saved login data is not valid. Sign in again.', 3); }
  }

  async set(session) {
    const secret = JSON.stringify(session);
    // Native Keychain calls support full token lengths. Neither shell arguments
    // nor the security command's bounded password prompt are involved.
    await this.invoke('setPassword', secret);
    if (await this.invoke('getPassword') !== secret) {
      throw new GogError('KEYCHAIN_STORE_FAILED', 'The saved login data did not match. Sign in again.', 7);
    }
  }

  async remove() {
    await this.invoke('deleteCredential');
  }
}
