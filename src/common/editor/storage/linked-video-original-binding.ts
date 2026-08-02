/* SPDX-License-Identifier: AGPL-3.0-only */

export const LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION = 1 as const;

export interface LinkedVideoOriginalBinding {
	readonly schemaVersion: typeof LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION;
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly locatorId: string;
	/** Opaque platform snapshot generation; never a filesystem path or URL. */
	readonly locatorRevision: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly sourceShape: LinkedVideoOriginalSourceShape;
	/** Repository-owned compare-and-swap fence for replacing this binding. */
	readonly bindingToken: string;
	readonly boundAt: string;
}

export type LinkedVideoOriginalBindingInput = Omit<
	LinkedVideoOriginalBinding,
	'bindingToken' | 'boundAt'
>;

export interface LinkedVideoOriginalSourceShape {
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
}

const BINDING_FIELDS = Object.freeze([
	'schemaVersion',
	'projectId',
	'sourceId',
	'storageKey',
	'locatorId',
	'locatorRevision',
	'mimeType',
	'byteLength',
	'sha256',
	'sourceShape',
	'bindingToken',
	'boundAt',
] as const);
const BINDING_FIELD_SET: ReadonlySet<string> = new Set(BINDING_FIELDS);
const BINDING_INPUT_FIELDS = Object.freeze(BINDING_FIELDS.filter((field) => (
	field !== 'bindingToken' && field !== 'boundAt'
)) as ReadonlyArray<keyof LinkedVideoOriginalBindingInput>);
const BINDING_INPUT_FIELD_SET: ReadonlySet<string> = new Set(BINDING_INPUT_FIELDS);
const MAXIMUM_ID_CHARACTERS = 256;
const MAXIMUM_MIME_TYPE_CHARACTERS = 128;
const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VIDEO_MIME_TYPE_PATTERN = /^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SOURCE_SHAPE_FIELDS = Object.freeze([
	'frameCount',
	'sampleRate',
	'width',
	'height',
	'frameRate',
	'videoCodec',
	'audioCodec',
	'hasAudio',
] as const);
const SOURCE_SHAPE_FIELD_SET: ReadonlySet<string> = new Set(SOURCE_SHAPE_FIELDS);

/**
 * Snapshots a linked retained-video declaration without retaining a filesystem
 * handle, path, or URL. locatorRevision fences the platform snapshot while
 * bindingToken independently fences repository replacement.
 */
export function normalizeLinkedVideoOriginalBinding(value: unknown): LinkedVideoOriginalBinding {
	const candidate = closedDataRecord(value);
	if (candidate.schemaVersion !== LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION) {
		throw new RangeError('Unsupported linked video original binding schema version.');
	}
	const projectId = boundedIdentity(candidate.projectId, 'projectId');
	const sourceId = boundedIdentity(candidate.sourceId, 'sourceId');
	const storageKey = boundedIdentity(candidate.storageKey, 'storageKey');
	const locatorId = opaqueToken(
		candidate.locatorId,
		'locatorId must be an opaque pathless token, not a path or URL.',
	);
	const locatorRevision = opaqueToken(
		candidate.locatorRevision,
		'locatorRevision must be an opaque platform-generation fence token.',
	);
	const mimeType = videoMimeType(candidate.mimeType);
	const byteLength = positiveSafeInteger(candidate.byteLength);
	const sha256 = contentDigest(candidate.sha256);
	const sourceShape = normalizeLinkedVideoOriginalSourceShape(candidate.sourceShape);
	const bindingToken = opaqueToken(
		candidate.bindingToken,
		'bindingToken must be an opaque repository CAS fence token.',
	);
	const boundAt = canonicalInstant(candidate.boundAt);
	return Object.freeze({
		schemaVersion: LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId,
		sourceId,
		storageKey,
		locatorId,
		locatorRevision,
		mimeType,
		byteLength,
		sha256,
		sourceShape,
		bindingToken,
		boundAt,
	});
}

export function normalizeLinkedVideoOriginalBindingInput(value: unknown): LinkedVideoOriginalBindingInput {
	const candidate = closedDataRecordForFields(
		value,
		BINDING_INPUT_FIELDS,
		BINDING_INPUT_FIELD_SET,
		'Linked video original binding input',
	);
	const normalized = normalizeLinkedVideoOriginalBinding({
		...candidate,
		bindingToken: 'binding_validation_token',
		boundAt: '2000-01-01T00:00:00.000Z',
	});
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = normalized;
	return Object.freeze(input);
}

export function normalizeLinkedVideoOriginalSourceShape(value: unknown): LinkedVideoOriginalSourceShape {
	const candidate = closedDataRecordForFields(
		value,
		SOURCE_SHAPE_FIELDS,
		SOURCE_SHAPE_FIELD_SET,
		'Linked video original source shape',
	);
	return Object.freeze({
		frameCount: positiveSafeIntegerField(candidate.frameCount, 'sourceShape.frameCount'),
		sampleRate: positiveSafeIntegerField(candidate.sampleRate, 'sourceShape.sampleRate'),
		width: positiveSafeIntegerField(candidate.width, 'sourceShape.width'),
		height: positiveSafeIntegerField(candidate.height, 'sourceShape.height'),
		frameRate: positiveFinite(candidate.frameRate, 'sourceShape.frameRate'),
		videoCodec: boundedIdentity(candidate.videoCodec, 'sourceShape.videoCodec'),
		audioCodec: candidate.audioCodec === null
			? null
			: boundedIdentity(candidate.audioCodec, 'sourceShape.audioCodec'),
		hasAudio: requiredBoolean(candidate.hasAudio, 'sourceShape.hasAudio'),
	});
}

function closedDataRecord(value: unknown): Record<string, unknown> {
	return closedDataRecordForFields(value, BINDING_FIELDS, BINDING_FIELD_SET, 'Linked video original binding');
}

function closedDataRecordForFields(
	value: unknown,
	fields: readonly string[],
	fieldSet: ReadonlySet<string>,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fieldSet.has(key))) {
		throw new TypeError(`${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function boundedIdentity(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${field} must be a non-empty canonical string.`);
	}
	if (value.length > MAXIMUM_ID_CHARACTERS) {
		throw new RangeError(`${field} exceeds its character limit.`);
	}
	if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
		throw new TypeError(`${field} must not contain control or formatting characters.`);
	}
	return value;
}

function opaqueToken(value: unknown, message: string): string {
	if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
		throw new TypeError(message);
	}
	return value;
}

function videoMimeType(value: unknown): string {
	if (typeof value !== 'string' || value.length > MAXIMUM_MIME_TYPE_CHARACTERS
		|| !VIDEO_MIME_TYPE_PATTERN.test(value)) {
		throw new TypeError('mimeType must be a canonical video media type without parameters.');
	}
	return value;
}

function positiveSafeInteger(value: unknown): number {
	return positiveSafeIntegerField(value, 'byteLength');
}

function positiveSafeIntegerField(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${field} must be a positive safe integer.`);
	}
	return Number(value);
}

function positiveFinite(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${field} must be positive and finite.`);
	}
	return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${field} must be boolean.`);
	return value;
}

function contentDigest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new TypeError('sha256 must be a lowercase SHA-256 content digest.');
	}
	return value;
}

function canonicalInstant(value: unknown): string {
	if (typeof value !== 'string' || !CANONICAL_INSTANT_PATTERN.test(value)) {
		throw new TypeError('boundAt must be a canonical ISO instant with millisecond precision.');
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
		throw new RangeError('boundAt must identify a valid canonical ISO instant.');
	}
	return value;
}
