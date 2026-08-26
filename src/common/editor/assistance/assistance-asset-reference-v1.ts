/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';

export const ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1 =
	'application/vnd.soundscaper.assistance-transcript+json' as const;
export const ASSISTANCE_TRANSCRIPT_STORAGE_KEY_PREFIX_V1 =
	'assistance-transcript-sha256:' as const;

export const ASSISTANCE_ASSET_REFERENCE_LIMITS_V1 = Object.freeze({
	maximumAssets: 1_024,
	maximumBodyBytes: 64 * 1024 * 1024,
	maximumIdentifierBytes: 1_024,
	maximumModelArtifacts: 32,
});

export interface AssistanceTranscriptBodyReferenceV1 {
	readonly storageKey: string;
	readonly mimeType: typeof ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface AssistanceTranscriptAssetReferenceV1 {
	readonly id: string;
	readonly kind: 'transcript-v1';
	readonly sourceId: string;
	readonly sourceSha256: string;
	/** First included source sample frame. */
	readonly sourceStartFrame: number;
	/** Exclusive source sample-frame boundary. */
	readonly sourceEndFrame: number;
	/** Required for video sources and forbidden for audio-only sources. */
	readonly sourceVideoTimingSha256: string | null;
	readonly recipeId: string;
	readonly recipeVersion: number;
	readonly modelArtifactSha256s: readonly string[];
	readonly body: Readonly<AssistanceTranscriptBodyReferenceV1>;
}

export type AssistanceAssetReferenceV1 = AssistanceTranscriptAssetReferenceV1;

const ASSET_FIELDS = Object.freeze([
	'id', 'kind', 'sourceId', 'sourceSha256', 'sourceStartFrame', 'sourceEndFrame',
	'sourceVideoTimingSha256', 'recipeId', 'recipeVersion', 'modelArtifactSha256s', 'body',
] as const);
const BODY_FIELDS = Object.freeze(['storageKey', 'mimeType', 'byteLength', 'sha256'] as const);
const SHA256 = /^[a-f0-9]{64}$/u;

/** Normalize the only assistance asset shape admitted by the V1 document domain. */
export function createAssistanceAssetReferenceV1(
	value: unknown,
): Readonly<AssistanceAssetReferenceV1> {
	const record = readClosedDomainRecord(
		value,
		'assistance asset reference',
		ASSET_FIELDS,
		ASSET_FIELDS,
	);
	if (readClosedDomainField(record, 'kind', 'assistance asset reference') !== 'transcript-v1') {
		throw new RangeError('An assistance asset reference must use the transcript-v1 kind.');
	}
	const sourceStartFrame = nonNegativeInteger(
		readClosedDomainField(record, 'sourceStartFrame', 'assistance asset reference'),
		'assistance transcript sourceStartFrame',
	);
	const sourceEndFrame = nonNegativeInteger(
		readClosedDomainField(record, 'sourceEndFrame', 'assistance asset reference'),
		'assistance transcript sourceEndFrame',
	);
	if (sourceEndFrame <= sourceStartFrame) {
		throw new RangeError('An assistance transcript requires a positive half-open source range.');
	}
	return Object.freeze({
		id: boundedText(
			readClosedDomainField(record, 'id', 'assistance asset reference'),
			'assistance asset ID',
		),
		kind: 'transcript-v1',
		sourceId: boundedText(
			readClosedDomainField(record, 'sourceId', 'assistance asset reference'),
			'assistance transcript source ID',
		),
		sourceSha256: digest(
			readClosedDomainField(record, 'sourceSha256', 'assistance asset reference'),
			'assistance transcript source',
		),
		sourceStartFrame,
		sourceEndFrame,
		sourceVideoTimingSha256: optionalDigest(
			readClosedDomainField(record, 'sourceVideoTimingSha256', 'assistance asset reference'),
			'assistance transcript video timing',
		),
		recipeId: boundedText(
			readClosedDomainField(record, 'recipeId', 'assistance asset reference'),
			'assistance transcript recipe ID',
		),
		recipeVersion: positiveInteger(
			readClosedDomainField(record, 'recipeVersion', 'assistance asset reference'),
			'assistance transcript recipe version',
		),
		modelArtifactSha256s: modelArtifactDigests(
			readClosedDomainField(record, 'modelArtifactSha256s', 'assistance asset reference'),
		),
		body: createAssistanceTranscriptBodyReferenceV1(
			readClosedDomainField(record, 'body', 'assistance asset reference'),
		),
	});
}

/** Normalize a transcript body's immutable external-storage identity. */
export function createAssistanceTranscriptBodyReferenceV1(
	value: unknown,
): Readonly<AssistanceTranscriptBodyReferenceV1> {
	const record = readClosedDomainRecord(
		value,
		'assistance transcript body reference',
		BODY_FIELDS,
		BODY_FIELDS,
	);
	const sha256 = digest(
		readClosedDomainField(record, 'sha256', 'assistance transcript body reference'),
		'assistance transcript body',
	);
	const storageKey = `${ASSISTANCE_TRANSCRIPT_STORAGE_KEY_PREFIX_V1}${sha256}`;
	if (readClosedDomainField(record, 'storageKey', 'assistance transcript body reference') !== storageKey) {
		throw new TypeError('An assistance transcript body storage key must be derived from its digest.');
	}
	if (readClosedDomainField(record, 'mimeType', 'assistance transcript body reference')
		!== ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1) {
		throw new RangeError('An assistance transcript body MIME type is unsupported.');
	}
	const byteLength = positiveInteger(
		readClosedDomainField(record, 'byteLength', 'assistance transcript body reference'),
		'assistance transcript body byte length',
	);
	if (byteLength > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes) {
		throw new RangeError('An assistance transcript body exceeds its maximum byte length.');
	}
	return Object.freeze({
		storageKey,
		mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
		byteLength,
		sha256,
	});
}

/** Normalize the bounded, dense project collection and refuse duplicate identities. */
export function normalizeAssistanceAssetReferencesV1(
	value: unknown,
): readonly Readonly<AssistanceAssetReferenceV1>[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('project.assistanceAssets must be a plain array.');
	}
	if (value.length > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumAssets) {
		throw new RangeError('project.assistanceAssets exceeds its maximum count.');
	}
	const values = readClosedDomainArray(
		value,
		'project.assistanceAssets',
		0,
		ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumAssets,
	);
	const result: Readonly<AssistanceAssetReferenceV1>[] = [];
	const ids = new Set<string>();
	for (const value of values) {
		const reference = createAssistanceAssetReferenceV1(value);
		if (ids.has(reference.id)) {
			throw new RangeError(`Duplicate assistance asset ID ${reference.id}.`);
		}
		ids.add(reference.id);
		result.push(reference);
	}
	return Object.freeze(result);
}

