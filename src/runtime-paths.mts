import { fileURLToPath } from 'node:url';

declare const __GOG_DISTRIBUTION__: boolean | undefined;

export function distributionRuntime() {
  return typeof __GOG_DISTRIBUTION__ !== 'undefined' && __GOG_DISTRIBUTION__;
}

export function sourceHelperPath(name: string) {
  // Emitted modules mirror the repository under .build/typescript/src/.
  const root = distributionRuntime() ? '../' : '../../../';
  return fileURLToPath(new URL(`${root}native/bin/${name}`, import.meta.url));
}
