import { setTimeout as delay } from 'node:timers/promises';
import { GogAPI } from './adapters/gog-api.mjs';
import { credentialVault } from './adapters/native/keychain.mjs';
import { AchievementService } from './application/service.mjs';
import type { ServiceDependencies } from './application/service.mjs';
export { validSession } from './application/session.mjs';
export class GogAchievements extends AchievementService {
  constructor({
    api = new GogAPI(),
    vault = credentialVault(),
    wait = delay,
    now = Date.now,
  }: Partial<ServiceDependencies> = {}) {
    super({ api, vault, wait, now });
  }
}
