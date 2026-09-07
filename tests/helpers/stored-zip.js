/* SPDX-License-Identifier: AGPL-3.0-only */

// A minimal stored (uncompressed) zip writer for archive fixtures.

export function makeStoredZip(files) {
	const localRecords = [];
	const centralRecords = [];
	let localOffset = 0;
	for (const file of files) {
		const name = Buffer.from(file.name, 'utf8');
		const data = Buffer.from(file.data);
		const checksum = crc32(data);
		const local = Buffer.alloc(30 + name.byteLength + data.byteLength);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(data.byteLength, 18);
		local.writeUInt32LE(data.byteLength, 22);
		local.writeUInt16LE(name.byteLength, 26);
		name.copy(local, 30);
		data.copy(local, 30 + name.byteLength);
		localRecords.push(local);

		const central = Buffer.alloc(46 + name.byteLength);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE((3 << 8) | 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(data.byteLength, 20);
		central.writeUInt32LE(data.byteLength, 24);
		central.writeUInt16LE(name.byteLength, 28);
		central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
		central.writeUInt32LE(localOffset, 42);
		name.copy(central, 46);
		centralRecords.push(central);
		localOffset += local.byteLength;
	}
	const centralOffset = localOffset;
	const centralSize = centralRecords.reduce((total, record) => total + record.byteLength, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(files.length, 8);
	eocd.writeUInt16LE(files.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralOffset, 16);
	return Buffer.concat([...localRecords, ...centralRecords, eocd]);
}


function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}
