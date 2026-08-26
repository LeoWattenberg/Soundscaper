/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed, hashable settings bodies for every AssistanceWorkflow recipe. */

import {
	normalizeAssistanceWorkflowId,
	type AssistanceAdvancedWorkflowId,
	type AssistanceWorkflowId,
} from './workflow-recipes.ts';

export const ASSISTANCE_WORKFLOW_SETTINGS_VERSION = 1;

interface SettingsBase<Id extends AssistanceWorkflowId> {
	readonly settingsVersion: typeof ASSISTANCE_WORKFLOW_SETTINGS_VERSION;
	readonly workflowId: Id;
}

export type AssistanceWorkflowSettingsV1 =
	| (SettingsBase<'transcribe-captions'> & Readonly<{
		recognizer: 'parakeet' | 'whisper';
		language: 'auto' | 'en';
		englishWhisperAlignment: 'when-installed' | 'off';
	}>)
	| (SettingsBase<'clean-filler-silence'> & Readonly<{
		preset: 'conservative' | 'balanced' | 'aggressive';
	}>)
	| (SettingsBase<'identify-speakers'> & Readonly<{ speakerNames: 'anonymous' }>)
	| (SettingsBase<'enhance-dialogue'> & Readonly<{
		placement: 'project-bin' | 'replace-selection';
	}>)
	| (SettingsBase<'separate-dialogue-music-effects'> & Readonly<{
		placement: 'project-bin' | 'muted-aligned-tracks';
	}>)
	| (SettingsBase<'mark-reactions'> & Readonly<{ threshold: number }>)
	| (SettingsBase<'index-transcript'> & Readonly<{
		chunkTokens: 256;
		overlapTokens: 32;
	}>)
	| (SettingsBase<'detect-beats-tempo'> & Readonly<{
		publishBeatLabels: boolean;
		applyTempoMap: boolean;
	}>)
	| (SettingsBase<'mark-cuts'> & Readonly<{ mode: 'fast' | 'accurate' }>)
	| (SettingsBase<'index-video'> & Readonly<{
		shotMode: 'fast' | 'accurate';
		includeOcr: boolean;
	}>)
	| (SettingsBase<'reframe'> & Readonly<{
		targetAspectWidth: number;
		targetAspectHeight: number;
	}>)
	| (SettingsBase<'make-highlights'> & Readonly<{
		resultCount: number;
		minimumDurationSeconds: 15;
		maximumDurationSeconds: number;
		targetAspectWidth: 9;
		targetAspectHeight: 16;
	}>)
	| (SettingsBase<'generate-editorial-text'> & Readonly<{
		enabled: boolean;
		fields: readonly ('title' | 'hook' | 'chapters' | 'explanation')[];
	}>)
	| (SettingsBase<AssistanceAdvancedWorkflowId> & Readonly<{
		operationSettings: Readonly<Record<string, never>>;
	}>);

type JsonRecord = Record<string, unknown>;
const EDITORIAL_FIELDS = Object.freeze([
	'title', 'hook', 'chapters', 'explanation',
] as const);

export function defaultAssistanceWorkflowSettingsV1(
	workflowIdValue: AssistanceWorkflowId,
): AssistanceWorkflowSettingsV1 {
	const workflowId = normalizeAssistanceWorkflowId(workflowIdValue);
	const base = { settingsVersion: ASSISTANCE_WORKFLOW_SETTINGS_VERSION, workflowId } as const;
	switch (workflowId) {
		case 'transcribe-captions': return Object.freeze({ ...base, workflowId,
			recognizer: 'parakeet', language: 'auto', englishWhisperAlignment: 'when-installed' });
		case 'clean-filler-silence': return Object.freeze({ ...base, workflowId, preset: 'balanced' });
		case 'identify-speakers': return Object.freeze({ ...base, workflowId, speakerNames: 'anonymous' });
		case 'enhance-dialogue': return Object.freeze({ ...base, workflowId, placement: 'project-bin' });
		case 'separate-dialogue-music-effects': return Object.freeze({ ...base, workflowId,
			placement: 'project-bin' });
		case 'mark-reactions': return Object.freeze({ ...base, workflowId, threshold: 0.5 });
		case 'index-transcript': return Object.freeze({ ...base, workflowId,
			chunkTokens: 256, overlapTokens: 32 });
		case 'detect-beats-tempo': return Object.freeze({ ...base, workflowId,
			publishBeatLabels: false, applyTempoMap: false });
		case 'mark-cuts': return Object.freeze({ ...base, workflowId, mode: 'fast' });
		case 'index-video': return Object.freeze({ ...base, workflowId,
			shotMode: 'fast', includeOcr: true });
		case 'reframe': return Object.freeze({ ...base, workflowId,
			targetAspectWidth: 9, targetAspectHeight: 16 });
		case 'make-highlights': return Object.freeze({ ...base, workflowId,
			resultCount: 5, minimumDurationSeconds: 15, maximumDurationSeconds: 60,
			targetAspectWidth: 9, targetAspectHeight: 16 });
		case 'generate-editorial-text': return Object.freeze({ ...base, workflowId,
			enabled: false, fields: EDITORIAL_FIELDS });
		default: return Object.freeze({ ...base, workflowId,
			operationSettings: Object.freeze({}) });
	}
}

