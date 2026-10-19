export class AssetBytes {
  private readonly values = new Map<string, Uint8Array>();

  constructor(entries: Iterable<readonly [string, Uint8Array]> = []) {
    for (const [id, bytes] of entries) this.set(id, bytes);
  }

  get(id: string): Uint8Array | undefined {
    const bytes = this.values.get(id);
    return bytes?.slice();
  }

  set(id: string, bytes: Uint8Array): void {
    this.values.set(id, bytes.slice());
  }

  ids(): string[] { return [...this.values.keys()]; }
  delete(id: string): void { this.values.delete(id); }
  clear(): void { this.values.clear(); }
  clone(): AssetBytes { return new AssetBytes(this.values); }
}
