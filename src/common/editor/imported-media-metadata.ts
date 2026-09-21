/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_METADATA_STRING_LENGTH = 65_536;
const MAXIMUM_METADATA_ARRAY_LENGTH = 512;
const MAXIMUM_METADATA_RECORD_KEYS = 1_024;
const MAXIMUM_METADATA_DEPTH = 12;
const MAXIMUM_METADATA_NODES = 8_192;
const MAXIMUM_METADATA_WARNINGS = 256;
const MAXIMUM_METADATA_ATTACHMENTS = 256;
const MAXIMUM_METADATA_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_TOTAL_METADATA_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_METADATA_KEY_LENGTH = 256;
const MAXIMUM_AIFF_CHUNKS = 4_096;
const MAXIMUM_AIFF_METADATA_CHUNK_BYTES = 4 * 1024 * 1024;
const MAC_EPOCH_TO_UNIX_SECONDS = 2_082_844_800;
type JsonScalar = string | number | boolean | null;
export type ImportedMediaMetadataValue = JsonScalar
	| readonly ImportedMediaMetadataValue[]
	| ImportedMediaMetadataRecord;

export interface ImportedMediaMetadataRecord {
	readonly [key: string]: ImportedMediaMetadataValue;
}

export interface ImportedMediaMetadataAttachment {
	readonly path: string;
	readonly kind?: string;
	readonly mimeType?: string;
	readonly name?: string;
	readonly description?: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface ImportedMediaMetadataInspection {
	readonly metadata: Readonly<{
		readonly normalized?: Readonly<Record<string, ImportedMediaMetadataValue>>;
		readonly raw?: Readonly<Record<string, ImportedMediaMetadataValue>>;
		readonly namespaces?: Readonly<Record<string, ImportedMediaMetadataValue>>;
	}>;
	readonly attachments: readonly ImportedMediaMetadataAttachment[];
	readonly warnings: readonly string[];
}

export type ImportedMediaMetadataReader = (
	file: Blob,
	signal?: AbortSignal,
) => Promise<unknown>;

export interface InspectImportedMediaMetadataOptions {
	readonly signal?: AbortSignal;
	/** Test seam; production lazily loads Mediabunny. */
	readonly readTags?: ImportedMediaMetadataReader;
}

interface CanonicalizationContext {
	readonly attachments: ImportedMediaMetadataAttachment[];
	readonly warnings: string[];
	readonly seen: WeakSet<object>;
	nodes: number;
	attachmentBytes: number;
	nodeLimitReported: boolean;
	attachmentLimitReported: boolean;
}

interface AiffInspection {
	readonly tags: Readonly<Record<string, unknown>>;
	readonly namespaces: Readonly<Record<string, unknown>>;
	readonly warnings: readonly string[];
}

export async function inspectImportedMediaMetadata(
	file: Blob,
	options: InspectImportedMediaMetadataOptions = {},
): Promise<ImportedMediaMetadataInspection> {
	options.signal?.throwIfAborted();
	try {
		const aiff = options.readTags ? null : await inspectAiffMetadata(file, options.signal);
		options.signal?.throwIfAborted();
		const tags = aiff?.tags ?? await (options.readTags ?? readMediabunnyMetadataTags)(file, options.signal);
		options.signal?.throwIfAborted();
		return canonicalizeImportedMediaMetadata(tags, aiff?.namespaces, aiff?.warnings);
	} catch (error) {
		options.signal?.throwIfAborted();
		return Object.freeze({
			metadata: Object.freeze({}),
			attachments: Object.freeze([]),
			warnings: Object.freeze([`Metadata inspection failed: ${errorMessage(error)}`]),
		});
	}
}

export async function canonicalizeImportedMediaMetadata(
	value: unknown,
	namespaces: Readonly<Record<string, unknown>> = {},
	initialWarnings: readonly string[] = [],
): Promise<ImportedMediaMetadataInspection> {
	const tags = dataRecord(value);
	if (!tags) throw new TypeError('Media metadata tags must be a data record.');
	const context: CanonicalizationContext = {
		attachments: [],
		warnings: [],
		seen: new WeakSet<object>(),
		nodes: 3,
		attachmentBytes: 0,
		nodeLimitReported: false,
		attachmentLimitReported: false,
	};
	for (const warning of initialWarnings) pushWarning(context, warning);
	const normalized: Record<string, ImportedMediaMetadataValue> = {};
	const normalizedKeys = Object.keys(tags).filter((key) => key !== 'raw' && key !== 'images').sort();
	if (normalizedKeys.length > MAXIMUM_METADATA_RECORD_KEYS) {
		pushWarning(context, `Normalized metadata exceeded ${String(MAXIMUM_METADATA_RECORD_KEYS)} entries and was truncated.`);
	}
	for (const key of normalizedKeys.slice(0, MAXIMUM_METADATA_RECORD_KEYS)) {
		if (!validMetadataKey(key, 'normalized', context)) continue;
		const candidate = ownDataValue(tags, key);
		if (candidate === undefined) continue;
		const canonical = canonicalValue(candidate, `normalized.${key}`, context, 0);
		if (canonical !== undefined) defineRecordValue(normalized, key, canonical);
	}
	const images = Array.isArray(ownDataValue(tags, 'images')) ? ownDataValue(tags, 'images') as unknown[] : [];
	if (images.length > MAXIMUM_METADATA_ARRAY_LENGTH) {
		pushWarning(context, `Metadata images exceeded ${String(MAXIMUM_METADATA_ARRAY_LENGTH)} entries and were truncated.`);
	}
	for (let index = 0; index < Math.min(images.length, MAXIMUM_METADATA_ARRAY_LENGTH); index += 1) {
		await describeBinaryValue(images[index], `images[${String(index)}]`, context);
	}
	const raw = await canonicalizeRawTags(ownDataValue(tags, 'raw'), context);
	const canonicalNamespaces = canonicalValue(namespaces, 'namespaces', context, 0);
	const namespaceRecord = isMetadataRecord(canonicalNamespaces) ? canonicalNamespaces : undefined;
	return Object.freeze({
		metadata: Object.freeze({
			...(Object.keys(normalized).length ? { normalized: Object.freeze(normalized) } : {}),
			...(raw && Object.keys(raw).length ? { raw: Object.freeze(raw) } : {}),
			...(namespaceRecord && Object.keys(namespaceRecord).length
				? { namespaces: Object.freeze(namespaceRecord) }
				: {}),
		}),
		attachments: Object.freeze(context.attachments),
		warnings: Object.freeze(context.warnings),
	});
}

async function readMediabunnyMetadataTags(file: Blob, signal?: AbortSignal): Promise<unknown> {
	signal?.throwIfAborted();
	const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = new Input({
		source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024, useStreamReader: false }),
		formats: ALL_FORMATS,
	});
	try {
		return await input.getMetadataTags();
	} finally {
		input.dispose();
	}
}

