import { inflateRawSync } from 'node:zlib';

export const DEFAULT_TRANSLATION_ARCHIVE_LIMITS = Object.freeze({
	maxArchiveBytes: 32 * 1024 * 1024,
	maxEntries: 256,
	maxEntryBytes: 4 * 1024 * 1024,
	maxExpandedBytes: 128 * 1024 * 1024,
	maxCompressionRatio: 250,
});

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const STRONG_ENCRYPTION_FLAG = 0x0040;
const MASKED_HEADER_FLAG = 0x2000;
const CRC_TABLE = createCrcTable();

export class TranslationArtifactError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'TranslationArtifactError';
		this.code = code;
	}
}

export function inspectVerifiedZip(input, options = {}) {
	const bytes = asBuffer(input);
	const limits = normalizeLimits(options.limits);
	if (bytes.byteLength === 0 || bytes.byteLength > limits.maxArchiveBytes) {
		fail('ZIP_ARCHIVE_SIZE', `Translation archive must be between 1 and ${limits.maxArchiveBytes} bytes.`);
	}

	const eocdOffset = findEndOfCentralDirectory(bytes);
	if (eocdOffset < 0) fail('ZIP_EOCD_MISSING', 'Translation artifact is not a complete non-Zip64 ZIP archive.');
	const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
	const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
	const diskEntries = bytes.readUInt16LE(eocdOffset + 8);
	const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
	const centralSize = bytes.readUInt32LE(eocdOffset + 12);
	const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
	const commentLength = bytes.readUInt16LE(eocdOffset + 20);
	if (eocdOffset + 22 + commentLength !== bytes.byteLength) {
		fail('ZIP_TRAILING_DATA', 'Translation archive has trailing or truncated EOCD data.');
	}
	if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
		fail('ZIP_MULTIDISK', 'Multi-disk translation archives are not supported.');
	}
	if (totalEntries === 0 || totalEntries > limits.maxEntries) {
		fail('ZIP_ENTRY_COUNT', `Translation archive entry count exceeds ${limits.maxEntries}.`);
	}
	if (
		totalEntries === 0xffff
		|| centralSize === 0xffffffff
		|| centralOffset === 0xffffffff
	) fail('ZIP64_UNSUPPORTED', 'Zip64 translation archives are not supported.');
	if (centralOffset + centralSize !== eocdOffset) {
		fail('ZIP_CENTRAL_BOUNDS', 'Translation archive central directory has invalid bounds.');
	}

	const entries = [];
	const names = new Set();
	let cursor = centralOffset;
	let expandedBytes = 0;
	let compressedBytes = 0;
	for (let index = 0; index < totalEntries; index += 1) {
		ensureRange(bytes, cursor, 46, 'ZIP_CENTRAL_TRUNCATED');
		if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
			fail('ZIP_CENTRAL_SIGNATURE', 'Translation archive contains an invalid central-directory entry.');
		}
		const madeBy = bytes.readUInt16LE(cursor + 4);
		const flags = bytes.readUInt16LE(cursor + 8);
		const compressionMethod = bytes.readUInt16LE(cursor + 10);
		const expectedCrc32 = bytes.readUInt32LE(cursor + 16);
		const compressedSize = bytes.readUInt32LE(cursor + 20);
		const uncompressedSize = bytes.readUInt32LE(cursor + 24);
		const nameLength = bytes.readUInt16LE(cursor + 28);
		const extraLength = bytes.readUInt16LE(cursor + 30);
		const entryCommentLength = bytes.readUInt16LE(cursor + 32);
		const entryDisk = bytes.readUInt16LE(cursor + 34);
		const externalAttributes = bytes.readUInt32LE(cursor + 38);
		const localOffset = bytes.readUInt32LE(cursor + 42);
		const recordLength = 46 + nameLength + extraLength + entryCommentLength;
		ensureRange(bytes, cursor, recordLength, 'ZIP_CENTRAL_TRUNCATED');
		if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
			fail('ZIP64_UNSUPPORTED', 'Zip64 translation archive entries are not supported.');
		}
		if (entryDisk !== 0) fail('ZIP_MULTIDISK', 'Multi-disk translation archive entry found.');
		validateFlags(flags);
		if (compressionMethod !== 0 && compressionMethod !== 8) {
			fail('ZIP_COMPRESSION_METHOD', `Unsupported ZIP compression method ${compressionMethod}.`);
		}
		const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
		const name = decodeEntryName(rawName, flags);
		validateEntryName(name);
		const collisionKey = name.normalize('NFC').toLocaleLowerCase('en-US');
		if (names.has(collisionKey)) fail('ZIP_DUPLICATE_ENTRY', `Duplicate ZIP entry: ${name}`);
		names.add(collisionKey);
		validateEntryType(name, madeBy, externalAttributes);
		if (uncompressedSize > limits.maxEntryBytes) {
			fail('ZIP_ENTRY_SIZE', `ZIP entry ${name} exceeds ${limits.maxEntryBytes} expanded bytes.`);
		}
		if (compressedSize === 0 ? uncompressedSize !== 0 : uncompressedSize / compressedSize > limits.maxCompressionRatio) {
			fail('ZIP_COMPRESSION_RATIO', `ZIP entry ${name} exceeds the allowed compression ratio.`);
		}
		expandedBytes += uncompressedSize;
		compressedBytes += compressedSize;
		if (expandedBytes > limits.maxExpandedBytes) {
			fail('ZIP_EXPANDED_SIZE', `Translation archive exceeds ${limits.maxExpandedBytes} expanded bytes.`);
		}
		const local = inspectLocalHeader(bytes, {
			centralOffset,
			compressedSize,
			compressionMethod,
			crc32: expectedCrc32,
			flags,
			localOffset,
			name,
			rawName,
			uncompressedSize,
		});
		entries.push(Object.freeze({
			name,
			compressedSize,
			uncompressedSize,
			compressionMethod,
			crc32: expectedCrc32,
			dataOffset: local.dataOffset,
			localOffset,
			localEnd: local.dataEnd,
		}));
		cursor += recordLength;
	}
	if (cursor !== centralOffset + centralSize) {
		fail('ZIP_CENTRAL_SIZE', 'Translation archive central-directory size does not match its entries.');
	}
	if (compressedBytes > 0 && expandedBytes / compressedBytes > limits.maxCompressionRatio) {
		fail('ZIP_COMPRESSION_RATIO', 'Translation archive exceeds the allowed aggregate compression ratio.');
	}
	validateNonOverlappingEntries(entries);

	const byName = new Map(entries.map((entry) => [entry.name, entry]));
	return Object.freeze({
		byteLength: bytes.byteLength,
		entries: Object.freeze(entries),
		readEntry(name) {
			const entry = byName.get(name);
			if (!entry) fail('ZIP_ENTRY_MISSING', `ZIP entry not found: ${name}`);
			return readEntry(bytes, entry);
		},
	});
}

