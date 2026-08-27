/* SPDX-License-Identifier: AGPL-3.0-only */

/** Compact exact source/VFR/timeline rows for long bounded assistance selections. */

import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from '../video-timing-asset-reference.ts';

export const ASSISTANCE_SOURCE_TIME_ROWS_CHUNK_VERSION = 1 as const;
export const ASSISTANCE_SOURCE_TIME_ROWS_PER_CHUNK = 65_536;
export const ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM = VIDEO_TIMING_ASSET_MAXIMUM_FRAMES + 1;
export const ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM_CHUNKS = 32;

const ROW_BYTES = 20;
const MAXIMUM_SOURCE_FRAME = 0xffff_ffff;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const MAXIMUM_TIMELINE_FRAME = BigInt(Number.MAX_SAFE_INTEGER);
const BASE64 = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u;

export interface AssistanceSourceTimeRowV1 {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly timelineFrame: number;
}

export interface AssistanceSourceTimeRowsChunkV1 {
	readonly schemaVersion: typeof ASSISTANCE_SOURCE_TIME_ROWS_CHUNK_VERSION;
	readonly kind: 'source-time-rows';
	readonly rowCount: number;
	readonly firstSourceFrame: number;
	readonly lastSourceFrame: number;
	readonly bodyBase64: string;
}

export type AssistanceSourceTimeRowsInventoryV1 =
	readonly AssistanceSourceTimeRowV1[] | readonly AssistanceSourceTimeRowsChunkV1[];

export interface ReviewedAssistanceSourceTimeRowsV1 {
	readonly rowCount: number;
	readonly first: AssistanceSourceTimeRowV1;
	readonly last: AssistanceSourceTimeRowV1;
	row(ordinal: number): AssistanceSourceTimeRowV1;
	firstAtOrAfterSource(sourceFrame: number): number;
	firstAtOrAfterPresentationTick(presentationTick: string): number;
	firstAtOrAfterTimeline(timelineFrame: number): number;
	prefix(rowCount: number): AssistanceSourceTimeRowsInventoryV1;
}

/** Encode strict rows into independently bounded canonical base64 chunks. */
export function createAssistanceSourceTimeRowChunksV1(
	rowsValue: Iterable<AssistanceSourceTimeRowV1>,
): readonly AssistanceSourceTimeRowsChunkV1[] {
	if (!rowsValue || typeof rowsValue[Symbol.iterator] !== 'function') {
		throw new TypeError('Source-time rows require one iterable authority.');
	}
	const chunks: AssistanceSourceTimeRowsChunkV1[] = [];
	let rows: AssistanceSourceTimeRowV1[] = [];
	let rowCount = 0;
	let prior: AssistanceSourceTimeRowV1 | null = null;
	const flush = (): void => {
		if (rows.length < 1) return;
		const bytes = new Uint8Array(rows.length * ROW_BYTES);
		const view = new DataView(bytes.buffer);
		for (const [index, row] of rows.entries()) writeRow(view, index * ROW_BYTES, row);
		chunks.push(Object.freeze({ schemaVersion: ASSISTANCE_SOURCE_TIME_ROWS_CHUNK_VERSION,
			kind: 'source-time-rows' as const, rowCount: rows.length,
			firstSourceFrame: rows[0]!.sourceFrame,
			lastSourceFrame: rows.at(-1)!.sourceFrame,
			bodyBase64: encodeBase64(bytes) }));
		rows = [];
	};
	for (const rowValue of rowsValue) {
		const row = reviewRow(rowValue, 'source-time row');
		if (prior && (row.sourceFrame <= prior.sourceFrame
			|| BigInt(row.presentationTick) <= BigInt(prior.presentationTick)
			|| row.timelineFrame <= prior.timelineFrame)) {
			throw new RangeError('Source-time rows must remain strictly forward and ordered.');
		}
		rowCount += 1;
		if (rowCount > ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM) {
			throw new RangeError('Source-time rows exceed their exact aggregate bound.');
		}
		rows.push(row);
		prior = row;
		if (rows.length === ASSISTANCE_SOURCE_TIME_ROWS_PER_CHUNK) flush();
	}
	flush();
	if (rowCount < 2 || chunks.length < 1
		|| chunks.length > ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM_CHUNKS) {
		throw new RangeError('Source-time rows cannot bind a bounded non-empty selection.');
	}
	return Object.freeze(chunks);
}