async function canonicalizeRawTags(
	value: unknown,
	context: CanonicalizationContext,
): Promise<Record<string, ImportedMediaMetadataValue> | undefined> {
	const record = dataRecord(value);
	if (!record) return undefined;
	const output: Record<string, ImportedMediaMetadataValue> = {};
	for (const key of Object.keys(record).sort().slice(0, MAXIMUM_METADATA_RECORD_KEYS)) {
		if (!validMetadataKey(key, 'raw', context)) continue;
		const candidate = ownDataValue(record, key);
		const path = `raw.${key}`;
		const attachment = await describeBinaryValue(candidate, path, context);
		if (attachment) {
			if (!reserveMetadataNodes(context, 2)) continue;
			defineRecordValue(output, key, Object.freeze({ attachmentPath: attachment.path }));
			continue;
		}
		const canonical = canonicalValue(candidate, path, context, 0);
		if (canonical !== undefined) defineRecordValue(output, key, canonical);
	}
	if (Object.keys(record).length > MAXIMUM_METADATA_RECORD_KEYS) {
		pushWarning(context, `Raw metadata exceeded ${String(MAXIMUM_METADATA_RECORD_KEYS)} entries and was truncated.`);
	}
	return output;
}

async function describeBinaryValue(
	value: unknown,
	path: string,
	context: CanonicalizationContext,
): Promise<ImportedMediaMetadataAttachment | null> {
	const record = dataRecord(value);
	const bytes = value instanceof Uint8Array
		? value
		: ownDataValue(record, 'data') instanceof Uint8Array
			? ownDataValue(record, 'data') as Uint8Array
			: null;
	if (!bytes) return null;
	if (context.attachments.length >= MAXIMUM_METADATA_ATTACHMENTS) {
		if (!context.attachmentLimitReported) {
			context.attachmentLimitReported = true;
			pushWarning(context, `Binary metadata exceeded ${String(MAXIMUM_METADATA_ATTACHMENTS)} attachments and was truncated.`);
		}
		return null;
	}
	const byteLength = bytes.byteLength;
	const exceededBudget = byteLength > MAXIMUM_METADATA_ATTACHMENT_BYTES
		? ['per-attachment', MAXIMUM_METADATA_ATTACHMENT_BYTES] as const
		: byteLength > MAXIMUM_TOTAL_METADATA_ATTACHMENT_BYTES - context.attachmentBytes
			? ['aggregate', MAXIMUM_TOTAL_METADATA_ATTACHMENT_BYTES] as const : null;
	if (exceededBudget) {
		pushWarning(context, `${path} binary metadata attachment was ${String(byteLength)} bytes; the ${exceededBudget[0]} limit of ${String(exceededBudget[1])} bytes omitted it.`);
		return null;
	}
	const mimeType = boundedAttachmentText(
		stringValue(ownDataValue(record, 'mimeType')) ?? 'application/octet-stream',
		256,
		`${path}.mimeType`,
		context,
	);
	const name = boundedOptionalAttachmentText(ownDataValue(record, 'name'), `${path}.name`, context);
	const description = boundedOptionalAttachmentText(
		ownDataValue(record, 'description'), `${path}.description`, context,
	);
	const kindValue = stringValue(ownDataValue(record, 'kind'));
	const kind = kindValue
		? boundedAttachmentText(kindValue, MAXIMUM_METADATA_KEY_LENGTH, `${path}.kind`, context) : undefined;
	const descriptor = Object.freeze({
		path,
		...(kind ? { kind } : {}),
		mimeType,
		...(name ? { name } : {}),
		...(description ? { description } : {}),
		byteLength,
		sha256: await sha256Hex(bytes),
	});
	context.attachmentBytes += byteLength;
	context.attachments.push(descriptor);
	return descriptor;
}

