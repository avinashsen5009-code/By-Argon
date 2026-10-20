/**
 * Pure TypeScript deterministic ZIP archive packager & unpackager (Store Method 0 + CRC32)
 * for `.recipestudio` project files (JSON + binary asset/audio blobs zipped into a single archive).
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipArchive(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = entries.map((e) => {
    const nameBytes = encoder.encode(e.name);
    const crc = computeCrc32(e.data);
    return {
      nameBytes,
      data: e.data,
      crc,
      offset: 0,
    };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const item of prepared) {
    item.offset = localSize;
    localSize += 30 + item.nameBytes.length + item.data.length;
    centralSize += 46 + item.nameBytes.length;
  }

  const totalSize = localSize + centralSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let pos = 0;
  for (const item of prepared) {
    // Local file header signature (0x04034b50)
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // version needed
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 flag
    view.setUint16(pos + 8, 0, true); // compression method: 0 (Store)
    view.setUint16(pos + 10, 0, true); // mod time
    view.setUint16(pos + 12, 0x21, true); // mod date
    view.setUint32(pos + 14, item.crc, true);
    view.setUint32(pos + 18, item.data.length, true); // compressed size
    view.setUint32(pos + 22, item.data.length, true); // uncompressed size
    view.setUint16(pos + 26, item.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true); // extra field length
    pos += 30;
    out.set(item.nameBytes, pos);
    pos += item.nameBytes.length;
    out.set(item.data, pos);
    pos += item.data.length;
  }

  const centralDirOffset = pos;
  for (const item of prepared) {
    // Central directory file header signature (0x02014b50)
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true); // version made by
    view.setUint16(pos + 6, 20, true); // version needed
    view.setUint16(pos + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(pos + 10, 0, true); // compression method: 0 (Store)
    view.setUint16(pos + 12, 0, true); // mod time
    view.setUint16(pos + 14, 0x21, true); // mod date
    view.setUint32(pos + 16, item.crc, true);
    view.setUint32(pos + 20, item.data.length, true);
    view.setUint32(pos + 24, item.data.length, true);
    view.setUint16(pos + 28, item.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true); // extra field length
    view.setUint16(pos + 32, 0, true); // comment length
    view.setUint16(pos + 34, 0, true); // disk number
    view.setUint16(pos + 36, 0, true); // internal attrs
    view.setUint32(pos + 38, 0, true); // external attrs
    view.setUint32(pos + 42, item.offset, true);
    pos += 46;
    out.set(item.nameBytes, pos);
    pos += item.nameBytes.length;
  }

  // End of central directory record (0x06054b50)
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, prepared.length, true);
  view.setUint16(pos + 10, prepared.length, true);
  view.setUint32(pos + 12, centralSize, true);
  view.setUint32(pos + 16, centralDirOffset, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

export function readZipArchive(archiveBytes: Uint8Array): ZipEntry[] {
  const view = new DataView(
    archiveBytes.buffer,
    archiveBytes.byteOffset,
    archiveBytes.byteLength
  );
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  let pos = 0;
  while (pos + 30 <= archiveBytes.byteLength) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) {
      break;
    }
    const method = view.getUint16(pos + 8, true);
    if (method !== 0) {
      throw new Error(`Unsupported ZIP compression method ${method}; expected Store (0)`);
    }
    const compressedSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archiveBytes.byteLength) {
      throw new Error('Corrupt ZIP archive: truncated entry payload');
    }
    const name = decoder.decode(archiveBytes.subarray(nameStart, nameStart + nameLen));
    const data = archiveBytes.slice(dataStart, dataEnd);
    entries.push({ name, data });
    pos = dataEnd;
  }

  return entries;
}

export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) {
    return { mime: 'application/octet-stream', bytes: new TextEncoder().encode(dataUrl) };
  }
  const header = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

  if (header.includes(';base64')) {
    if (typeof Buffer !== 'undefined') {
      return { mime, bytes: new Uint8Array(Buffer.from(body, 'base64')) };
    }
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  if (typeof Buffer !== 'undefined') {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(bin)}`;
}