function inspectLocalHeader(bytes, expected) {
	ensureRange(bytes, expected.localOffset, 30, 'ZIP_LOCAL_TRUNCATED');
	if (bytes.readUInt32LE(expected.localOffset) !== LOCAL_SIGNATURE) {
		fail('ZIP_LOCAL_SIGNATURE', `Invalid local header for ZIP entry ${expected.name}.`);
	}
	const localFlags = bytes.readUInt16LE(expected.localOffset + 6);
	const localMethod = bytes.readUInt16LE(expected.localOffset + 8);
	const localCrc32 = bytes.readUInt32LE(expected.localOffset + 14);
	const localCompressedSize = bytes.readUInt32LE(expected.localOffset + 18);
	const localUncompressedSize = bytes.readUInt32LE(expected.localOffset + 22);
	const nameLength = bytes.readUInt16LE(expected.localOffset + 26);
	const extraLength = bytes.readUInt16LE(expected.localOffset + 28);
	if (localFlags !== expected.flags || localMethod !== expected.compressionMethod) {
		fail('ZIP_LOCAL_MISMATCH', `Local ZIP metadata differs for ${expected.name}.`);
	}
	if (!(localFlags & DATA_DESCRIPTOR_FLAG) && (
		localCrc32 !== expected.crc32
		|| localCompressedSize !== expected.compressedSize
		|| localUncompressedSize !== expected.uncompressedSize
	)) fail('ZIP_LOCAL_MISMATCH', `Local ZIP sizes or checksum differ for ${expected.name}.`);
	ensureRange(bytes, expected.localOffset, 30 + nameLength + extraLength, 'ZIP_LOCAL_TRUNCATED');
	const localName = bytes.subarray(expected.localOffset + 30, expected.localOffset + 30 + nameLength);
	if (!localName.equals(expected.rawName)) fail('ZIP_LOCAL_MISMATCH', `Local ZIP name differs for ${expected.name}.`);
	const dataOffset = expected.localOffset + 30 + nameLength + extraLength;
	const dataEnd = dataOffset + expected.compressedSize;
	if (dataEnd > expected.centralOffset) fail('ZIP_DATA_BOUNDS', `ZIP entry ${expected.name} overlaps the central directory.`);
	return { dataOffset, dataEnd };
}

