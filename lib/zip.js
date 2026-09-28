import {crc32, inflateRawSync} from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MADE_BY_UNIX = 3;

const findEndOfCentralDirectory = (buffer) => {
  const lowest = Math.max(0, buffer.length - EOCD_MIN_SIZE - 0xffff);
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= lowest; i--) if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  throw new Error('Not a zip archive');
};

const inflate = (buffer, method, name) => {
  if (method === 0) return buffer;
  if (method === 8) return inflateRawSync(buffer);
  throw new Error(`Unsupported compression method ${method} for ${name}`);
};

const readEntries = (buffer) => {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('Corrupt zip central directory');
    const madeBy = buffer.readUInt16LE(offset + 4) >> 8;
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/');
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`Corrupt zip entry: ${name}`);

    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = inflate(buffer.subarray(dataStart, dataStart + compressedSize), method, name);
    if (crc32(data) !== crc) throw new Error(`Checksum mismatch in zip entry: ${name}`);

    const mode = madeBy === MADE_BY_UNIX ? (externalAttributes >>> 16) & 0o777 : 0;
    entries.push({path: name, data, mode});
  }
  return entries;
};

const isSafePath = (entryPath) => !entryPath.startsWith('/') && !/^[a-zA-Z]:/.test(entryPath) && !entryPath.split('/').includes('..');

export const readZip = (buffer) => {
  const entries = readEntries(buffer);
  const unsafe = entries.find(e => !isSafePath(e.path));
  if (unsafe) throw new Error(`Refusing to extract zip entry outside the target folder: ${unsafe.path}`);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
};
