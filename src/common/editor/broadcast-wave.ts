/* SPDX-License-Identifier: AGPL-3.0-only */

export const BEXT_FIXED_BODY_BYTES = 602;
export const BEXT_MAX_PAYLOAD_BYTES = 64 * 1024;

const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const LOUDNESS_SENTINEL = 0x7fff;
const LOUDNESS_MAXIMUM = 99.99;
const OFFSETS = Object.freeze({
	description: 0,
	originator: 256,
	originatorReference: 288,
	originationDate: 320,
	originationTime: 330,
	timeReferenceLow: 338,
	timeReferenceHigh: 342,
	version: 346,
	umid: 348,
	loudnessValue: 412,
	loudnessRange: 414,
	maxTruePeakLevel: 416,
	maxMomentaryLoudness: 418,
	maxShortTermLoudness: 420,
	reserved: 422,
});

export type BextVersion = 0 | 1 | 2;
export type BextLoudnessField =
	| 'loudnessValue'
	| 'loudnessRange'
	| 'maxTruePeakLevel'
	| 'maxMomentaryLoudness'
	| 'maxShortTermLoudness';

export interface BextMetadata {
	readonly description: string;
	readonly originator: string;
	readonly originatorReference: string;
	readonly originationDate: string;
	readonly originationTime: string;
	readonly timeReference: string;
	readonly version: BextVersion;
	/** Empty when unset; otherwise a lowercase, zero-padded 64-byte hexadecimal UMID. */
	readonly umid: string;
	readonly loudnessValue: number | null;
	readonly loudnessRange: number | null;
	readonly maxTruePeakLevel: number | null;
	readonly maxMomentaryLoudness: number | null;
	readonly maxShortTermLoudness: number | null;
	/** Coding-history rows separated and terminated by LF in the application model. */
	readonly codingHistory: string;
}

export interface BextMetadataInput {
	readonly description?: string;
	readonly originator?: string;
	readonly originatorReference?: string;
	readonly originationDate?: string;
	readonly originationTime?: string;
	readonly timeReference?: string;
	readonly version?: BextVersion;
	readonly umid?: string;
	readonly loudnessValue?: number | null;
	readonly loudnessRange?: number | null;
	readonly maxTruePeakLevel?: number | null;
	readonly maxMomentaryLoudness?: number | null;
	readonly maxShortTermLoudness?: number | null;
	readonly codingHistory?: string;
}

export type BextWarningCode =
	| 'invalid-ascii'
	| 'invalid-chunk-id'
	| 'invalid-date'
	| 'invalid-line-ending'
	| 'invalid-loudness'
	| 'invalid-padding'
	| 'invalid-time'
	| 'nonzero-reserved'
	| 'payload-too-large'
	| 'truncated-chunk'
	| 'truncated-payload'
	| 'unterminated-coding-history'
	| 'unsupported-version';

export interface BextWarning {
	readonly code: BextWarningCode;
	readonly field?: keyof BextMetadata | 'chunk' | 'reserved';
	readonly message: string;
}

export interface BextParseResult {
	readonly metadata: BextMetadata | null;
	readonly warnings: readonly BextWarning[];
}

export interface BextNormalizationOptions {
	readonly version?: BextVersion;
}

export interface PcmCodingHistoryOptions {
	readonly sampleRate: number;
	readonly bitDepth: number;
	readonly channelCount: number;
	readonly product: string;
}

type ByteInput = Uint8Array | ArrayBuffer | ArrayBufferView;

const TEXT_FIELDS = Object.freeze([
	['description', 256],
	['originator', 32],
	['originatorReference', 32],
] as const);

const LOUDNESS_FIELDS = Object.freeze([
	'loudnessValue',
	'loudnessRange',
	'maxTruePeakLevel',
	'maxMomentaryLoudness',
	'maxShortTermLoudness',
] as const satisfies readonly BextLoudnessField[]);