/** Bind normalized references to exact persisted source content and geometry. */
export function validateAssistanceAssetSourceBindingsV1(
	assets: readonly Readonly<AssistanceAssetReferenceV1>[],
	sourcesValue: unknown,
): true {
	if (!Array.isArray(sourcesValue)) throw new TypeError('project.sources must be an array.');
	const sources = sourcesValue.map((value, index) => dataRecord(value, `project.sources[${String(index)}]`));
	for (const asset of assets) {
		const source = sources.find((candidate) => data(candidate, 'id', 'project source') === asset.sourceId);
		if (!source) throw new ReferenceError(`Assistance asset ${asset.id} references a missing source.`);
		if (data(source, 'contentSha256', `source ${asset.sourceId}`) !== asset.sourceSha256) {
			throw new RangeError(`Assistance asset ${asset.id} source digest does not match its source.`);
		}
		const kind = data(source, 'kind', `source ${asset.sourceId}`);
		const maximumFrame = kind === 'audio'
			? positiveInteger(data(source, 'frameCount', `source ${asset.sourceId}`), 'audio source frame count')
			: kind === 'video'
				? videoSourceFrameCount(source, asset)
				: null;
		if (maximumFrame === null) throw new RangeError(`Assistance asset ${asset.id} source kind is unsupported.`);
		if (asset.sourceEndFrame > maximumFrame) {
			throw new RangeError(`Assistance asset ${asset.id} source range exceeds source bounds.`);
		}
		validateVideoTimingBinding(source, kind, asset);
	}
	return true;
}

function validateVideoTimingBinding(
	source: Readonly<Record<string, unknown>>,
	kind: unknown,
	asset: Readonly<AssistanceAssetReferenceV1>,
): void {
	if (kind === 'audio') {
		if (asset.sourceVideoTimingSha256 !== null) {
			throw new RangeError('An audio-only source cannot carry an assistance video timing digest.');
		}
		return;
	}
	if (data(source, 'hasAudio', `video source ${asset.sourceId}`) !== true) {
		throw new RangeError(`Assistance transcript source ${asset.sourceId} has no audio.`);
	}
	if (asset.sourceVideoTimingSha256 === null) {
		throw new RangeError('A video-source assistance transcript requires its exact video timing digest.');
	}
	const timing = dataRecord(data(source, 'timingAsset', `video source ${asset.sourceId}`),
		`video source ${asset.sourceId}.timingAsset`);
	if (data(timing, 'sha256', `video source ${asset.sourceId}.timingAsset`)
		!== asset.sourceVideoTimingSha256) {
		throw new RangeError(`Assistance asset ${asset.id} video timing digest does not match its source.`);
	}
}

function videoSourceFrameCount(
	source: Readonly<Record<string, unknown>>,
	asset: Readonly<AssistanceAssetReferenceV1>,
): number {
	return positiveInteger(
		data(source, 'sampleFrameCount', `video source ${asset.sourceId}`),
		'video source sample-frame count',
	);
}

function modelArtifactDigests(value: unknown): readonly string[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Assistance transcript modelArtifactSha256s must be a plain array.');
	}
	const values = readClosedDomainArray(
		value,
		'assistance transcript modelArtifactSha256s',
		1,
		ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumModelArtifacts,
	).map((candidate) => digest(candidate, 'assistance model artifact'));
	if (values.some((candidate, index) => index > 0 && candidate <= values[index - 1]!)) {
		throw new RangeError('Assistance transcript model artifact digests must be sorted and unique.');
	}
	return Object.freeze(values);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function data(record: Readonly<Record<string, unknown>>, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function optionalDigest(value: unknown, name: string): string | null {
	return value === null ? null : digest(value, name);
}

function boundedText(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
		|| new TextEncoder().encode(value).byteLength
			> ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumIdentifierBytes) {
		throw new TypeError(`${name} must be bounded canonical text.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
