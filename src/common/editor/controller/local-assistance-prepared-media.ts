/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Normalizes the prepared selected media a preparation port hands back.
 *
 * This is controller-owned validation rather than presentation, and it lives here because
 * editor core must stay independent of the presentation modules while both guided and
 * Advanced preparation need it. `assistance/local-assistance-preparation.ts` re-exports
 * it, and borrows the small record primitives below, so its own callers are unaffected.
 */

import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import {
	validateAssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	normalizeLocalAssistanceShotDetectionMode,
	type LocalAssistanceShotDetectionMode,
} from '../assistance/shot-detection-mode.ts';
import type {
	LocalAssistanceInputRole,
	LocalAssistanceOutputRole,
} from '../assistance/local-assistance-bridge.ts';
import type {
	LocalAssistancePreparedInput,
	LocalAssistancePreparedMedia,
	LocalAssistancePreparedOutput,
} from '../assistance/local-assistance-preparation.ts';

interface OperationSpec {
	readonly inputs: readonly LocalAssistanceInputRole[];
	readonly required: readonly (readonly LocalAssistanceInputRole[])[];
	readonly outputs: readonly LocalAssistanceOutputRole[];
}

const OPERATION_SPECS = Object.freeze({
	'voice-activity-detection': spec(['audio'], [['audio']], ['voice-activity']),
	'speech-recognition': spec(['audio'], [['audio']], ['transcript']),
	'word-alignment': spec(['audio', 'transcript'], [['audio'], ['transcript']], ['word-alignment']),
	'speaker-diarization': spec(['audio'], [['audio']], ['speaker-turns']),
	'speech-enhancement': spec(['audio'], [['audio']], ['enhanced-audio']),
	'dereverberation': spec(['audio'], [['audio']], ['enhanced-audio']),
	'source-separation': spec(['audio'], [['audio']], ['separated-audio']),
	'audio-tagging': spec(['audio'], [['audio']], ['audio-tags']),
	'beat-tracking': spec(['audio'], [['audio']], ['beat-grid']),
	'text-embedding': spec(['transcript', 'text'], [['transcript', 'text']], ['embeddings']),
	'image-text-embedding': spec(['frame-pack', 'text'], [['frame-pack', 'text']], ['embeddings']),
	'optical-character-recognition': spec(['frame-pack'], [['frame-pack']], ['recognized-text']),
	'shot-detection': spec(['video', 'frame-pack'], [['video', 'frame-pack']], ['shot-boundaries']),
	'subject-detection': spec(['frame-pack'], [['frame-pack']], ['subject-tracks']),
	'saliency-detection': spec(['frame-pack'], [['frame-pack']], ['saliency-map']),
	'editorial-generation': spec(['editorial-context'], [['editorial-context']], ['editorial-proposal']),
} satisfies Readonly<Record<AssistanceOperation, OperationSpec>>);


