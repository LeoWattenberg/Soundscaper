/* SPDX-License-Identifier: AGPL-3.0-only */

export const LINKED_ORIGINAL_BINDING_SCHEMA_VERSION = 2 as const;
export const LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION = 1 as const;

export type LinkedOriginalKind = 'audio' | 'video';

interface LinkedOriginalBindingBase<Kind extends LinkedOriginalKind, SourceShape> {
	readonly schemaVersion: typeof LINKED_ORIGINAL_BINDING_SCHEMA_VERSION;
	readonly kind: Kind;
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly locatorId: string;
	/** Opaque platform snapshot generation; never a filesystem path or URL. */
	readonly locatorRevision: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly sourceShape: SourceShape;
	/** Repository-owned compare-and-swap fence for replacing this binding. */
	readonly bindingToken: string;
	readonly boundAt: string;
}

export type LinkedAudioOriginalBinding = LinkedOriginalBindingBase<
	'audio',
	LinkedAudioOriginalSourceShape
>;

export type LinkedVideoOriginalBindingV2 = LinkedOriginalBindingBase<
	'video',
	LinkedVideoOriginalSourceShape
>;

export type LinkedOriginalBinding = LinkedAudioOriginalBinding | LinkedVideoOriginalBindingV2;
export type LinkedOriginalBindingInput =
	| Omit<LinkedAudioOriginalBinding, 'bindingToken' | 'boundAt'>
	| Omit<LinkedVideoOriginalBindingV2, 'bindingToken' | 'boundAt'>;

export interface LinkedAudioOriginalSourceShape {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	/** Canonical project PCM shape, independent of the external container encoding. */
	readonly sampleFormat: 'float32';
	readonly chunkFrames: number;
}

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

export interface LegacyLinkedVideoOriginalBinding {
	readonly schemaVersion: typeof LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION;
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly sourceShape: LinkedVideoOriginalSourceShape;
	readonly bindingToken: string;
	readonly boundAt: string;
}

export type LegacyLinkedVideoOriginalBindingInput = Omit<
	LegacyLinkedVideoOriginalBinding,
	'bindingToken' | 'boundAt'
>;

const BINDING_FIELDS = Object.freeze([
	'schemaVersion',
	'kind',
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
)));
const BINDING_INPUT_FIELD_SET: ReadonlySet<string> = new Set(BINDING_INPUT_FIELDS);
const LEGACY_BINDING_FIELDS = Object.freeze(BINDING_FIELDS.filter((field) => field !== 'kind'));
const LEGACY_BINDING_FIELD_SET: ReadonlySet<string> = new Set(LEGACY_BINDING_FIELDS);
const LEGACY_BINDING_INPUT_FIELDS = Object.freeze(LEGACY_BINDING_FIELDS.filter((field) => (
	field !== 'bindingToken' && field !== 'boundAt'
)));
const LEGACY_BINDING_INPUT_FIELD_SET: ReadonlySet<string> = new Set(LEGACY_BINDING_INPUT_FIELDS);
const MAXIMUM_ID_CHARACTERS = 256;
const MAXIMUM_MIME_TYPE_CHARACTERS = 128;
const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MEDIA_MIME_TYPE_PATTERN = /^(audio|video)\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const AUDIO_SOURCE_SHAPE_FIELDS = Object.freeze([
	'frameCount',
	'channelCount',
	'sampleRate',
	'originalSampleRate',
	'sampleFormat',
	'chunkFrames',
] as const);
const AUDIO_SOURCE_SHAPE_FIELD_SET: ReadonlySet<string> = new Set(AUDIO_SOURCE_SHAPE_FIELDS);
const VIDEO_SOURCE_SHAPE_FIELDS = Object.freeze([
	'frameCount',
	'sampleRate',
	'width',
	'height',
	'frameRate',
	'videoCodec',
	'audioCodec',
	'hasAudio',
] as const);
const VIDEO_SOURCE_SHAPE_FIELD_SET: ReadonlySet<string> = new Set(VIDEO_SOURCE_SHAPE_FIELDS);

