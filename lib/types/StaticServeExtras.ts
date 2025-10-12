export interface StaticServeExtras {
  precompressed?: boolean;
  mimes?: Record<string, string>;
  cacheControl?: string;
  headers?: Record<string, string>;
}
