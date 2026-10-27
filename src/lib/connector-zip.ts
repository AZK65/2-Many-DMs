/** Small, uncompressed ZIP for the fixed browser-extension files. No shell or dependencies. */
export function connectorZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9._-]+$/.test(file.name)) throw new Error("Invalid archive filename");
    let crc = 0xffffffff;
    for (const byte of file.data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const name = Buffer.from(file.name), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(file.data.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(file.data.length, 20); central.writeUInt32LE(file.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, file.data); directory.push(central, name); offset += local.length + name.length + file.data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