/**
 * A measured loudness value as this field can carry it, or null when it cannot.
 *
 * Every loudness field is an int16 in 0.01 units with one escape, the 0x7fff
 * "not measured" sentinel that null encodes as, so a measurement outside the
 * field's range is reported as unmeasured rather than written as a number the
 * reader would reject. Meters have floors — a true-peak floor of -120 dBTP is
 * what digital silence reports — and a floor is not a measurement.
 */
export function bextLoudnessOrNull(value: unknown, field: BextLoudnessField): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return value < loudnessMinimum(field) || value > LOUDNESS_MAXIMUM ? null : value;
}

export function normalizeBextMetadata(
	input: BextMetadataInput = {},
	options: BextNormalizationOptions = {},
): BextMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('BEXT metadata must be an object.');
	}
	const version = normalizeVersion(options.version ?? input.version ?? 2);
	const umid = normalizeUmid(input.umid ?? '');
	const loudness = Object.fromEntries(LOUDNESS_FIELDS.map((field) => [
		field,
		normalizeLoudness(input[field] ?? null, field),
	])) as Readonly<Record<BextLoudnessField, number | null>>;
	if (version === 0 && umid) throw new RangeError('BEXT version 0 cannot contain a UMID.');
	if (version < 2 && LOUDNESS_FIELDS.some((field) => loudness[field] != null)) {
		throw new RangeError(`BEXT version ${version} cannot contain loudness metadata.`);
	}
	return Object.freeze({
		description: normalizeFixedText(input.description ?? '', 'description', 256),
		originator: normalizeFixedText(input.originator ?? '', 'originator', 32),
		originatorReference: normalizeFixedText(input.originatorReference ?? '', 'originatorReference', 32),
		originationDate: normalizeDate(input.originationDate ?? ''),
		originationTime: normalizeTime(input.originationTime ?? ''),
		timeReference: normalizeTimeReference(input.timeReference ?? '0'),
		version,
		umid,
		...loudness,
		codingHistory: normalizeCodingHistory(input.codingHistory ?? ''),
	});
}

/** Encode a complete Version 2 `bext` payload, excluding its RIFF chunk header. */
export function encodeBextPayload(input: BextMetadataInput = {}): Uint8Array {
	const metadata = normalizeBextMetadata(input, { version: 2 });
	const codingHistory = encodeCodingHistory(metadata.codingHistory);
	const byteLength = BEXT_FIXED_BODY_BYTES + codingHistory.byteLength;
	if (byteLength > BEXT_MAX_PAYLOAD_BYTES) {
		throw new RangeError('A BEXT payload cannot exceed 64 KiB.');
	}
	const output = new Uint8Array(byteLength);
	const view = dataView(output);
	for (const [field] of TEXT_FIELDS) writeFixedAscii(output, OFFSETS[field], metadata[field]);
	writeFixedAscii(output, OFFSETS.originationDate, metadata.originationDate);
	writeFixedAscii(output, OFFSETS.originationTime, metadata.originationTime);
	const timeReference = BigInt(metadata.timeReference);
	view.setUint32(OFFSETS.timeReferenceLow, Number(timeReference & 0xffff_ffffn), true);
	view.setUint32(OFFSETS.timeReferenceHigh, Number(timeReference >> 32n), true);
	view.setUint16(OFFSETS.version, 2, true);
	if (metadata.umid) output.set(hexBytes(metadata.umid), OFFSETS.umid);
	for (const field of LOUDNESS_FIELDS) writeLoudness(view, OFFSETS[field], metadata[field]);
	output.set(codingHistory, BEXT_FIXED_BODY_BYTES);
	return output;
}

/** Encode a RIFF `bext` chunk, including its header and word-alignment byte. */
export function createRiffBextChunk(input: BextMetadataInput = {}): Uint8Array {
	const payload = encodeBextPayload(input);
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	writeFixedAscii(output, 0, 'bext');
	dataView(output).setUint32(4, payload.byteLength, true);
	output.set(payload, 8);
	return output;
}

