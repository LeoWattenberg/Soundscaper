/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseRiffInfoFields } from './riff-info.ts';
import { riffMetadataCodePage } from './riff-metadata-text.ts';
import { ascii, dataView, readBlobBytes } from './wav-import-io.ts';
import { consumeDs64TableSize, readDs64Directory } from './wav-ds64.js';

const MAXIMUM_CHUNKS = 4096;
const MAXIMUM_INFO_BYTES = 4 * 1024 * 1024;
const INFO_TAG_FIELDS: Readonly<Record<string, string>> = Object.freeze({
	INAM: 'title', TITL: 'title', TIT3: 'description', IART: 'artist', IPRD: 'album',
	IGNR: 'genre', GENR: 'genre', ICMT: 'comment', CMNT: 'comment', COMM: 'comment',
});

type MetadataRecord = Readonly<Record<string, unknown>>;

/** Correct only RIFF text admitted by the original reader; retain independent ID3 tags. */
export async function correctImportedRiffMetadata(file: Blob, tags: unknown, signal?: AbortSignal): Promise<unknown> {
	if (!record(tags)) return tags;
	const fields = await readRiffInfoFields(file, signal);
	if (fields === null || Object.keys(fields).length === 0) return tags;
	const raw = record(tags.raw) ? tags.raw : {};
	const corrected: Record<string, unknown> = { ...tags, raw: { ...raw, ...fields } };
	for (const [id, text] of Object.entries(fields)) {
		const field = INFO_TAG_FIELDS[id];
		if (field && (tags[field] == null || tags[field] === raw[id])) corrected[field] = text;
	}
	return corrected;
}

/** Scan bounded metadata slices and skip the encoded audio rather than materializing it. */
async function readRiffInfoFields(file: Blob, signal?: AbortSignal): Promise<Readonly<Record<string, string>> | null> {
	signal?.throwIfAborted();
	if (file.size < 12) return null;
	const header = await readBlobBytes(file, 0, 12, signal);
	const kind = ascii(header, 0, 4);
	if (!['RIFF', 'RIFX', 'RF64', 'BW64'].includes(kind) || ascii(header, 8, 4) !== 'WAVE') return null;
	const littleEndian = kind !== 'RIFX';
	const declaredSize = dataView(header).getUint32(4, littleEndian);
	const directory = kind === 'RF64' || kind === 'BW64'
		? await readDs64Directory(file, signal, MAXIMUM_CHUNKS, declaredSize, kind.toLowerCase(), readBlobBytes) as Ds64Directory
		: null;
	const end = directory?.riffEnd ?? declaredSize + 8;
	if (!Number.isSafeInteger(end) || end < 12 || end > file.size) throw new RangeError('The RIFF metadata container size is invalid.');
	let offset = directory?.nextOffset ?? 12;
	let codePage: number | null = null;
	let infoBytes = 0;
	let chunkCount = 0;
	let dataSeen = false;
	const payloads: Uint8Array[] = [];
	while (offset < end) {
		if (++chunkCount > MAXIMUM_CHUNKS) throw new RangeError('The RIFF metadata chunk count is too large.');
		if (offset + 8 > end) throw new RangeError('The RIFF metadata chunk header is incomplete.');
		const chunk = await readBlobBytes(file, offset, offset + 8, signal);
		const id = ascii(chunk, 0, 4);
		let size = dataView(chunk).getUint32(4, littleEndian);
		if (directory && size === 0xffffffff) size = id === 'data' && !dataSeen
			? directory.dataByteLength : consumeDs64TableSize(directory, id) as number;
		if (id === 'data') dataSeen = true;
		const start = offset + 8;
		const next = start + size + (size % 2);
		if (!Number.isSafeInteger(next) || next > end) throw new RangeError('The RIFF metadata chunk is incomplete.');
		if (id === 'CSET' && codePage === null && size >= 8) {
			codePage = riffMetadataCodePage(await readBlobBytes(file, start, start + 8, signal), littleEndian);
		} else if (id === 'LIST' && size >= 4) {
			const type = ascii(await readBlobBytes(file, start, start + 4, signal), 0, 4);
			if (type === 'INFO' || type === 'INF0') {
				infoBytes += size;
				if (infoBytes > MAXIMUM_INFO_BYTES) throw new RangeError('The RIFF INFO metadata exceeds its inspection limit.');
				payloads.push(await readBlobBytes(file, start + 4, start + size, signal));
			}
		}
		offset = next;
	}
	return parseRiffInfoFields(payloads, codePage ?? 0, littleEndian);
}

function record(value: unknown): value is MetadataRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface Ds64Directory {
	readonly name: string;
	readonly riffEnd: number;
	readonly nextOffset: number;
	readonly dataByteLength: number;
	readonly table: Map<string, { readonly values: number[]; index: number }>;
}
