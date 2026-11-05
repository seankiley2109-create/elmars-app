/**
 * An in-memory FileSystemDirectoryHandle, for testing the vault storage adapter without a browser.
 *
 * Implements only what lib/vault-fs.ts actually calls. `writes` counts createWritable() calls, which
 * is how the content-diffing test proves that one edit touches one file.
 */

export class MemFs {
  writes: string[] = [];
  removals: string[] = [];

  root(): FileSystemDirectoryHandle {
    return new MemDir(this, '') as unknown as FileSystemDirectoryHandle;
  }

  private tree = new Map<string, string>();

  get files(): Map<string, string> {
    return this.tree;
  }

  set(path: string, content: string): void {
    this.tree.set(path, content);
  }
}

class MemFile {
  kind = 'file' as const;
  constructor(
    private fs: MemFs,
    public name: string,
    private path: string,
  ) {}

  async getFile() {
    const content = this.fs.files.get(this.path) ?? '';
    return {
      text: async () => content,
      arrayBuffer: async () => new TextEncoder().encode(content).buffer,
      type: '',
    };
  }

  async createWritable() {
    this.fs.writes.push(this.path);
    return {
      write: async (data: unknown) => {
        this.fs.set(this.path, typeof data === 'string' ? data : String(data));
      },
      close: async () => {},
    };
  }
}

class MemDir {
  kind = 'directory' as const;
  constructor(
    private fs: MemFs,
    public name: string,
    private path = '',
  ) {}

  private child(name: string): string {
    return this.path ? `${this.path}/${name}` : name;
  }

  private dirExists(prefix: string): boolean {
    for (const p of this.fs.files.keys()) if (p.startsWith(`${prefix}/`)) return true;
    return false;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    const path = this.child(name);
    if (!opts?.create && !this.dirExists(path)) throw new DOMException('NotFoundError');
    return new MemDir(this.fs, name, path);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    const path = this.child(name);
    if (!opts?.create && !this.fs.files.has(path)) throw new DOMException('NotFoundError');
    return new MemFile(this.fs, name, path);
  }

  async removeEntry(name: string): Promise<void> {
    const path = this.child(name);
    if (!this.fs.files.has(path)) throw new DOMException('NotFoundError');
    this.fs.removals.push(path);
    this.fs.files.delete(path);
  }

  async *entries(): AsyncIterableIterator<[string, unknown]> {
    const prefix = this.path ? `${this.path}/` : '';
    const seen = new Set<string>();
    for (const p of [...this.fs.files.keys()]) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (seen.has(name)) continue;
      seen.add(name);
      yield [name, slash === -1 ? new MemFile(this.fs, name, p) : new MemDir(this.fs, name, prefix + name)];
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for await (const [name] of this.entries()) yield name;
  }
}