/** Normalize current bindings and read legacy schema-v1 rows as video. */
export function normalizeLinkedOriginalBinding(value: unknown): LinkedOriginalBinding {
	const version = dataField(plainRecord(value, 'Linked original binding'), 'schemaVersion');
	if (version === LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION) {
		return linkedOriginalBindingFromLegacyVideo(normalizeLegacyLinkedVideoOriginalBinding(value));
	}
	if (version !== LINKED_ORIGINAL_BINDING_SCHEMA_VERSION) {
		throw new RangeError('Unsupported linked original binding schema version.');
	}
	const candidate = closedDataRecordForFields(
		value,
		BINDING_FIELDS,
		BINDING_FIELD_SET,
		'Linked original binding',
	);
	return normalizeCurrentBinding(candidate);
}

export function normalizeLinkedOriginalBindingInput(value: unknown): LinkedOriginalBindingInput {
	const candidate = closedDataRecordForFields(
		value,
		BINDING_INPUT_FIELDS,
		BINDING_INPUT_FIELD_SET,
		'Linked original binding input',
	);
	const normalized = normalizeCurrentBinding({
		...candidate,
		bindingToken: 'binding_validation_token',
		boundAt: '2000-01-01T00:00:00.000Z',
	});
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = normalized;
	return Object.freeze(input);
}

export function normalizeLegacyLinkedVideoOriginalBinding(
	value: unknown,
): LegacyLinkedVideoOriginalBinding {
	const candidate = closedDataRecordForFields(
		value,
		LEGACY_BINDING_FIELDS,
		LEGACY_BINDING_FIELD_SET,
		'Linked video original binding',
	);
	if (candidate.schemaVersion !== LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION) {
		throw new RangeError('Unsupported linked video original binding schema version.');
	}
	return Object.freeze({
		schemaVersion: LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		...normalizeSharedFields(candidate, 'video'),
		sourceShape: normalizeLinkedVideoOriginalSourceShape(candidate.sourceShape),
		bindingToken: opaqueToken(
			candidate.bindingToken,
			'bindingToken must be an opaque repository CAS fence token.',
		),
		boundAt: canonicalInstant(candidate.boundAt),
	});
}

export function normalizeLegacyLinkedVideoOriginalBindingInput(
	value: unknown,
): LegacyLinkedVideoOriginalBindingInput {
	const candidate = closedDataRecordForFields(
		value,
		LEGACY_BINDING_INPUT_FIELDS,
		LEGACY_BINDING_INPUT_FIELD_SET,
		'Linked video original binding input',
	);
	const normalized = normalizeLegacyLinkedVideoOriginalBinding({
		...candidate,
		bindingToken: 'binding_validation_token',
		boundAt: '2000-01-01T00:00:00.000Z',
	});
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = normalized;
	return Object.freeze(input);
}

export function linkedOriginalBindingFromLegacyVideo(
	value: LegacyLinkedVideoOriginalBinding,
): LinkedVideoOriginalBindingV2 {
	const legacy = normalizeLegacyLinkedVideoOriginalBinding(value);
	const { schemaVersion: _schemaVersion, ...fields } = legacy;
	return Object.freeze({
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'video',
		...fields,
	});
}

export function legacyLinkedVideoOriginalBindingFromLinkedOriginal(
	value: LinkedOriginalBinding,
): LegacyLinkedVideoOriginalBinding {
	const binding = normalizeLinkedOriginalBinding(value);
	if (binding.kind !== 'video') {
		throw new TypeError('A linked audio original cannot be exposed through the linked video API.');
	}
	const { schemaVersion: _schemaVersion, kind: _kind, ...fields } = binding;
	return Object.freeze({
		schemaVersion: LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		...fields,
	});
}

