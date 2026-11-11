/*
 * A ZIP archive with stored (uncompressed) entries: enough to hand over a folder of images, which
 * are compressed already, without a dependency. Names are UTF-8.
 */

let table: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const entries = files.map((f) => ({ name: enc.encode(f.name), data: f.data, crc: crc32(f.data) }));
  const size = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length + 46 + e.name.length, 22);
  const out = new Uint8Array(new ArrayBuffer(size));
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  const header = (sig: number, e: (typeof entries)[number], central: boolean, offset: number) => {
    view.setUint32(at, sig, true); at += 4;
    if (central) { view.setUint16(at, 20, true); at += 2; }
    view.setUint16(at, 20, true); at += 2;          // version needed
    view.setUint16(at, 0x0800, true); at += 2;      // UTF-8 names
    view.setUint16(at, 0, true); at += 2;           // stored
    view.setUint16(at, 0, true); at += 2;           // time
    view.setUint16(at, 0x21, true); at += 2;        // date: 1980-01-01
    view.setUint32(at, e.crc, true); at += 4;
    view.setUint32(at, e.data.length, true); at += 4;
    view.setUint32(at, e.data.length, true); at += 4;
    view.setUint16(at, e.name.length, true); at += 2;
    view.setUint16(at, 0, true); at += 2;           // extra
    if (central) {
      view.setUint16(at, 0, true); at += 2;         // comment
      view.setUint16(at, 0, true); at += 2;         // disk
      view.setUint16(at, 0, true); at += 2;         // internal attributes
      view.setUint32(at, 0, true); at += 4;         // external attributes
      view.setUint32(at, offset, true); at += 4;
    }
    out.set(e.name, at); at += e.name.length;
  };
  for (const e of entries) {
    offsets.push(at);
    header(0x04034b50, e, false, 0);
    out.set(e.data, at); at += e.data.length;
  }
  const start = at;
  entries.forEach((e, i) => header(0x02014b50, e, true, offsets[i]));
  const length = at - start;
  view.setUint32(at, 0x06054b50, true); at += 4;
  view.setUint16(at, 0, true); at += 2;
  view.setUint16(at, 0, true); at += 2;
  view.setUint16(at, entries.length, true); at += 2;
  view.setUint16(at, entries.length, true); at += 2;
  view.setUint32(at, length, true); at += 4;
  view.setUint32(at, start, true); at += 4;
  view.setUint16(at, 0, true);
  return out;
}
