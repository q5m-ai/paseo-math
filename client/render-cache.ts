import type { RenderInput, RenderOutput } from "../shared/render.js";

export type RenderCall = (input: RenderInput) => Promise<RenderOutput>;
export type CachedRender = RenderOutput | null;

type Entry = {
  promise: Promise<CachedRender>;
  result?: CachedRender;
  bytes: number;
  expires: number;
};

const MAX_ENTRIES = 128;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE = 4;
// A long proof can mount hundreds of formulas in one render. Keep the queue
// bounded, but large enough that valid formulas do not permanently fall back
// to source merely because the four RPC slots were busy during that mount.
const MAX_QUEUED = 512;
const entries = new Map<string, Entry>();
const queue: Array<() => void> = [];
let active = 0;
let bytes = 0;
let completed = 0;

export function renderKey(hostId: string, input: RenderInput): string {
  return JSON.stringify([hostId, input.expression, input.display, input.color]);
}

function remove(key: string, entry: Entry): void {
  entries.delete(key);
  if (entry.result !== undefined) {
    completed--;
    bytes -= entry.bytes;
  }
}

function get(key: string): Entry | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    remove(key, entry);
    return undefined;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry;
}

function trim(): void {
  for (const [key, entry] of entries) {
    if (completed <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    // Never evict in-flight work: remounts must share the same request.
    if (entry.result !== undefined) remove(key, entry);
  }
}

export function peekRender(key: string): CachedRender | undefined {
  return get(key)?.result;
}

export function requestRender(
  key: string,
  input: RenderInput,
  call: RenderCall,
): Promise<CachedRender> {
  const existing = get(key);
  if (existing) return existing.promise;
  if (active >= MAX_ACTIVE && queue.length >= MAX_QUEUED) {
    return Promise.resolve(null);
  }

  let resolve!: (result: CachedRender) => void;
  const entry: Entry = {
    promise: new Promise<CachedRender>((done) => {
      resolve = done;
    }),
    bytes: key.length * 2,
    expires: Infinity,
  };
  entries.set(key, entry);
  // Pending work has its own active/queue bounds, not completed-cache capacity.

  const run = () => {
    active++;
    // Catch synchronous host errors as well as transport rejections.
    Promise.resolve()
      .then(() => call(input))
      .then(
        (result) => finish(result),
        () => finish(null),
      );
  };
  const finish = (result: CachedRender) => {
    entry.result = result;
    // Offline failures are retryable; malformed TeX is deterministic.
    entry.expires = result === null ? Date.now() + 30_000 : Infinity;
    const added = result?.ok ? result.png.length * 2 : 0;
    entry.bytes += added;
    completed++;
    bytes += entry.bytes;
    active--;
    trim();
    resolve(result);
    queue.shift()?.();
  };
  if (active < MAX_ACTIVE) run();
  else queue.push(run);
  return entry.promise;
}
