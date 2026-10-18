export interface FetchOptions extends RequestInit {
  headers: Record<string, string>;
}

export type FetchImpl = (url: string, options: FetchOptions) => Promise<Response>;