/** Review legacy rows or compact chunks into one immutable random-access authority. */
export function reviewAssistanceSourceTimeRowsV1(
	value: unknown,
): ReviewedAssistanceSourceTimeRowsV1 {
	if (!Array.isArray(value) || value.length < 1) {
		throw new RangeError('Source-time row custody is empty.');
	}
	const rows = isChunk(value[0]) ? decodeChunks(value) : decodeLegacy(value);
	if (rows.sourceFrames.length < 2) {
		throw new RangeError('Source-time rows cannot bind both selection endpoints.');
	}
	const row = (ordinalValue: number): AssistanceSourceTimeRowV1 => {
		const ordinal = integer(ordinalValue, 0, rows.sourceFrames.length - 1,
			'source-time row ordinal');
		return Object.freeze({ sourceFrame: rows.sourceFrames[ordinal]!,
			presentationTick: rows.presentationTicks[ordinal]!.toString(),
			timelineFrame: Number(rows.timelineFrames[ordinal]!) });
	};
	return Object.freeze({ rowCount: rows.sourceFrames.length, first: row(0),
		last: row(rows.sourceFrames.length - 1), row,
		firstAtOrAfterSource: (sourceFrame: number) => lowerBound(rows.sourceFrames,
			integer(sourceFrame, 0, MAXIMUM_SOURCE_FRAME, 'source frame')),
		firstAtOrAfterPresentationTick: (presentationTick: string) => lowerBoundBigInt(
			rows.presentationTicks, BigInt(tick(presentationTick, 'presentation tick'))),
		firstAtOrAfterTimeline: (timelineFrame: number) => lowerBoundBigInt(rows.timelineFrames,
			BigInt(integer(timelineFrame, 0, Number.MAX_SAFE_INTEGER, 'timeline frame'))),
		prefix: (rowCount: number) => rowsPrefix(rows,
			integer(rowCount, 1, rows.sourceFrames.length, 'source-time prefix row count'), row) });
}

interface DecodedRows {
	readonly sourceFrames: Uint32Array;
	readonly presentationTicks: BigUint64Array;
	readonly timelineFrames: BigUint64Array;
	readonly chunks: readonly AssistanceSourceTimeRowsChunkV1[] | null;
}

function decodeChunks(value: unknown[]): DecodedRows {
	if (value.length > ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM_CHUNKS
		|| value.some((candidate) => !isChunk(candidate))) {
		throw new RangeError('Source-time chunk custody exceeds its exact inventory bound.');
	}
	const chunks = value.map((candidate, index) => reviewChunk(candidate, index));
	const rowCount = chunks.reduce((total, chunk) => safeAdd(total, chunk.rowCount), 0);
	if (rowCount > ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM) {
		throw new RangeError('Source-time chunks exceed their exact aggregate row bound.');
	}
	const sourceFrames = new Uint32Array(rowCount);
	const presentationTicks = new BigUint64Array(rowCount);
	const timelineFrames = new BigUint64Array(rowCount);
	let ordinal = 0;
	for (const [chunkIndex, chunk] of chunks.entries()) {
		const bytes = decodeBase64(chunk.bodyBase64);
		if (bytes.byteLength !== chunk.rowCount * ROW_BYTES) {
			throw new RangeError(`Source-time chunk ${String(chunkIndex)} has invalid byte geometry.`);
		}
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		for (let index = 0; index < chunk.rowCount; index += 1) {
			const offset = index * ROW_BYTES;
			sourceFrames[ordinal] = view.getUint32(offset, true);
			presentationTicks[ordinal] = view.getBigUint64(offset + 4, true);
			timelineFrames[ordinal] = view.getBigUint64(offset + 12, true);
			ordinal += 1;
		}
		if (sourceFrames[ordinal - chunk.rowCount] !== chunk.firstSourceFrame
			|| sourceFrames[ordinal - 1] !== chunk.lastSourceFrame) {
			throw new RangeError(`Source-time chunk ${String(chunkIndex)} summary disagrees with its body.`);
		}
	}
	validateDecoded(sourceFrames, presentationTicks, timelineFrames);
	return Object.freeze({ sourceFrames, presentationTicks, timelineFrames,
		chunks: Object.freeze(chunks) });
}