function canonicalValue(
	value: unknown,
	path: string,
	context: CanonicalizationContext,
	depth: number,
): ImportedMediaMetadataValue | undefined {
	if (!reserveMetadataNodes(context, 1)) return undefined;
	if (value === undefined) return undefined;
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		if (value.length <= MAXIMUM_METADATA_STRING_LENGTH) return value;
		pushWarning(context, `${path} exceeded the metadata string limit and was truncated.`);
		return value.slice(0, MAXIMUM_METADATA_STRING_LENGTH);
	}
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return value;
		pushWarning(context, `${path} contained a non-finite number and was omitted.`);
		return undefined;
	}
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	if (value instanceof Uint8Array) return undefined;
	if (!value || typeof value !== 'object') return String(value);
	if (depth >= MAXIMUM_METADATA_DEPTH) {
		pushWarning(context, `${path} exceeded the metadata nesting limit and was omitted.`);
		return undefined;
	}
	if (context.seen.has(value)) {
		pushWarning(context, `${path} contained a circular value and was omitted.`);
		return undefined;
	}
	context.seen.add(value);
	try {
		if (Array.isArray(value)) {
			if (value.length > MAXIMUM_METADATA_ARRAY_LENGTH) {
				pushWarning(context, `${path} exceeded the metadata array limit and was truncated.`);
			}
			return Object.freeze(value.slice(0, MAXIMUM_METADATA_ARRAY_LENGTH).flatMap((candidate, index) => {
				const canonical = canonicalValue(candidate, `${path}[${String(index)}]`, context, depth + 1);
				return canonical === undefined ? [] : [canonical];
			}));
		}
		const record = dataRecord(value);
		if (!record) return undefined;
		const output: Record<string, ImportedMediaMetadataValue> = {};
		const keys = Object.keys(record).sort();
		if (keys.length > MAXIMUM_METADATA_RECORD_KEYS) {
			pushWarning(context, `${path} exceeded the metadata record limit and was truncated.`);
		}
		for (const key of keys.slice(0, MAXIMUM_METADATA_RECORD_KEYS)) {
			if (!validMetadataKey(key, path, context)) continue;
			const canonical = canonicalValue(ownDataValue(record, key), `${path}.${key}`, context, depth + 1);
			if (canonical !== undefined) defineRecordValue(output, key, canonical);
		}
		return Object.freeze(output);
	} finally {
		context.seen.delete(value);
	}
}

