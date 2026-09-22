/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical project-owned script for one generated audio source. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../closed-domain-value.ts';
import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	ASSISTANCE_TTS_SCRIPT_BODY_MIME_TYPE_V1,
	ASSISTANCE_TTS_SCRIPT_STORAGE_KEY_PREFIX_V1,
	createAssistanceAssetReferenceV1,
	type AssistanceTtsScriptAssetReferenceV1,
} from './assistance-asset-reference-v1.ts';

export const ASSISTANCE_TTS_SCRIPT_SCHEMA_VERSION_V1 = 1;
export const ASSISTANCE_TTS_SCRIPT_MAXIMUM_TEXT_BYTES_V1 = 1_048_576;

const UTF8 = new TextEncoder();
const DIGEST = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;
const LANGUAGE = /^(?:[abefhijpz]|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,7})$/u;
const BODY_FIELDS = Object.freeze(['schemaVersion', 'sourceId', 'text', 'language', 'voiceId',
	'speed', 'modelId', 'modelVersion', 'artifactSha256s', 'recipe'] as const);
const RECIPE_FIELDS = Object.freeze(['id', 'version'] as const);
const SOURCE_FIELDS = Object.freeze(['sourceId', 'sourceSha256', 'sourceStartFrame',
	'sourceEndFrame'] as const);
const MODEL_FIELDS = Object.freeze(['modelId', 'modelVersion', 'artifactSha256s'] as const);
const REQUEST_FIELDS = Object.freeze(['assetId', 'text', 'language', 'voiceId', 'speed',
	'source', 'model', 'recipe'] as const);

export interface AssistanceTtsScriptBodyV1 {
	readonly schemaVersion: typeof ASSISTANCE_TTS_SCRIPT_SCHEMA_VERSION_V1;
	readonly sourceId: string;
	readonly text: string;
	readonly language: string;
	readonly voiceId: string;
	readonly speed: number;
	readonly modelId: string;
	readonly modelVersion: string;
	readonly artifactSha256s: readonly string[];
	readonly recipe: Readonly<{ readonly id: string; readonly version: number }>;
}

export interface AssistanceTtsScriptBodyPublicationRequestV1 {
	readonly assetId: string;
	readonly text: string;
	readonly language: string;
	readonly voiceId: string;
	readonly speed: number;
	readonly source: Readonly<{
		readonly sourceId: string;
		readonly sourceSha256: string;
		readonly sourceStartFrame: number;
		readonly sourceEndFrame: number;
	}>;
	readonly model: Readonly<{
		readonly modelId: string;
		readonly modelVersion: string;
		readonly artifactSha256s: readonly string[];
	}>;
	readonly recipe: Readonly<{ readonly id: string; readonly version: number }>;
}

export interface AssistanceTtsScriptBodyPublicationV1 {
	readonly reference: Readonly<AssistanceTtsScriptAssetReferenceV1>;
	readonly body: Readonly<AssistanceTtsScriptBodyV1>;
	readonly bytes: Uint8Array<ArrayBuffer>;
}

/** Bind a reviewed script and exact model settings to an already generated audio source. */
export function createAssistanceTtsScriptBodyPublicationV1(
	value: AssistanceTtsScriptBodyPublicationRequestV1,
): AssistanceTtsScriptBodyPublicationV1 {
	const request = readClosedDomainRecord(value, 'TTS script publication', REQUEST_FIELDS, REQUEST_FIELDS);
	const source = readClosedDomainRecord(field(request, 'source', 'TTS script publication'),
		'TTS script source', SOURCE_FIELDS, SOURCE_FIELDS);
	const model = readClosedDomainRecord(field(request, 'model', 'TTS script publication'),
		'TTS script model', MODEL_FIELDS, MODEL_FIELDS);
	const sourceId = identifier(field(source, 'sourceId', 'TTS script source'), 'source ID');
	const sourceSha256 = digest(field(source, 'sourceSha256', 'TTS script source'), 'source');
	const sourceStartFrame = field(source, 'sourceStartFrame', 'TTS script source');
	const sourceEndFrame = field(source, 'sourceEndFrame', 'TTS script source');
	if (sourceStartFrame !== 0 || !Number.isSafeInteger(sourceEndFrame) || Number(sourceEndFrame) < 1) {
		throw new RangeError('A TTS script must bind the full positive generated source range.');
	}
	const body = createAssistanceTtsScriptBodyV1({
		schemaVersion: ASSISTANCE_TTS_SCRIPT_SCHEMA_VERSION_V1,
		sourceId,
		text: field(request, 'text', 'TTS script publication'),
		language: field(request, 'language', 'TTS script publication'),
		voiceId: field(request, 'voiceId', 'TTS script publication'),
		speed: field(request, 'speed', 'TTS script publication'),
		modelId: field(model, 'modelId', 'TTS script model'),
		modelVersion: field(model, 'modelVersion', 'TTS script model'),
		artifactSha256s: field(model, 'artifactSha256s', 'TTS script model'),
		recipe: field(request, 'recipe', 'TTS script publication'),
	});
	const bytes = Uint8Array.from(UTF8.encode(JSON.stringify(body)));
	if (bytes.byteLength > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes) {
		throw new RangeError('A TTS script body exceeds its maximum byte length.');
	}
	const bodySha256 = bytesToHex(sha256(bytes));
	const reference = createAssistanceAssetReferenceV1({
		id: identifier(field(request, 'assetId', 'TTS script publication'), 'asset ID'),
		kind: 'tts-script-v1', sourceId, sourceSha256,
		sourceStartFrame: 0, sourceEndFrame, sourceVideoTimingSha256: null,
		recipeId: body.recipe.id, recipeVersion: body.recipe.version,
		modelArtifactSha256s: body.artifactSha256s,
		body: {
			storageKey: `${ASSISTANCE_TTS_SCRIPT_STORAGE_KEY_PREFIX_V1}${bodySha256}`,
			mimeType: ASSISTANCE_TTS_SCRIPT_BODY_MIME_TYPE_V1,
			byteLength: bytes.byteLength, sha256: bodySha256,
		},
	});
	if (reference.kind !== 'tts-script-v1') throw new TypeError('TTS script publication kind changed.');
	return Object.freeze({ reference, body, bytes });
}

