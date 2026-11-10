// Compact storage for the mirror index (PERF-07): each record's leaf name (<slug>--<sys_id>) as
// UTF-8 bytes in one arena, its other attributes in typed-array columns, and open-addressing
// tables that find a record by a hash of its bytes. Hashes and comparisons read the bytes in
// place: a typed-array view per call costs more than the work itself.

const EMPTY = 0;
const DELETED = -1;

// UTF-8 bytes of a lookup key, held in a shared buffer.
export interface Key {
  readonly bytes: Uint8Array;
  readonly length: number;
}

function fnv(bytes: Uint8Array, seed: number, start: number, end: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = start; index < end; index += 1) {
    hash = Math.imul(hash ^ (bytes[index] ?? 0), 16777619);
  }
  // Final mix, so that keys differing only in their last bytes spread across the table.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

export const hashKey = (key: Key, seed: number) => fnv(key.bytes, seed, 0, key.length);

function grown<T extends Uint8Array | Uint32Array>(
  column: T,
  size: number,
  make: (length: number) => T,
): T {
  if (size <= column.length) {
    return column;
  }
  const next = make(Math.max(size, Math.ceil(column.length * 1.5)));
  next.set(column);
  return next;
}

// Records in the order they were added. A removed record keeps its slot (and bytes) so that
// later records keep their order; a pull removes few.
export class RecordColumns {
  private arena = new Uint8Array(1 << 16);
  private used = 0;
  private start = new Uint32Array(1024);
  private length = new Uint32Array(1024);
  // Where the sys_id starts inside the leaf.
  private idStart = new Uint32Array(1024);
  private dir = new Uint32Array(1024);
  // Index of the record's suffix list; 0 is the empty list of a removed record.
  private list = new Uint32Array(1024);
  // Hashes of the base and of the sys_id, kept so that growing a table reads no bytes.
  private baseHash = new Uint32Array(1024);
  private idHash = new Uint32Array(1024);
  count = 0;

  push(
    dirId: number,
    leaf: Key,
    id: { readonly length: number; readonly hash: number },
    listId: number,
  ): number {
    const record = this.count;
    const size = record + 1;
    this.start = grown(this.start, size, (n) => new Uint32Array(n));
    this.length = grown(this.length, size, (n) => new Uint32Array(n));
    this.idStart = grown(this.idStart, size, (n) => new Uint32Array(n));
    this.dir = grown(this.dir, size, (n) => new Uint32Array(n));
    this.list = grown(this.list, size, (n) => new Uint32Array(n));
    this.baseHash = grown(this.baseHash, size, (n) => new Uint32Array(n));
    this.idHash = grown(this.idHash, size, (n) => new Uint32Array(n));
    this.arena = grown(this.arena, this.used + leaf.length, (n) => new Uint8Array(n));
    for (let index = 0; index < leaf.length; index += 1) {
      this.arena[this.used + index] = leaf.bytes[index] ?? 0;
    }
    this.start[record] = this.used;
    this.length[record] = leaf.length;
    this.idStart[record] = leaf.length - id.length;
    this.baseHash[record] = hashKey(leaf, dirId);
    this.idHash[record] = id.hash;
    this.dir[record] = dirId;
    this.list[record] = listId;
    this.used += leaf.length;
    this.count = size;
    return record;
  }

  leaf(record: number): Uint8Array {
    const start = this.start[record] ?? 0;
    return this.arena.subarray(start, start + (this.length[record] ?? 0));
  }

  // hashKey(leaf, dir) of the record.
  baseHashOf(record: number): number {
    return this.baseHash[record] ?? 0;
  }

  // hashKey(sys_id, 0) of the record.
  idHashOf(record: number): number {
    return this.idHash[record] ?? 0;
  }

  leafIs(record: number, key: Key): boolean {
    const start = this.start[record] ?? 0;
    return this.bytesAre(start, this.length[record] ?? 0, key.bytes, 0, key.length);
  }

  sysIdIs(record: number, key: Key): boolean {
    const start = this.sysIdStart(record);
    return this.bytesAre(start, this.sysIdLength(record), key.bytes, 0, key.length);
  }

  sameSysId(record: number, other: number): boolean {
    return this.bytesAre(
      this.sysIdStart(record),
      this.sysIdLength(record),
      this.arena,
      this.sysIdStart(other),
      this.sysIdLength(other),
    );
  }

  dirOf(record: number): number {
    return this.dir[record] ?? 0;
  }

  listOf(record: number): number {
    return this.list[record] ?? 0;
  }

  setList(record: number, listId: number): void {
    this.list[record] = listId;
  }

  private sysIdStart(record: number): number {
    return (this.start[record] ?? 0) + (this.idStart[record] ?? 0);
  }

  private sysIdLength(record: number): number {
    return (this.length[record] ?? 0) - (this.idStart[record] ?? 0);
  }

  private bytesAre(
    start: number,
    length: number,
    bytes: Uint8Array,
    from: number,
    size: number,
  ): boolean {
    if (length !== size) {
      return false;
    }
    for (let index = 0; index < length; index += 1) {
      if (this.arena[start + index] !== bytes[from + index]) {
        return false;
      }
    }
    return true;
  }
}

// Record numbers by hash, with linear probing; `matches` decides which record a key names.
export class RecordTable {
  private slots = new Int32Array(1024);
  private filled = 0;

  constructor(private readonly hashOf: (record: number) => number) {}

  find(hash: number, matches: (record: number) => boolean): number {
    const mask = this.slots.length - 1;
    for (let at = hash & mask; ; at = (at + 1) & mask) {
      const slot = this.slots[at] ?? EMPTY;
      if (slot === EMPTY) return -1;
      if (slot !== DELETED && matches(slot - 1)) return slot - 1;
    }
  }

  // Points the key at `record`, replacing the record it named before.
  set(hash: number, record: number, matches: (record: number) => boolean): void {
    this.delete(hash, matches);
    this.insert(hash, record);
  }

  // Adds a record no other record's key matches.
  insert(hash: number, record: number): void {
    if ((this.filled + 1) * 10 > this.slots.length * 7) {
      this.rehash();
    }
    const mask = this.slots.length - 1;
    let at = hash & mask;
    while ((this.slots[at] ?? EMPTY) > 0) at = (at + 1) & mask;
    if (this.slots[at] === EMPTY) this.filled += 1;
    this.slots[at] = record + 1;
  }

  delete(hash: number, matches: (record: number) => boolean): void {
    const mask = this.slots.length - 1;
    for (let at = hash & mask; ; at = (at + 1) & mask) {
      const slot = this.slots[at] ?? EMPTY;
      if (slot === EMPTY) return;
      if (slot !== DELETED && matches(slot - 1)) {
        this.slots[at] = DELETED;
        return;
      }
    }
  }

  private rehash(): void {
    const old = this.slots;
    let live = 0;
    for (let at = 0; at < old.length; at += 1) if ((old[at] ?? EMPTY) > 0) live += 1;
    let size = 1024;
    while (size < (live + 1) * 2) size *= 2;
    this.slots = new Int32Array(size);
    this.filled = 0;
    const mask = size - 1;
    for (let from = 0; from < old.length; from += 1) {
      const slot = old[from] ?? EMPTY;
      if (slot <= 0) continue;
      let at = this.hashOf(slot - 1) & mask;
      while ((this.slots[at] ?? EMPTY) !== EMPTY) at = (at + 1) & mask;
      this.slots[at] = slot;
      this.filled += 1;
    }
  }
}