export function parseBextPayload(input: ByteInput): BextParseResult {
	const bytes = bytesOf(input);
	const warnings: BextWarning[] = [];
	if (bytes.byteLength > BEXT_MAX_PAYLOAD_BYTES) {
		warn(warnings, 'payload-too-large', 'chunk', 'The BEXT payload exceeds the 64 KiB safety limit.');
		return parseResult(null, warnings);
	}
	if (bytes.byteLength < BEXT_FIXED_BODY_BYTES) {
		warn(warnings, 'truncated-payload', 'chunk', 'The BEXT payload is shorter than its 602-byte fixed body.');
		return parseResult(null, warnings);
	}
	const view = dataView(bytes);
	const rawVersion = view.getUint16(OFFSETS.version, true);
	if (rawVersion > 2) {
		warn(warnings, 'unsupported-version', 'version', `BEXT version ${rawVersion} is unsupported.`);
		return parseResult(null, warnings);
	}
	const version = rawVersion as BextVersion;
	const description = parseFixedAscii(bytes, OFFSETS.description, 256, 'description', warnings);
	const originator = parseFixedAscii(bytes, OFFSETS.originator, 32, 'originator', warnings);
	const originatorReference = parseFixedAscii(
		bytes,
		OFFSETS.originatorReference,
		32,
		'originatorReference',
		warnings,
	);
	const rawDate = parseFixedAscii(bytes, OFFSETS.originationDate, 10, 'originationDate', warnings);
	const rawTime = parseFixedAscii(bytes, OFFSETS.originationTime, 8, 'originationTime', warnings);
	const originationDate = validDate(rawDate) ? rawDate : invalidParsedField(
		rawDate,
		warnings,
		'invalid-date',
		'originationDate',
		'The BEXT origination date is invalid.',
	);
	const originationTime = validTime(rawTime) ? rawTime : invalidParsedField(
		rawTime,
		warnings,
		'invalid-time',
		'originationTime',
		'The BEXT origination time is invalid.',
	);
	const timeReference = (
		(BigInt(view.getUint32(OFFSETS.timeReferenceHigh, true)) << 32n)
		| BigInt(view.getUint32(OFFSETS.timeReferenceLow, true))
	).toString();
	const umid = version >= 1 ? parseUmid(bytes.subarray(OFFSETS.umid, OFFSETS.umid + 64)) : '';
	const loudness = Object.fromEntries(LOUDNESS_FIELDS.map((field) => [
		field,
		version === 2 ? parseLoudness(view, OFFSETS[field], field, warnings) : null,
	])) as Readonly<Record<BextLoudnessField, number | null>>;
	const reservedOffset = version === 0 ? OFFSETS.umid : version === 1 ? OFFSETS.loudnessValue : OFFSETS.reserved;
	if (bytes.subarray(reservedOffset, BEXT_FIXED_BODY_BYTES).some((byte) => byte !== 0)) {
		warn(warnings, 'nonzero-reserved', 'reserved', `BEXT version ${version} contains non-zero reserved bytes.`);
	}
	const codingHistory = parseCodingHistory(bytes.subarray(BEXT_FIXED_BODY_BYTES), warnings);
	const metadata = normalizeBextMetadata({
		description,
		originator,
		originatorReference,
		originationDate,
		originationTime,
		timeReference,
		version,
		umid,
		...loudness,
		codingHistory,
	});
	return parseResult(metadata, warnings);
}