/** Reject noncanonical script bodies before export or import publication. */
export function createAssistanceTtsScriptBodyV1(value: unknown): Readonly<AssistanceTtsScriptBodyV1> {
	const row = readClosedDomainRecord(value, 'TTS script body', BODY_FIELDS, BODY_FIELDS);
	if (field(row, 'schemaVersion', 'TTS script body') !== ASSISTANCE_TTS_SCRIPT_SCHEMA_VERSION_V1) {
		throw new RangeError('A TTS script body schema version is unsupported.');
	}
	const textValue = field(row, 'text', 'TTS script body');
	if (typeof textValue !== 'string' || !textValue.trim()
		|| UTF8.encode(textValue).byteLength > ASSISTANCE_TTS_SCRIPT_MAXIMUM_TEXT_BYTES_V1
		|| /[\p{Cc}\p{Cf}]/u.test(textValue.replace(/\r\n|\n/gu, ''))) {
		throw new TypeError('A TTS script must contain bounded plain text.');
	}
	const language = field(row, 'language', 'TTS script body');
	if (typeof language !== 'string' || !LANGUAGE.test(language)) {
		throw new TypeError('A TTS script language must be a bounded language tag.');
	}
	const speedValue = field(row, 'speed', 'TTS script body');
	if (typeof speedValue !== 'number' || !Number.isFinite(speedValue)
		|| speedValue < 0.25 || speedValue > 4) {
		throw new RangeError('A TTS script speed is out of range.');
	}
	const artifactValues = readClosedDomainArray(field(row, 'artifactSha256s', 'TTS script body'),
		'TTS script model artifacts', 1, ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumModelArtifacts);
	const artifactSha256s = artifactValues.map((candidate) => digest(candidate, 'model artifact'));
	if (artifactSha256s.some((candidate, index) => index > 0 && candidate <= artifactSha256s[index - 1]!)) {
		throw new RangeError('TTS script model artifact digests must be sorted and unique.');
	}
	const recipeRow = readClosedDomainRecord(field(row, 'recipe', 'TTS script body'),
		'TTS script recipe', RECIPE_FIELDS, RECIPE_FIELDS);
	const recipeVersion = field(recipeRow, 'version', 'TTS script recipe');
	if (!Number.isSafeInteger(recipeVersion) || Number(recipeVersion) < 1) {
		throw new RangeError('A TTS script recipe version must be positive.');
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_TTS_SCRIPT_SCHEMA_VERSION_V1,
		sourceId: identifier(field(row, 'sourceId', 'TTS script body'), 'source ID'),
		text: textValue, language,
		voiceId: identifier(field(row, 'voiceId', 'TTS script body'), 'voice ID'),
		speed: speedValue,
		modelId: identifier(field(row, 'modelId', 'TTS script body'), 'model ID'),
		modelVersion: identifier(field(row, 'modelVersion', 'TTS script body'), 'model version'),
		artifactSha256s: Object.freeze(artifactSha256s),
		recipe: Object.freeze({ id: identifier(field(recipeRow, 'id', 'TTS script recipe'), 'recipe ID'),
			version: Number(recipeVersion) }),
	});
}

function field(record: Readonly<Record<string, unknown>>, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
		throw new TypeError(`TTS script ${name} is invalid.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`TTS script ${name} requires a lowercase SHA-256 digest.`);
	}
	return value;
}