function decodeLegacy(value: unknown[]): DecodedRows {
	if (value.length > ASSISTANCE_SOURCE_TIME_ROWS_MAXIMUM) {
		throw new RangeError('Legacy source-time rows exceed their exact aggregate bound.');
	}
	const sourceFrames = new Uint32Array(value.length);
	const presentationTicks = new BigUint64Array(value.length);
	const timelineFrames = new BigUint64Array(value.length);
	for (const [index, candidate] of value.entries()) {
		const row = reviewRow(candidate, `source-time row ${String(index)}`);
		sourceFrames[index] = row.sourceFrame;
		presentationTicks[index] = BigInt(row.presentationTick);
		timelineFrames[index] = BigInt(row.timelineFrame);
	}
	validateDecoded(sourceFrames, presentationTicks, timelineFrames);
	return Object.freeze({ sourceFrames, presentationTicks, timelineFrames, chunks: null });
}

function rowsPrefix(
	rows: DecodedRows,
	rowCount: number,
	row: (ordinal: number) => AssistanceSourceTimeRowV1,
): AssistanceSourceTimeRowsInventoryV1 {
	if (rows.chunks === null || rowCount === 1) {
		return Object.freeze(Array.from({ length: rowCount }, (_, index) => row(index)));
	}
	const chunks: AssistanceSourceTimeRowsChunkV1[] = [];
	let retained = 0;
	for (const chunk of rows.chunks) {
		if (retained === rowCount) break;
		const remaining = rowCount - retained;
		if (remaining >= chunk.rowCount) {
			chunks.push(chunk);
			retained += chunk.rowCount;
			continue;
		}
		chunks.push(chunkFromDecoded(rows, retained, remaining));
		retained += remaining;
	}
	if (retained !== rowCount) throw new RangeError('Source-time prefix lost exact row custody.');
	return Object.freeze(chunks);
}

function chunkFromDecoded(
	rows: DecodedRows,
	start: number,
	rowCount: number,
): AssistanceSourceTimeRowsChunkV1 {
	const bytes = new Uint8Array(rowCount * ROW_BYTES);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < rowCount; index += 1) {
		const sourceIndex = start + index;
		const offset = index * ROW_BYTES;
		view.setUint32(offset, rows.sourceFrames[sourceIndex]!, true);
		view.setBigUint64(offset + 4, rows.presentationTicks[sourceIndex]!, true);
		view.setBigUint64(offset + 12, rows.timelineFrames[sourceIndex]!, true);
	}
	return Object.freeze({ schemaVersion: 1, kind: 'source-time-rows', rowCount,
		firstSourceFrame: rows.sourceFrames[start]!,
		lastSourceFrame: rows.sourceFrames[start + rowCount - 1]!, bodyBase64: encodeBase64(bytes) });
}

function validateDecoded(
	sourceFrames: Uint32Array,
	presentationTicks: BigUint64Array,
	timelineFrames: BigUint64Array,
): void {
	if (sourceFrames.length < 2 || presentationTicks.length !== sourceFrames.length
		|| timelineFrames.length !== sourceFrames.length) {
		throw new RangeError('Source-time rows have invalid aggregate geometry.');
	}
	for (let index = 0; index < sourceFrames.length; index += 1) {
		const tick = presentationTicks[index]!;
		const timeline = timelineFrames[index]!;
		if (tick > MAXIMUM_TICK || timeline > MAXIMUM_TIMELINE_FRAME
			|| index > 0 && (sourceFrames[index]! <= sourceFrames[index - 1]!
				|| tick <= presentationTicks[index - 1]!
				|| timeline <= timelineFrames[index - 1]!)) {
			throw new RangeError('Source-time rows must retain strict forward exact authority.');
		}
	}
}