export function normalizeLinkedAudioOriginalSourceShape(value: unknown): LinkedAudioOriginalSourceShape {
	const candidate = closedDataRecordForFields(
		value,
		AUDIO_SOURCE_SHAPE_FIELDS,
		AUDIO_SOURCE_SHAPE_FIELD_SET,
		'Linked audio original source shape',
	);
	if (candidate.sampleFormat !== 'float32') {
		throw new TypeError('sourceShape.sampleFormat must be canonical float32 project PCM.');
	}
	return Object.freeze({
		frameCount: positiveSafeIntegerField(candidate.frameCount, 'sourceShape.frameCount'),
		channelCount: positiveSafeIntegerField(candidate.channelCount, 'sourceShape.channelCount'),
		sampleRate: positiveSafeIntegerField(candidate.sampleRate, 'sourceShape.sampleRate'),
		originalSampleRate: positiveSafeIntegerField(
			candidate.originalSampleRate,
			'sourceShape.originalSampleRate',
		),
		sampleFormat: 'float32',
		chunkFrames: positiveSafeIntegerField(candidate.chunkFrames, 'sourceShape.chunkFrames'),
	});
}

export function normalizeLinkedVideoOriginalSourceShape(value: unknown): LinkedVideoOriginalSourceShape {
	const candidate = closedDataRecordForFields(
		value,
		VIDEO_SOURCE_SHAPE_FIELDS,
		VIDEO_SOURCE_SHAPE_FIELD_SET,
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

function normalizeCurrentBinding(candidate: Record<string, unknown>): LinkedOriginalBinding {
	if (candidate.schemaVersion !== LINKED_ORIGINAL_BINDING_SCHEMA_VERSION) {
		throw new RangeError('Unsupported linked original binding schema version.');
	}
	const kind = linkedOriginalKind(candidate.kind);
	const shared = normalizeSharedFields(candidate, kind);
	const owned = {
		bindingToken: opaqueToken(
			candidate.bindingToken,
			'bindingToken must be an opaque repository CAS fence token.',
		),
		boundAt: canonicalInstant(candidate.boundAt),
	};
	return kind === 'audio'
		? Object.freeze({
			schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
			kind,
			...shared,
			sourceShape: normalizeLinkedAudioOriginalSourceShape(candidate.sourceShape),
			...owned,
		})
		: Object.freeze({
			schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
			kind,
			...shared,
			sourceShape: normalizeLinkedVideoOriginalSourceShape(candidate.sourceShape),
			...owned,
		});
}

function normalizeSharedFields(candidate: Record<string, unknown>, kind: LinkedOriginalKind) {
	return {
		projectId: boundedIdentity(candidate.projectId, 'projectId'),
		sourceId: boundedIdentity(candidate.sourceId, 'sourceId'),
		storageKey: boundedIdentity(candidate.storageKey, 'storageKey'),
		locatorId: opaqueToken(
			candidate.locatorId,
			'locatorId must be an opaque pathless token, not a path or URL.',
		),
		locatorRevision: opaqueToken(
			candidate.locatorRevision,
			'locatorRevision must be an opaque platform-generation fence token.',
		),
		mimeType: mediaMimeType(candidate.mimeType, kind),
		byteLength: positiveSafeIntegerField(candidate.byteLength, 'byteLength'),
		sha256: contentDigest(candidate.sha256),
	};
}

function linkedOriginalKind(value: unknown): LinkedOriginalKind {
	if (value !== 'audio' && value !== 'video') {
		throw new TypeError('kind must be audio or video.');
	}
	return value;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${label} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function closedDataRecordForFields(
	value: unknown,
	fields: readonly string[],
	fieldSet: ReadonlySet<string>,
	label: string,
): Record<string, unknown> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fieldSet.has(key))) {
		throw new TypeError(`${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) output[field] = dataField(record, field);
	return output;
}

function dataField(record: Record<string, unknown>, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Linked original ${field} must be an enumerable data field.`);
	}
	return descriptor.value;
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

function mediaMimeType(value: unknown, kind: LinkedOriginalKind): string {
	if (typeof value !== 'string' || value.length > MAXIMUM_MIME_TYPE_CHARACTERS
		|| !MEDIA_MIME_TYPE_PATTERN.test(value) || !value.startsWith(`${kind}/`)) {
		throw new TypeError(`mimeType must be a canonical ${kind} media type without parameters.`);
	}
	return value;
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