const INPUT_MEDIA_TYPES = Object.freeze({
	audio: Object.freeze(['audio/wav', 'audio/x-wav', 'audio/flac']),
	'voice-activity': Object.freeze([
		'application/json', 'application/vnd.soundscaper.voice-activity+json',
	]),
	video: Object.freeze(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']),
	'frame-pack': Object.freeze(['application/vnd.soundscaper.frame-pack']),
	transcript: Object.freeze(['application/json', 'application/vnd.soundscaper.transcript+json']),
	text: Object.freeze(['text/plain']),
	'editorial-context': Object.freeze([
		'application/json', 'application/vnd.soundscaper.editorial-context+json',
	]),
} satisfies Readonly<Record<LocalAssistanceInputRole, readonly string[]>>);
const OUTPUT_MEDIA_TYPES: Readonly<Record<LocalAssistanceOutputRole, readonly string[]>> = Object.freeze({
	'voice-activity': jsonTypes('voice-activity'), transcript: jsonTypes('transcript'),
	'word-alignment': jsonTypes('word-alignment'), 'speaker-turns': jsonTypes('speaker-turns'),
	'enhanced-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'separated-audio': Object.freeze(['audio/wav', 'audio/flac']),
	'audio-tags': jsonTypes('audio-tags'), 'beat-grid': jsonTypes('beat-grid'),
	embeddings: Object.freeze(['application/vnd.soundscaper.embedding-matrix-v1']),
	'recognized-text': jsonTypes('recognized-text'),
	'shot-boundaries': jsonTypes('shot-boundaries'), 'subject-tracks': jsonTypes('subject-tracks'),
	'saliency-map': jsonTypes('saliency-map'), 'editorial-proposal': jsonTypes('editorial-proposal'),
});
const SOURCE_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const MEDIA_TYPE = /^[a-z\d][a-z\d!#$&^_.+-]{0,126}\/[a-z\d][a-z\d!#$&^_.+-]{0,126}$/u;
const MAXIMUM_BYTES = 8 * 1024 * 1024 * 1024;

export function normalizeLocalAssistancePreparedMedia(
	value: unknown,
	expected: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		shotDetectionMode?: LocalAssistanceShotDetectionMode;
	}>,
): LocalAssistancePreparedMedia {
	const hasShotDetectionMode = Boolean(value && typeof value === 'object'
		&& Object.hasOwn(value, 'shotDetectionMode'));
	const record = exactRecord(value, [
		'sourceId', 'operation', 'selectionFence', 'inputs', 'outputs',
		...(hasShotDetectionMode ? ['shotDetectionMode'] : []),
	], 'prepared selected media');
	const sourceId = id(record.sourceId);
	const operation = normalizeAssistanceOperation(record.operation);
	if (sourceId !== expected.sourceId || operation !== expected.operation) {
		throw new TypeError('Prepared selected media does not echo its exact selection.');
	}
	const operationSpec = OPERATION_SPECS[operation];
	const inputs = normalizeInputs(record.inputs, operationSpec);
	const outputs = normalizeOutputs(record.outputs, operationSpec, operation);
	if (hasShotDetectionMode && operation !== 'shot-detection') {
		throw new TypeError('Only shot detection may carry a Mark Cuts mode.');
	}
	if (Object.hasOwn(expected, 'shotDetectionMode') && expected.operation !== 'shot-detection') {
		throw new TypeError('Only shot detection may expect a Mark Cuts mode.');
	}
	if (expected.operation === 'shot-detection' && Object.hasOwn(expected, 'shotDetectionMode')
		&& !hasShotDetectionMode) {
		throw new TypeError('Prepared selected media omitted its exact Mark Cuts mode.');
	}
	const shotDetectionMode = operation === 'shot-detection'
		? (hasShotDetectionMode
			? normalizeLocalAssistanceShotDetectionMode(record.shotDetectionMode)
			: 'fast')
		: undefined;
	const expectedShotDetectionMode = expected.operation === 'shot-detection'
		? (Object.hasOwn(expected, 'shotDetectionMode')
			? normalizeLocalAssistanceShotDetectionMode(expected.shotDetectionMode)
			: 'fast')
		: undefined;
	if (shotDetectionMode !== expectedShotDetectionMode) {
		throw new TypeError('Prepared selected media does not echo its exact Mark Cuts mode.');
	}
	return Object.freeze({ sourceId, operation,
		...(shotDetectionMode === undefined ? {} : { shotDetectionMode }),
		selectionFence: validateAssistanceSelectionFence(record.selectionFence), inputs, outputs });
}


function normalizeInputs(value: unknown, operation: OperationSpec): readonly LocalAssistancePreparedInput[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
		throw new TypeError('Prepared selected media needs bounded Blob inputs.');
	}
	const inputs = value.map((candidate) => {
		const record = exactRecord(candidate, ['role', 'mediaType', 'bytes'], 'prepared input');
		const role = enumValue(record.role, operation.inputs, 'operation input role');
		const mediaType = admittedMediaType(record.mediaType, role, INPUT_MEDIA_TYPES);
		if (!(record.bytes instanceof Blob) || record.bytes.size < 1 || record.bytes.size > MAXIMUM_BYTES) {
			throw new TypeError('Prepared selected media must carry a bounded Blob body.');
		}
		if (record.bytes.type !== '' && record.bytes.type !== mediaType) {
			throw new TypeError('A prepared Blob media type disagrees with its role.');
		}
		return Object.freeze({ role, mediaType, bytes: record.bytes });
	});
	for (const required of operation.required) {
		if (!inputs.some(({ role }) => required.includes(role))) {
			throw new TypeError('Prepared selected media omitted a required operation input.');
		}
	}
	return Object.freeze(inputs);
}

function normalizeOutputs(
	value: unknown,
	operation: OperationSpec,
	operationId: AssistanceOperation,
): readonly LocalAssistancePreparedOutput[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
		throw new TypeError('Prepared selected media needs bounded output reservations.');
	}
	const slots = operationId === 'speech-enhancement'
		? ['enhanced-audio'] as const
		: operationId === 'dereverberation' ? ['dereverberated-audio'] as const
			: operationId === 'source-separation' ? ['dialogue', 'music', 'effects'] as const : null;
	if (slots && value.length !== slots.length) {
		throw new TypeError('Prepared selected media omitted an exact audio publication slot.');
	}
	return Object.freeze(value.map((candidate, index) => {
		const record = exactRecord(candidate,
			slots ? ['slotId', 'role', 'mediaType', 'maximumByteLength']
				: ['role', 'mediaType', 'maximumByteLength'], 'prepared output');
		const role = enumValue(record.role, operation.outputs, 'operation output role');
		if (slots && record.slotId !== slots[index]) {
			throw new TypeError('Prepared audio publication slots must be complete and canonical.');
		}
		return Object.freeze({ ...(slots ? { slotId: slots[index] } : {}), role,
			mediaType: admittedMediaType(record.mediaType, role, OUTPUT_MEDIA_TYPES),
			maximumByteLength: bytes(record.maximumByteLength) });
	}));
}

function spec(
	inputs: readonly LocalAssistanceInputRole[],
	required: readonly (readonly LocalAssistanceInputRole[])[],
	outputs: readonly LocalAssistanceOutputRole[],
): OperationSpec {
	return Object.freeze({ inputs: Object.freeze(inputs),
		required: Object.freeze(required.map((roles) => Object.freeze(roles))), outputs: Object.freeze(outputs) });
}


function jsonTypes(role: LocalAssistanceOutputRole): readonly string[] {
	return Object.freeze(['application/json', `application/vnd.soundscaper.${role}+json`]);
}

function admittedMediaType<Role extends string>(
	value: unknown,
	role: Role,
	admitted: Readonly<Record<Role, readonly string[]>>,
): string {
	if (typeof value !== 'string' || !MEDIA_TYPE.test(value) || !admitted[role].includes(value)) {
		throw new TypeError(`The assistance ${role} role does not admit that media type.`);
	}
	return value;
}

export function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return record;
}

export function id(value: unknown): string {
	if (typeof value !== 'string' || !SOURCE_ID.test(value)) throw new TypeError('A selected-media source id is invalid.');
	return value;
}

export function text(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

export function enumValue<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value as Values[number];
}

export function bytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_BYTES) {
		throw new TypeError('An assistance output byte bound is invalid.');
	}
	return Number(value);
}