export function parseRiffBextChunk(input: ByteInput): BextParseResult {
	const bytes = bytesOf(input);
	const warnings: BextWarning[] = [];
	if (bytes.byteLength < 8) {
		warn(warnings, 'truncated-chunk', 'chunk', 'The RIFF BEXT chunk header is truncated.');
		return parseResult(null, warnings);
	}
	if (ascii(bytes.subarray(0, 4)) !== 'bext') {
		warn(warnings, 'invalid-chunk-id', 'chunk', 'The RIFF chunk is not a bext chunk.');
		return parseResult(null, warnings);
	}
	const payloadBytes = dataView(bytes).getUint32(4, true);
	if (payloadBytes > BEXT_MAX_PAYLOAD_BYTES) {
		warn(warnings, 'payload-too-large', 'chunk', 'The BEXT payload exceeds the 64 KiB safety limit.');
		return parseResult(null, warnings);
	}
	if (bytes.byteLength < 8 + payloadBytes) {
		warn(warnings, 'truncated-chunk', 'chunk', 'The RIFF BEXT chunk payload is truncated.');
		return parseResult(null, warnings);
	}
	const parsed = parseBextPayload(bytes.subarray(8, 8 + payloadBytes));
	warnings.push(...parsed.warnings);
	if (payloadBytes & 1) {
		if (bytes.byteLength === 8 + payloadBytes) {
			warn(warnings, 'invalid-padding', 'chunk', 'The RIFF BEXT chunk alignment byte is missing.');
		} else if (bytes[8 + payloadBytes] !== 0) {
			warn(warnings, 'invalid-padding', 'chunk', 'The RIFF BEXT chunk alignment byte is non-zero.');
		}
	}
	return parseResult(parsed.metadata, warnings);
}

export function createPcmCodingHistoryRow(options: PcmCodingHistoryOptions): string {
	const sampleRate = positiveInteger(options?.sampleRate, 'sampleRate');
	const bitDepth = positiveInteger(options?.bitDepth, 'bitDepth');
	if (!Number.isInteger(options?.channelCount) || options.channelCount < 1 || options.channelCount > 32) {
		throw new RangeError('PCM CodingHistory channelCount must be from 1 to 32.');
	}
	const product = normalizeFixedText(options.product, 'CodingHistory product', BEXT_MAX_PAYLOAD_BYTES);
	if (!product) throw new RangeError('PCM CodingHistory product cannot be empty.');
	if (product.includes(',')) throw new RangeError('PCM CodingHistory product cannot contain a comma.');
	const mode = options.channelCount === 1 ? 'mono' : options.channelCount === 2 ? 'stereo' : 'multi';
	return `A=PCM,F=${sampleRate},W=${bitDepth},M=${mode},T=${product}\n`;
}

export function appendPcmCodingHistory(
	codingHistory: string,
	options: PcmCodingHistoryOptions,
): string {
	return `${normalizeCodingHistory(codingHistory)}${createPcmCodingHistoryRow(options)}`;
}

function normalizeVersion(value: BextVersion): BextVersion {
	if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('BEXT version must be 0, 1, or 2.');
	return value;
}

function normalizeFixedText(value: string, field: string, maximum: number): string {
	if (typeof value !== 'string') throw new TypeError(`BEXT ${field} must be a string.`);
	if (value.length > maximum) throw new RangeError(`BEXT ${field} must contain at most ${maximum} ASCII characters.`);
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code > 0x7e) throw new RangeError(`BEXT ${field} must contain printable ASCII only.`);
	}
	return value;
}

function normalizeDate(value: string): string {
	if (typeof value !== 'string') throw new TypeError('BEXT origination date must be a string.');
	if (!validDate(value)) throw new RangeError('BEXT origination date must be empty or a valid YYYY-MM-DD-style date.');
	return value;
}

function normalizeTime(value: string): string {
	if (typeof value !== 'string') throw new TypeError('BEXT origination time must be a string.');
	if (!validTime(value)) throw new RangeError('BEXT origination time must be empty or a valid HH:MM:SS-style time.');
	return value;
}

