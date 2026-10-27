import { inflateRawSync } from "node:zlib";
import { REFERENCE_OFFICE_BYTES } from "../reference-policy.js";

const fail = () => { throw new Error("CREATION_REFERENCE_ARCHIVE_INVALID"); };
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
function pathName(bytes) {
  let name;
  try { name = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(); }
  if (!name || name.length > 512 || /[\\\u0000-\u001f\u007f:%?#]/.test(name) || name.startsWith("/") || name.split("/").some(part => part === ".." || part === ".")) fail();
  return name;
}

// Read the central directory before inflating anything. A forged length cannot
// allocate beyond maxOutputLength. ZIP64/encryption/split archives are refused.
export function openOfficeZip(input, { maxBytes = REFERENCE_OFFICE_BYTES } = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length < 22 || bytes.length > maxBytes) fail();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail();
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count > 2048 || bytes.readUInt16LE(end + 8) !== count || start + size !== end) fail();
  const entries = new Map(), names = new Set(), ranges = [];
  let offset = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), crc = bytes.readUInt32LE(offset + 16);
    const compressed = bytes.readUInt32LE(offset + 20), length = bytes.readUInt32LE(offset + 24), nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    if (flags & ~0x080e || ![0, 8].includes(method) || bytes.readUInt16LE(offset + 34) || offset + 46 + nameLength + extraLength + commentLength > end) fail();
    if (length > 8 * 1024 * 1024 || (expanded += length) > 32 * 1024 * 1024 || local + 30 > start) fail();
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength), name = pathName(nameBytes);
    if (names.has(name.toLowerCase())) fail(); names.add(name.toLowerCase());
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail();
    const localName = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), data = local + 30 + localName + localExtra;
    if (data + compressed > start || localName !== nameLength || !bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes)) fail();
    if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== length)) fail();
    // ZIP64 is unnecessary within the bounded upload size, including empty entries.
    for (const [at, endAt] of [[offset + 46 + nameLength, offset + 46 + nameLength + extraLength], [local + 30 + localName, data]]) {
      let p = at;
      while (p < endAt) { if (p + 4 > endAt || bytes.readUInt16LE(p) === 1) fail(); const n = bytes.readUInt16LE(p + 2); p += 4 + n; if (p > endAt) fail(); }
    }
    ranges.push([local, data + compressed]);
    entries.set(name, { data, compressed, length, crc, method });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) fail();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail();
  return {
    names: [...entries.keys()],
    has: name => entries.has(name),
    read(name) {
      const entry = entries.get(name); if (!entry) fail();
      const source = bytes.subarray(entry.data, entry.data + entry.compressed);
      let output;
      try { output = entry.method === 0 ? source : inflateRawSync(source, { maxOutputLength: Math.max(1, entry.length) }); } catch { fail(); }
      if (output.length !== entry.length || crc32(output) !== entry.crc) fail();
      return output;
    },
  };
}