function reserveMetadataNodes(context: CanonicalizationContext, count: number): boolean {
	context.nodes += count;
	if (context.nodes <= MAXIMUM_METADATA_NODES) return true;
	if (context.nodeLimitReported) return false;
	context.nodeLimitReported = true;
	pushWarning(context, `Metadata exceeded ${String(MAXIMUM_METADATA_NODES)} values and was truncated.`);
	return false;
}

async function inspectAiffMetadata(file: Blob, signal?: AbortSignal): Promise<AiffInspection | null> {
	if (file.size < 12) return null;
	const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	signal?.throwIfAborted();
	if (ascii(header, 0, 4) !== 'FORM' || !['AIFF', 'AIFC'].includes(ascii(header, 8, 12))) return null;
	const raw: Record<string, unknown> = {};
	const annotations: string[] = [];
	const comments: Readonly<Record<string, unknown>>[] = [];
	const embeddedId3: Record<string, unknown>[] = [];
	const warnings: string[] = [];
	let title: string | undefined;
	let artist: string | undefined;
	let copyright: string | undefined;
	let offset = 12;
	let chunkCount = 0;
	while (offset + 8 <= file.size && chunkCount < MAXIMUM_AIFF_CHUNKS) {
		signal?.throwIfAborted();
		const chunkHeader = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
		const id = ascii(chunkHeader, 0, 4);
		const size = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength).getUint32(4, false);
		const dataStart = offset + 8;
		const dataEnd = Math.min(file.size, dataStart + size);
		if (['NAME', 'AUTH', '(c) ', 'ANNO', 'COMT', 'ID3 '].includes(id)) {
			if (size > MAXIMUM_AIFF_METADATA_CHUNK_BYTES) {
				warnings.push(
					`AIFF ${id.trim()} metadata chunk exceeded ${String(MAXIMUM_AIFF_METADATA_CHUNK_BYTES)} bytes and was omitted.`,
				);
			} else {
				const bytes = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
				if (id === 'ID3 ') {
					const rawKey = Object.hasOwn(raw, id) ? `${id}[${String(chunkCount)}]` : id;
					raw[rawKey] = bytes;
					try {
						const parsed = dataRecord(await readMediabunnyMetadataTags(aiffId3Wave(bytes), signal));
						if (parsed) {
							const id3Index = embeddedId3.length;
							embeddedId3.push(parsed);
							const parsedRaw = dataRecord(ownDataValue(parsed, 'raw'));
							const parsedPrefix = id3Index === 0 ? 'ID3' : `ID3[${String(id3Index)}]`;
							for (const key of Object.keys(parsedRaw ?? {}).sort()) {
								Object.defineProperty(raw, `${parsedPrefix}.${key}`, {
									value: ownDataValue(parsedRaw, key),
									enumerable: true,
									writable: true,
									configurable: true,
								});
							}
						}
					} catch {
						// The complete bounded chunk remains available as a hashed attachment.
					}
				}
				else if (id === 'COMT') comments.push(...parseAiffComments(bytes));
				else {
					const text = decodeAiffText(bytes);
					const rawKey = Object.hasOwn(raw, id) ? `${id}[${String(chunkCount)}]` : id;
					raw[rawKey] = text;
					if (id === 'NAME' && title === undefined) title = text;
					if (id === 'AUTH' && artist === undefined) artist = text;
					if (id === '(c) ' && copyright === undefined) copyright = text;
					if (id === 'ANNO') annotations.push(text);
				}
			}
		}
		const nextOffset = dataStart + size + size % 2;
		if (nextOffset <= offset) break;
		offset = nextOffset;
		chunkCount += 1;
	}
	const firstId3 = embeddedId3[0];
	const normalized = {
		...(title || stringValue(ownDataValue(firstId3 ?? null, 'title'))
			? { title: title ?? stringValue(ownDataValue(firstId3 ?? null, 'title')) } : {}),
		...(artist || stringValue(ownDataValue(firstId3 ?? null, 'artist'))
			? { artist: artist ?? stringValue(ownDataValue(firstId3 ?? null, 'artist')) } : {}),
		...(annotations.length || stringValue(ownDataValue(firstId3 ?? null, 'comment'))
			? { comment: annotations.length
				? annotations.join('\n') : stringValue(ownDataValue(firstId3 ?? null, 'comment')) } : {}),
		raw,
	};
	return Object.freeze({
		tags: Object.freeze(normalized),
			namespaces: Object.freeze({
				aiff: Object.freeze({
				...(copyright ? { copyright } : {}),
				...(annotations.length ? { annotations: Object.freeze(annotations) } : {}),
					...(comments.length ? { comments: Object.freeze(comments) } : {}),
					...(embeddedId3.length ? {
						id3: embeddedId3.length === 1 ? embeddedId3[0] : Object.freeze(embeddedId3),
					} : {}),
				}),
			}),
		warnings: Object.freeze(warnings),
	});
}

