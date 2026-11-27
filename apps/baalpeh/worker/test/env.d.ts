// `interface X extends import("…").Y` is not valid TypeScript (an interface can only extend a named type), so alias first.
type WorkerEnv = import("../env").Env;
type TestD1Migration = import("@cloudflare/vitest-plugin").D1Migration;

declare namespace Cloudflare {
  interface Env extends WorkerEnv {
    TEST_MIGRATIONS: TestD1Migration[];
  }
}

/** Vite's import.meta.glob (the worker tsconfig has no vite/client types); used by the scope grep test. */
interface ImportMeta {
  glob<T>(patterns: string | string[], options: { query?: string; import?: string; eager: true }): Record<string, T>;
}