export function validateAssistanceWorkflowSettingsV1(
	value: unknown,
	expectedWorkflowId?: AssistanceWorkflowId,
): AssistanceWorkflowSettingsV1 {
	const row = record(value);
	if (row.settingsVersion !== ASSISTANCE_WORKFLOW_SETTINGS_VERSION) {
		throw new TypeError('The assistance workflow settings version is unsupported.');
	}
	const workflowId = normalizeAssistanceWorkflowId(row.workflowId);
	if (expectedWorkflowId !== undefined
		&& workflowId !== normalizeAssistanceWorkflowId(expectedWorkflowId)) {
		throw new TypeError('The assistance workflow settings belong to another workflow.');
	}
	switch (workflowId) {
		case 'transcribe-captions':
			exact(row, ['settingsVersion', 'workflowId', 'recognizer', 'language',
				'englishWhisperAlignment']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				recognizer: oneOf(row.recognizer, ['parakeet', 'whisper'], 'recognizer'),
				language: oneOf(row.language, ['auto', 'en'], 'language'),
				englishWhisperAlignment: oneOf(row.englishWhisperAlignment,
					['when-installed', 'off'], 'English Whisper alignment') });
		case 'clean-filler-silence':
			exact(row, ['settingsVersion', 'workflowId', 'preset']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				preset: oneOf(row.preset, ['conservative', 'balanced', 'aggressive'], 'cleanup preset') });
		case 'identify-speakers':
			exact(row, ['settingsVersion', 'workflowId', 'speakerNames']);
			literal(row.speakerNames, 'anonymous', 'speaker naming');
			return Object.freeze({ settingsVersion: 1, workflowId, speakerNames: 'anonymous' });
		case 'enhance-dialogue':
			exact(row, ['settingsVersion', 'workflowId', 'placement']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				placement: oneOf(row.placement, ['project-bin', 'replace-selection'], 'enhancement placement') });
		case 'separate-dialogue-music-effects':
			exact(row, ['settingsVersion', 'workflowId', 'placement']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				placement: oneOf(row.placement, ['project-bin', 'muted-aligned-tracks'], 'separation placement') });
		case 'mark-reactions':
			exact(row, ['settingsVersion', 'workflowId', 'threshold']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				threshold: finite(row.threshold, 0, 1, 'reaction threshold') });
		case 'index-transcript':
			exact(row, ['settingsVersion', 'workflowId', 'chunkTokens', 'overlapTokens']);
			literal(row.chunkTokens, 256, 'transcript chunk size');
			literal(row.overlapTokens, 32, 'transcript overlap');
			return Object.freeze({ settingsVersion: 1, workflowId, chunkTokens: 256, overlapTokens: 32 });
		case 'detect-beats-tempo':
			exact(row, ['settingsVersion', 'workflowId', 'publishBeatLabels', 'applyTempoMap']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				publishBeatLabels: boolean(row.publishBeatLabels, 'beat-label publication'),
				applyTempoMap: boolean(row.applyTempoMap, 'tempo-map application') });
		case 'mark-cuts':
			exact(row, ['settingsVersion', 'workflowId', 'mode']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				mode: oneOf(row.mode, ['fast', 'accurate'], 'shot-detection mode') });
		case 'index-video':
			exact(row, ['settingsVersion', 'workflowId', 'shotMode', 'includeOcr']);
			return Object.freeze({ settingsVersion: 1, workflowId,
				shotMode: oneOf(row.shotMode, ['fast', 'accurate'], 'video-index shot mode'),
				includeOcr: boolean(row.includeOcr, 'video-index OCR choice') });
		case 'reframe': return reframe(row, workflowId);
		case 'make-highlights': return highlights(row, workflowId);
		case 'generate-editorial-text': return editorial(row, workflowId);
		default: return advanced(row, workflowId);
	}
}

