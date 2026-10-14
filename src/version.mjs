import packageData from '../package.json' with { type: 'json' };

export const VERSION = packageData.version;