/** Wrap an AIFF ID3 payload in the smallest valid WAVE container Mediabunny can inspect. */
function aiffId3Wave(tag: Uint8Array): Blob {
	const paddedTagLength = tag.byteLength + tag.byteLength % 2;
	const id3ChunkLength = 8 + paddedTagLength;
	const bytes = new Uint8Array(12 + 24 + id3ChunkLength + 10);
	const view = new DataView(bytes.buffer);
	writeAscii(bytes, 0, 'RIFF');
	view.setUint32(4, bytes.byteLength - 8, true);
	writeAscii(bytes, 8, 'WAVE');
	writeAscii(bytes, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8_000, true);
	view.setUint32(28, 16_000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(bytes, 36, 'ID3 ');
	view.setUint32(40, tag.byteLength, true);
	bytes.set(tag, 44);
	const dataOffset = 44 + paddedTagLength;
	writeAscii(bytes, dataOffset, 'data');
	view.setUint32(dataOffset + 4, 2, true);
	return new Blob([bytes], { type: 'audio/wav' });
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) {
		bytes[offset + index] = value.charCodeAt(index);
	}
}

function parseAiffComments(bytes: Uint8Array): Readonly<Record<string, unknown>>[] {
	if (bytes.byteLength < 2) return [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint16(0, false);
	const comments: Readonly<Record<string, unknown>>[] = [];
	let offset = 2;
	for (let index = 0; index < count && offset + 8 <= bytes.byteLength; index += 1) {
		const timestamp = view.getUint32(offset, false);
		const markerId = view.getUint16(offset + 4, false);
		const textLength = view.getUint16(offset + 6, false);
		const textStart = offset + 8;
		const textEnd = textStart + textLength;
		if (textEnd > bytes.byteLength) break;
		const unixMilliseconds = (timestamp - MAC_EPOCH_TO_UNIX_SECONDS) * 1_000;
		const date = new Date(unixMilliseconds);
		comments.push(Object.freeze({
			timestamp: Number.isNaN(date.getTime()) ? String(timestamp) : date.toISOString(),
			markerId,
			text: decodeAiffText(bytes.subarray(textStart, textEnd)),
		}));
		offset = textEnd + textLength % 2;
	}
	return comments;
}

function decodeAiffText(bytes: Uint8Array): string {
	return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0+$/u, '').trim();
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digestInput = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(digestInput).set(bytes);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function dataRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function isMetadataRecord(value: ImportedMediaMetadataValue | undefined): value is ImportedMediaMetadataRecord {
	return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object';
}

function ownDataValue(record: Record<string, unknown> | null, key: string): unknown {
	if (!record) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function defineRecordValue(
	record: Record<string, ImportedMediaMetadataValue>,
	key: string,
	value: ImportedMediaMetadataValue,
): void {
	Object.defineProperty(record, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

function validMetadataKey(key: string, path: string, context: CanonicalizationContext): boolean {
	if (key.length > 0 && key.length <= MAXIMUM_METADATA_KEY_LENGTH) return true;
	pushWarning(context, `${path} contained an invalid or overlong key and it was omitted.`);
	return false;
}

function boundedOptionalAttachmentText(
	value: unknown,
	path: string,
	context: CanonicalizationContext,
): string | undefined {
	const text = stringValue(value);
	return text ? boundedAttachmentText(text, MAXIMUM_METADATA_STRING_LENGTH, path, context) : undefined;
}

function boundedAttachmentText(
	value: string,
	maximum: number,
	path: string,
	context: CanonicalizationContext,
): string {
	if (value.length <= maximum) return value;
	pushWarning(context, `${path} exceeded the metadata string limit and was truncated.`);
	return value.slice(0, maximum);
}

function pushWarning(context: CanonicalizationContext, warning: string): void {
	if (context.warnings.length < MAXIMUM_METADATA_WARNINGS - 1) {
		context.warnings.push(warning);
		return;
	}
	if (context.warnings.length === MAXIMUM_METADATA_WARNINGS - 1) {
		context.warnings.push('Additional metadata warnings were omitted.');
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error);
}