function reviewChunk(value: unknown, index: number): AssistanceSourceTimeRowsChunkV1 {
	if (!isChunk(value)) throw new TypeError(`Source-time chunk ${String(index)} is invalid.`);
	const keys = Object.keys(value);
	if (keys.length !== 6 || keys.some((key) => ![
		'schemaVersion', 'kind', 'rowCount', 'firstSourceFrame', 'lastSourceFrame', 'bodyBase64',
	].includes(key))) throw new TypeError(`Source-time chunk ${String(index)} has invalid fields.`);
	const rowCount = integer(value.rowCount, 1, ASSISTANCE_SOURCE_TIME_ROWS_PER_CHUNK,
		`source-time chunk ${String(index)} row count`);
	const firstSourceFrame = integer(value.firstSourceFrame, 0, MAXIMUM_SOURCE_FRAME,
		`source-time chunk ${String(index)} first source frame`);
	const lastSourceFrame = integer(value.lastSourceFrame, firstSourceFrame, MAXIMUM_SOURCE_FRAME,
		`source-time chunk ${String(index)} last source frame`);
	if (typeof value.bodyBase64 !== 'string' || value.bodyBase64.length < 1
		|| value.bodyBase64.length > Math.ceil(rowCount * ROW_BYTES / 3) * 4
		|| !BASE64.test(value.bodyBase64)) {
		throw new TypeError(`Source-time chunk ${String(index)} base64 body is invalid.`);
	}
	return Object.freeze({ schemaVersion: 1, kind: 'source-time-rows', rowCount,
		firstSourceFrame, lastSourceFrame, bodyBase64: value.bodyBase64 });
}

function reviewRow(value: unknown, label: string): AssistanceSourceTimeRowV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be one plain record.`);
	}
	const row = value as Record<string, unknown>;
	if (Object.keys(row).length !== 3 || !Object.hasOwn(row, 'sourceFrame')
		|| !Object.hasOwn(row, 'presentationTick') || !Object.hasOwn(row, 'timelineFrame')) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	const presentationTick = tick(row.presentationTick, `${label} presentation tick`);
	return Object.freeze({ sourceFrame: integer(row.sourceFrame, 0, MAXIMUM_SOURCE_FRAME,
		`${label} source frame`), presentationTick,
		timelineFrame: integer(row.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} timeline frame`) });
}

function writeRow(view: DataView, offset: number, row: AssistanceSourceTimeRowV1): void {
	view.setUint32(offset, row.sourceFrame, true);
	view.setBigUint64(offset + 4, BigInt(row.presentationTick), true);
	view.setBigUint64(offset + 12, BigInt(row.timelineFrame), true);
}

function isChunk(value: unknown): value is Record<string, unknown> & AssistanceSourceTimeRowsChunkV1 {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& (value as Record<string, unknown>).schemaVersion === 1
		&& (value as Record<string, unknown>).kind === 'source-time-rows');
}

function encodeBase64(bytes: Uint8Array): string {
	let text = '';
	for (let offset = 0; offset < bytes.length; offset += 32_768) {
		const end = Math.min(bytes.length, offset + 32_768);
		for (let index = offset; index < end; index += 1) text += String.fromCharCode(bytes[index]!);
	}
	return btoa(text);
}

function decodeBase64(value: string): Uint8Array {
	let text: string;
	try { text = atob(value); }
	catch { throw new TypeError('Source-time chunk base64 is malformed.'); }
	const bytes = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
	if (encodeBase64(bytes) !== value) throw new TypeError('Source-time chunk base64 is noncanonical.');
	return bytes;
}

function lowerBound(values: Uint32Array, target: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (values[middle]! < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

function lowerBoundBigInt(values: BigUint64Array, target: bigint): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (values[middle]! < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

function tick(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)
		|| BigInt(value) > MAXIMUM_TICK) throw new RangeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Source-time row count overflowed.');
	return result;
}