function validDate(value: string): boolean {
	if (!value) return true;
	const match = /^(\d{4})[\x20-\x7e](\d{2})[\x20-\x7e](\d{2})$/u.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12) return false;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day >= 1 && day <= (days[month - 1] ?? 0);
}

function validTime(value: string): boolean {
	if (!value) return true;
	const match = /^(\d{2})[\x20-\x7e](\d{2})[\x20-\x7e](\d{2})$/u.exec(value);
	if (!match) return false;
	return Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3]) <= 59;
}

function normalizeTimeReference(value: string): string {
	if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
		throw new RangeError('BEXT timeReference must be an unsigned 64-bit decimal string.');
	}
	const parsed = BigInt(value);
	if (parsed > UINT64_MAX) throw new RangeError('BEXT timeReference must be an unsigned 64-bit decimal string.');
	return parsed.toString();
}

function normalizeUmid(value: string): string {
	if (typeof value !== 'string') throw new TypeError('BEXT umid must be a hexadecimal string.');
	if (!value) return '';
	const unprefixed = value.trim().replace(/^0x/iu, '');
	if (/[^0-9a-f:\s-]/iu.test(unprefixed)) throw new RangeError('BEXT umid must be hexadecimal.');
	const compact = unprefixed.replace(/[:\s-]/gu, '');
	if (!/^[0-9a-f]+$/iu.test(compact)) throw new RangeError('BEXT umid must be hexadecimal.');
	if (compact.length !== 64 && compact.length !== 128) {
		throw new RangeError('BEXT umid must contain exactly 32 or 64 bytes.');
	}
	const normalized = `${compact.toLowerCase()}${compact.length === 64 ? '0'.repeat(64) : ''}`;
	return /^0+$/u.test(normalized) ? '' : normalized;
}

function normalizeLoudness(value: number | null, field: BextLoudnessField): number | null {
	if (value == null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new RangeError(`BEXT ${field} must be null or a finite number.`);
	}
	const minimum = loudnessMinimum(field);
	if (value < minimum || value > LOUDNESS_MAXIMUM) {
		throw new RangeError(`BEXT ${field} must be between ${minimum.toFixed(2)} and 99.99.`);
	}
	return roundLoudness(value) / 100;
}

function loudnessMinimum(field: BextLoudnessField): number {
	return field === 'loudnessRange' ? 0 : -LOUDNESS_MAXIMUM;
}

function roundLoudness(value: number): number {
	if (value === 0) return 0;
	const magnitude = Math.abs(value) * 100;
	const tolerance = Number.EPSILON * Math.max(1, magnitude) * 4;
	return Math.sign(value) * Math.floor(magnitude + 0.5 + tolerance);
}

function normalizeCodingHistory(value: string): string {
	const normalized = normalizeCodingText(value, 'codingHistory').replace(/\r\n?|\n/gu, '\n');
	return normalized && !normalized.endsWith('\n') ? `${normalized}\n` : normalized;
}

function normalizeCodingText(value: string, field: string): string {
	if (typeof value !== 'string') throw new TypeError(`BEXT ${field} must be a string.`);
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code !== 0x09 && code !== 0x0a && code !== 0x0d && (code < 0x20 || code > 0x7e)) {
			throw new RangeError(`BEXT ${field} must contain ASCII text only.`);
		}
	}
	return value;
}

function encodeCodingHistory(value: string): Uint8Array {
	return asciiBytes(value.replaceAll('\n', '\r\n'));
}

function parseFixedAscii(
	bytes: Uint8Array,
	offset: number,
	length: number,
	field: keyof BextMetadata,
	warnings: BextWarning[],
): string {
	const fieldBytes = bytes.subarray(offset, offset + length);
	const terminator = fieldBytes.indexOf(0);
	const contentLength = terminator < 0 ? length : terminator;
	if (terminator >= 0 && fieldBytes.subarray(terminator + 1).some((byte) => byte !== 0)) {
		warn(warnings, 'invalid-padding', field, `BEXT ${field} has non-zero bytes after its terminator.`);
	}
	let value = '';
	for (let index = 0; index < contentLength; index += 1) {
		const byte = fieldBytes[index] ?? 0;
		if (byte < 0x20 || byte > 0x7e) {
			warn(warnings, 'invalid-ascii', field, `BEXT ${field} contains invalid ASCII bytes.`);
			value += '?';
		} else value += String.fromCharCode(byte);
	}
	return value;
}