function readEntry(bytes, entry) {
	const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
	let output;
	try {
		output = entry.compressionMethod === 0
			? Buffer.from(compressed)
			: inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
	} catch (error) {
		throw new TranslationArtifactError('ZIP_DECOMPRESSION', `Could not decompress ${entry.name}: ${error.message}`);
	}
	if (output.byteLength !== entry.uncompressedSize) {
		fail('ZIP_ENTRY_LENGTH', `Expanded length mismatch for ZIP entry ${entry.name}.`);
	}
	if (crc32(output) !== entry.crc32) fail('ZIP_CRC_MISMATCH', `CRC mismatch for ZIP entry ${entry.name}.`);
	return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}

function validateNonOverlappingEntries(entries) {
	const ordered = [...entries].sort((left, right) => left.localOffset - right.localOffset);
	for (let index = 1; index < ordered.length; index += 1) {
		if (ordered[index].localOffset < ordered[index - 1].localEnd) {
			fail('ZIP_OVERLAPPING_ENTRIES', 'Translation archive contains overlapping local entries.');
		}
	}
}

function validateFlags(flags) {
	if (flags & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG | MASKED_HEADER_FLAG)) {
		fail('ZIP_ENCRYPTED', 'Encrypted or masked translation archive entries are not supported.');
	}
	const supported = UTF8_FLAG | DATA_DESCRIPTOR_FLAG;
	if (flags & ~supported) fail('ZIP_FLAGS', `Unsupported ZIP general-purpose flags: 0x${flags.toString(16)}.`);
}

function validateEntryName(name) {
	if (
		!name
		|| name.includes('\0')
		|| name.includes('\\')
		|| name.startsWith('/')
		|| /^[A-Za-z]:/.test(name)
	) fail('ZIP_UNSAFE_PATH', `Unsafe ZIP entry path: ${JSON.stringify(name)}.`);
	const segments = name.split('/');
	if (segments.some((segment, index) => !segment && index !== segments.length - 1)) {
		fail('ZIP_UNSAFE_PATH', `Unsafe ZIP entry path: ${JSON.stringify(name)}.`);
	}
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		fail('ZIP_UNSAFE_PATH', `Unsafe ZIP entry path: ${JSON.stringify(name)}.`);
	}
}

function validateEntryType(name, madeBy, externalAttributes) {
	const platform = madeBy >>> 8;
	if (platform !== 3) return;
	const mode = (externalAttributes >>> 16) & 0xffff;
	const fileType = mode & 0xf000;
	const allowed = name.endsWith('/') ? 0x4000 : 0x8000;
	if (fileType !== 0 && fileType !== allowed) {
		fail('ZIP_SPECIAL_FILE', `ZIP entry ${name} is not a regular file or directory.`);
	}
}

function decodeEntryName(rawName, flags) {
	if (!(flags & UTF8_FLAG) && rawName.some((byte) => byte > 0x7f)) {
		fail('ZIP_FILENAME_ENCODING', 'Non-ASCII ZIP filenames must declare UTF-8 encoding.');
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(rawName);
	} catch {
		fail('ZIP_FILENAME_ENCODING', 'ZIP entry filename is not valid UTF-8.');
	}
}

function findEndOfCentralDirectory(bytes) {
	const first = Math.max(0, bytes.byteLength - MAX_EOCD_SEARCH);
	for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
		if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
	}
	return -1;
}

function normalizeLimits(overrides = {}) {
	const limits = { ...DEFAULT_TRANSLATION_ARCHIVE_LIMITS, ...overrides };
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value <= 0) fail('ZIP_LIMIT_INVALID', `Invalid ZIP limit ${name}.`);
	}
	return limits;
}

function ensureRange(bytes, offset, length, code) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
		fail(code, 'Translation archive contains truncated or out-of-range ZIP metadata.');
	}
}

function asBuffer(input) {
	if (Buffer.isBuffer(input)) return input;
	if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (input instanceof ArrayBuffer) return Buffer.from(input);
	fail('ZIP_INPUT_TYPE', 'Translation archive must be bytes.');
}

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
	return Uint32Array.from({ length: 256 }, (_, index) => {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		return value >>> 0;
	});
}

function fail(code, message) {
	throw new TranslationArtifactError(code, message);
}