export function serializeAssistanceWorkflowSettingsV1(value: unknown): string {
	return canonicalJson(validateAssistanceWorkflowSettingsV1(value));
}

function reframe(row: JsonRecord, workflowId: 'reframe'): AssistanceWorkflowSettingsV1 {
	exact(row, ['settingsVersion', 'workflowId', 'targetAspectWidth', 'targetAspectHeight']);
	const width = integer(row.targetAspectWidth, 1, 64, 'target aspect width');
	const height = integer(row.targetAspectHeight, 1, 64, 'target aspect height');
	if (width / height < 0.25 || width / height > 4) {
		throw new RangeError('The target aspect is outside the supported 1:4 through 4:1 range.');
	}
	return Object.freeze({ settingsVersion: 1, workflowId,
		targetAspectWidth: width, targetAspectHeight: height });
}

function highlights(row: JsonRecord, workflowId: 'make-highlights'): AssistanceWorkflowSettingsV1 {
	exact(row, ['settingsVersion', 'workflowId', 'resultCount', 'minimumDurationSeconds',
		'maximumDurationSeconds', 'targetAspectWidth', 'targetAspectHeight']);
	literal(row.minimumDurationSeconds, 15, 'highlight minimum duration');
	literal(row.targetAspectWidth, 9, 'highlight target width');
	literal(row.targetAspectHeight, 16, 'highlight target height');
	return Object.freeze({ settingsVersion: 1, workflowId,
		resultCount: integer(row.resultCount, 1, 20, 'highlight result count'),
		minimumDurationSeconds: 15,
		maximumDurationSeconds: integer(row.maximumDurationSeconds, 15, 180,
			'highlight maximum duration'),
		targetAspectWidth: 9, targetAspectHeight: 16 });
}

function editorial(row: JsonRecord, workflowId: 'generate-editorial-text'): AssistanceWorkflowSettingsV1 {
	exact(row, ['settingsVersion', 'workflowId', 'enabled', 'fields']);
	if (!Array.isArray(row.fields) || row.fields.length < 1 || row.fields.length > EDITORIAL_FIELDS.length
		|| new Set(row.fields).size !== row.fields.length
		|| row.fields.some((field) => !EDITORIAL_FIELDS.includes(
			field as typeof EDITORIAL_FIELDS[number],
		))) {
		throw new TypeError('Editorial fields must be a unique bounded known selection.');
	}
	return Object.freeze({ settingsVersion: 1, workflowId,
		enabled: boolean(row.enabled, 'editorial generation'),
		fields: Object.freeze(row.fields as Array<typeof EDITORIAL_FIELDS[number]>) });
}

function advanced(row: JsonRecord, workflowId: AssistanceAdvancedWorkflowId): AssistanceWorkflowSettingsV1 {
	exact(row, ['settingsVersion', 'workflowId', 'operationSettings']);
	const operationSettings = record(row.operationSettings);
	if (Object.keys(operationSettings).length !== 0) {
		throw new TypeError('Advanced operation settings must be empty for operation-v1 recipes.');
	}
	return Object.freeze({ settingsVersion: 1, workflowId,
		operationSettings: Object.freeze({}) });
}

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Assistance workflow settings must be one plain record.');
	}
	return value as JsonRecord;
}

function exact(row: JsonRecord, keys: readonly string[]): void {
	if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))) {
		throw new TypeError('The assistance workflow settings have invalid schema fields.');
	}
}

function literal<T extends string | number>(value: unknown, expected: T, label: string): T {
	if (value !== expected) throw new TypeError(`The ${label} is invalid.`);
	return expected;
}

function oneOf<const T extends readonly string[]>(
	value: unknown, choices: T, label: string,
): T[number] {
	if (typeof value !== 'string' || !choices.includes(value)) throw new TypeError(`The ${label} is invalid.`);
	return value as T[number];
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`The ${label} choice is invalid.`);
	return value;
}

function finite(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`The ${label} is outside its supported range.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is outside its supported range.`);
	}
	return Number(value);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string'
		|| typeof value === 'number') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const row = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
}
