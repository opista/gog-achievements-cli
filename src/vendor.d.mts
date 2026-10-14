// postject has no bundled declarations. This is the API used by our build.
declare module 'postject' {
  export function inject(
    filename: string,
    resourceName: string,
    resource: Uint8Array,
    options: {
      sentinelFuse: string;
      machoSegmentName?: string;
    },
  ): Promise<void>;
}