function parseUmid(bytes: Uint8Array): string {
	return bytes.every((byte) => byte === 0)
		? ''
		: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseLoudness(
	view: DataView,
	offset: number,
	field: BextLoudnessField,
	warnings: BextWarning[],
): number | null {
	if (view.getUint16(offset, true) === LOUDNESS_SENTINEL) return null;
	const encoded = view.getInt16(offset, true);
	const minimum = field === 'loudnessRange' ? 0 : -9_999;
	if (encoded < minimum || encoded > 9_999) {
		warn(warnings, 'invalid-loudness', field, `BEXT ${field} is outside its valid range and was ignored.`);
		return null;
	}
	return encoded / 100;
}

function parseCodingHistory(bytes: Uint8Array, warnings: BextWarning[]): string {
	let value = '';
	for (let index = 0; index < bytes.byteLength; index += 1) {
		const byte = bytes[index] ?? 0;
		if (byte === 0x0d) {
			if (bytes[index + 1] === 0x0a) index += 1;
			else warn(warnings, 'invalid-line-ending', 'codingHistory', 'BEXT CodingHistory contains a lone CR.');
			value += '\n';
		} else if (byte === 0x0a) {
			warn(warnings, 'invalid-line-ending', 'codingHistory', 'BEXT CodingHistory contains a lone LF.');
			value += '\n';
		} else if (byte === 0x09 || (byte >= 0x20 && byte <= 0x7e)) {
			value += String.fromCharCode(byte);
		} else {
			warn(warnings, 'invalid-ascii', 'codingHistory', 'BEXT CodingHistory contains invalid ASCII bytes.');
			value += '?';
		}
	}
	if (value && !value.endsWith('\n')) {
		warn(
			warnings,
			'unterminated-coding-history',
			'codingHistory',
			'BEXT CodingHistory does not end with CR/LF.',
		);
		return `${value}\n`;
	}
	return value;
}

function invalidParsedField(
	value: string,
	warnings: BextWarning[],
	code: 'invalid-date' | 'invalid-time',
	field: 'originationDate' | 'originationTime',
	message: string,
): string {
	if (value) warn(warnings, code, field, message);
	return '';
}

function writeLoudness(view: DataView, offset: number, value: number | null): void {
	if (value == null) view.setUint16(offset, LOUDNESS_SENTINEL, true);
	else view.setInt16(offset, roundLoudness(value), true);
}

function writeFixedAscii(output: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) output[offset + index] = value.charCodeAt(index);
}

function hexBytes(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function positiveInteger(value: number, field: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`PCM CodingHistory ${field} must be a positive integer.`);
	}
	return value;
}

function bytesOf(value: ByteInput): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	throw new TypeError('BEXT bytes must be a Uint8Array, ArrayBuffer, or buffer view.');
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array): string {
	let value = '';
	for (const byte of bytes) value += String.fromCharCode(byte);
	return value;
}

function asciiBytes(value: string): Uint8Array {
	return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function warn(
	warnings: BextWarning[],
	code: BextWarningCode,
	field: BextWarning['field'],
	message: string,
): void {
	if (warnings.some((warning) => warning.code === code && warning.field === field)) return;
	warnings.push(Object.freeze({ code, field, message }));
}

function parseResult(metadata: BextMetadata | null, warnings: BextWarning[]): BextParseResult {
	return Object.freeze({ metadata, warnings: Object.freeze(warnings.slice()) });
}
