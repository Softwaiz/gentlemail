declare module "*?url" {
  const result: string;
  export default result;
}

/** Worker name from wrangler.jsonc, injected at build time (vite.config.mts). */
declare const __WORKER_NAME__: string;

/** GentleMail release from package.json ("0.3.0"), injected at build time. */
declare const __APP_VERSION__: string;
