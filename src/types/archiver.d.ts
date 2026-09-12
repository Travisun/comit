// archiver v8 is ESM-only with class exports; minimal surface we use.
declare module "archiver" {
  export class Archiver extends NodeJS.ReadWriteStream {
    directory(dirPath: string, dest?: string): this;
    file(path: string, dest?: string): this;
    append(source: NodeJS.ReadableStream | string, data?: { name?: string }): this;
    finalize(): Promise<void>;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "progress", listener: (data: unknown) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    pipe<T extends NodeJS.WritableStream>(target: T, options?: { end?: boolean }): T;
  }
  export class ZipArchive extends Archiver {
    constructor(options?: { zlib?: { level?: number }; store?: boolean; comment?: string });
  }
  export class TarArchive extends Archiver {
    constructor(options?: { gzip?: boolean; gzipOptions?: Record<string, unknown> });
  }
  export class JsonArchive extends Archiver {
    constructor(options?: Record<string, unknown>);
  }
  export { Archiver as default };
}
