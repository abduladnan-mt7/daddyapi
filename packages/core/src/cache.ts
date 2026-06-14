import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CacheEntry {
  body: string;
  finalUrl: string;
  storedAt: number;
}

export interface Cache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

/** In-process cache. Fast, ephemeral, the default. */
export class MemoryCache implements Cache {
  private store = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.store.get(key);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.store.set(key, entry);
  }
}

/** Disk-backed cache so repeated runs of the CLI don't re-hit the site. */
export class FileCache implements Cache {
  constructor(private dir: string) {}

  private file(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.dir, `${hash}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const raw = await readFile(this.file(key), 'utf8');
      return JSON.parse(raw) as CacheEntry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify(entry), 'utf8');
  }
}
