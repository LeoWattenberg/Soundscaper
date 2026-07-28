const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const DS64_MINIMUM_BYTES = 28;
const DS64_TABLE_ENTRY_BYTES = 12;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
export const DS64_UINT32_SENTINEL = 0xffff_ffff;

export async function readDs64Directory(
	blob,
	signal,
	maxRiffChunks,
	declaredRiffPayloadBytes,
	dialect,
	readBytes,
) {
	const name = dialect === 'bw64' ? 'BW64' : 'RF64';
	if (dialect === 'bw64' && declaredRiffPayloadBytes !== DS64_UINT32_SENTINEL) {
		throw new Error('The BW64 top-level RIFF size must use the 0xFFFFFFFF sentinel.');
	}
	if (blob.size - RIFF_HEADER_BYTES < CHUNK_HEADER_BYTES) {
		throw new Error(`The ${name} file ends inside its mandatory ds64 chunk header.`);
	}
	const header = await readBytes(
		blob,
		RIFF_HEADER_BYTES,
		RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES,
		signal,
	);
	if (ascii(header, 0, 4) !== 'ds64') throw new Error(`The first ${name} chunk must be ds64.`);
	const declaredBytes = dataView(header).getUint32(4, true);
	if (declaredBytes === DS64_UINT32_SENTINEL || declaredBytes < DS64_MINIMUM_BYTES) {
		throw new Error(`The ${name} ds64 chunk is too small.`);
	}
	const payloadOffset = RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES;
	if (blob.size - payloadOffset < DS64_MINIMUM_BYTES) throw new Error(`The ${name} ds64 chunk is truncated.`);
	const fixedBytes = await readBytes(blob, payloadOffset, payloadOffset + DS64_MINIMUM_BYTES, signal);
	const fixedView = dataView(fixedBytes);
	const ds64RiffPayloadBytes = readSafeUint64(fixedView, 0, `${name} ds64 RIFF size`);
	const dataByteLength = readSafeUint64(fixedView, 8, `${name} ds64 data size`);
	const sampleCount = dialect === 'rf64'
		? readSafeUint64(fixedView, 16, 'RF64 ds64 sample count')
		: null;
	const tableLength = fixedView.getUint32(24, true);
	if (tableLength > maxRiffChunks) {
		throw new Error(`The ${name} ds64 table exceeds the ${maxRiffChunks}-entry inspection limit.`);
	}
	const requiredBytes = DS64_MINIMUM_BYTES + tableLength * DS64_TABLE_ENTRY_BYTES;
	if (requiredBytes > declaredBytes) throw new Error(`The ${name} ds64 table is truncated.`);
	if (requiredBytes !== declaredBytes) {
		throw new Error(`The ${name} ds64 chunk size does not match its table length.`);
	}
	const riffPayloadBytes = declaredRiffPayloadBytes === DS64_UINT32_SENTINEL
		? ds64RiffPayloadBytes
		: declaredRiffPayloadBytes;
	if (riffPayloadBytes < 4) throw new Error(`The ${name} RIFF size is invalid.`);
	const riffEnd = 8 + riffPayloadBytes;
	if (!Number.isSafeInteger(riffEnd)) throw new Error(`The ${name} RIFF end exceeds the JavaScript safe integer range.`);
	if (riffEnd > blob.size) throw new Error(`The ${name} payload is truncated.`);
	if (declaredBytes > riffEnd - payloadOffset || declaredBytes > blob.size - payloadOffset) {
		throw new Error(`The ${name} ds64 chunk is truncated.`);
	}
	const payloadEnd = payloadOffset + declaredBytes;
	const nextOffset = payloadEnd + (declaredBytes % 2);
	if (nextOffset > riffEnd) throw new Error(`The ${name} ds64 chunk is missing its pad byte.`);

	const table = new Map();
	if (tableLength > 0) {
		const bytes = await readBytes(blob, payloadOffset, payloadOffset + requiredBytes, signal);
		const view = dataView(bytes);
		for (let index = 0; index < tableLength; index += 1) {
			const entryOffset = DS64_MINIMUM_BYTES + index * DS64_TABLE_ENTRY_BYTES;
			const chunkId = ascii(bytes, entryOffset, 4);
			if (chunkId === 'data') throw new Error(`The ${name} ds64 table must not contain a data entry.`);
			const byteLength = readSafeUint64(view, entryOffset + 4, `${name} ds64 ${printableChunkId(chunkId)} size`);
			let queue = table.get(chunkId);
			if (!queue) {
				queue = { values: [], index: 0 };
				table.set(chunkId, queue);
			}
			queue.values.push(byteLength);
		}
	}
	return { name, riffEnd, dataByteLength, sampleCount, nextOffset, table };
}

export function consumeDs64TableSize(directory, chunkId) {
	const queue = directory.table.get(chunkId);
	if (!queue || queue.index >= queue.values.length) {
		throw new Error(`The ${directory.name} ${printableChunkId(chunkId)} sentinel has no ds64 table size.`);
	}
	const value = queue.values[queue.index];
	queue.index += 1;
	return value;
}

export function assertDs64TableConsumed(directory) {
	for (const [chunkId, queue] of directory.table) {
		if (queue.index < queue.values.length) {
			throw new Error(`The ${directory.name} file has an unused ds64 table entry for ${printableChunkId(chunkId)}.`);
		}
	}
}

function readSafeUint64(view, offset, name) {
	const value = view.getBigUint64(offset, true);
	if (value > MAX_SAFE_BIGINT) throw new Error(`The ${name} exceeds the JavaScript safe integer range.`);
	return Number(value);
}

function dataView(bytes) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes, offset, length) {
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
	return value;
}

function printableChunkId(value) {
	return JSON.stringify(value.replace(/[^\x20-\x7e]/g, '?'));
}
