/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned selected-media custody port; it deliberately has no model knowledge. */

import {
	ASSISTANCE_OPERATIONS,
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import type {
	AssistanceAdvancedWorkflowId,
	AssistanceGuidedWorkflowId,
} from '../assistance/workflow-recipes.ts';
import type { AssistanceWorkflowOutputClaimV1 } from '../assistance/workflow.ts';
import type { AssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID,
	LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK,
	normalizeLocalAssistanceShotDetectionMode,
	type LocalAssistanceShotDetectionMode,
} from '../assistance/shot-detection-mode.ts';
import type {
	LocalAssistanceInputRole,
	LocalAssistanceModel,
	LocalAssistanceOutputClaim,
	LocalAssistanceOutputRole,
} from './local-assistance-bridge.ts';
import type {
	LocalAssistanceWorkflowCustodyBridge,
} from './local-assistance-workflow-bridge.ts';
import type { LocalAssistanceOutputReview } from './local-assistance-result-review.ts';
import type {
	LocalAssistanceTranscriptCleanupPreparationRequest,
} from './local-assistance-cleanup.ts';
import type { LocalAssistanceGuidedReviewedResult } from './local-assistance-guided-result-review.ts';

export type LocalAssistanceMediaKind =
	| 'audio' | 'video' | 'frame-pack' | 'transcript' | 'text' | 'editorial-context';

export const LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS = Object.freeze([
	'selected-media-unavailable', 'aggregate-custody-unavailable', 'model-binding-unavailable',
	'source-custody-unavailable', 'transcript-custody-unavailable',
	'derived-custody-unavailable', 'editorial-context-custody-unavailable',
	'timing-authority-unavailable', 'workflow-disabled',
] as const);

export type LocalAssistanceGuidedPreparationUnavailableReason =
	(typeof LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS)[number];

export interface LocalAssistanceSelectedMediaSource {
	readonly sourceId: string;
	readonly label: string;
	readonly mediaKind: LocalAssistanceMediaKind;
	readonly operations: readonly AssistanceOperation[];
}

export interface LocalAssistanceSelectedMediaInventory {
	readonly sources: readonly LocalAssistanceSelectedMediaSource[];
}

export interface LocalAssistancePreparedInput {
	readonly role: LocalAssistanceInputRole;
	readonly mediaType: string;
	readonly bytes: Blob;
}

export interface LocalAssistancePreparedOutput {
	readonly slotId?: 'enhanced-audio' | 'dialogue' | 'music' | 'effects';
	readonly role: LocalAssistanceOutputRole;
	readonly mediaType: string;
	readonly maximumByteLength: number;
}

export interface LocalAssistancePreparedMedia {
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly selectionFence: AssistanceSelectionFence;
	readonly inputs: readonly LocalAssistancePreparedInput[];
	readonly outputs: readonly LocalAssistancePreparedOutput[];
}

export interface LocalAssistanceSelectedMediaPreparationPort {
	listSelectedMedia(): Promise<unknown>;
	prepareSelectedMedia(request: Readonly<{
		sourceId: string;
		operation: AssistanceOperation;
		shotDetectionMode?: LocalAssistanceShotDetectionMode;
		signal?: AbortSignal;
	}>): Promise<unknown>;
	prepareGuidedWorkflow?(request: LocalAssistanceGuidedWorkflowPreparationRequest): Promise<unknown>;
	prepareAdvancedWorkflow?(request: LocalAssistanceAdvancedWorkflowPreparationRequest): Promise<unknown>;
	acceptGuidedWorkflowResult?(request: LocalAssistanceGuidedWorkflowAcceptanceRequest): Promise<unknown>;
	acceptValidatedResult?(request: LocalAssistanceValidatedResultAcceptanceRequest): Promise<void>;
	prepareTranscriptCleanup?(
		request: LocalAssistanceTranscriptCleanupPreparationRequest,
	): Promise<unknown>;
	acceptTranscriptCleanup?(proposalIds: readonly string[]): Promise<void>;
	rejectTranscriptCleanup?(): Promise<void>;
	cancelTranscriptCleanup?(): Promise<void>;
}

export interface LocalAssistanceGuidedWorkflowAcceptanceRequest {
	readonly workflow: unknown;
	readonly reviewedResult: LocalAssistanceGuidedReviewedResult;
	readonly selectedChoiceIds: readonly string[];
	readonly reframeDraft?: unknown;
	readonly highlightDraft?: unknown;
	readonly readOutput: (request: Readonly<{
		readonly jobId: string;
		readonly workflowId: AssistanceGuidedWorkflowId;
		readonly claim: AssistanceWorkflowOutputClaimV1;
	}>) => Promise<Blob>;
}

export interface LocalAssistanceGuidedWorkflowPreparationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceGuidedWorkflowId;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly models: readonly LocalAssistanceModel[];
	readonly custody: LocalAssistanceWorkflowCustodyBridge;
	readonly signal: AbortSignal;
}

export interface LocalAssistanceAdvancedWorkflowPreparationRequest {
	readonly jobId: string;
	readonly workflowId: AssistanceAdvancedWorkflowId;
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly settings: AssistanceWorkflowSettingsV1;
	readonly models: readonly LocalAssistanceModel[];
	readonly custody: LocalAssistanceWorkflowCustodyBridge;
	readonly signal: AbortSignal;
}

export interface LocalAssistanceValidatedResultAcceptanceRequest {
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly LocalAssistanceModel[];
	readonly outputs: readonly Readonly<{
		readonly slotId?: 'enhanced-audio' | 'dialogue' | 'music' | 'effects';
		readonly claim: LocalAssistanceOutputClaim;
		readonly review: LocalAssistanceOutputReview;
		readonly bytes?: Blob;
	}>[];
}

export type LocalAssistanceModelTaskSlot = readonly string[];

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

const MODEL_TASK_SLOTS = Object.freeze({
	'voice-activity-detection': modelTaskSlots(['voice-activity-detection']),
	'speech-recognition': modelTaskSlots(['speech-recognition']),
	'word-alignment': modelTaskSlots(['word-alignment']),
	'speaker-diarization': modelTaskSlots(['speaker-segmentation'], ['speaker-embedding']),
	'speech-enhancement': modelTaskSlots(['speech-enhancement']),
	'source-separation': modelTaskSlots(['source-separation']),
	'audio-tagging': modelTaskSlots(['audio-tagging']),
	'beat-tracking': modelTaskSlots(['beat-tracking']),
	'text-embedding': modelTaskSlots(['text-embedding']),
	'image-text-embedding': modelTaskSlots(['image-text-embedding']),
	'optical-character-recognition': modelTaskSlots(['optical-character-recognition']),
	'shot-detection': modelTaskSlots(),
	'subject-detection': modelTaskSlots(['face-detection'], ['object-detection']),
	'saliency-detection': modelTaskSlots(['saliency-detection']),
	'editorial-generation': modelTaskSlots(['editorial-generation']),
} satisfies Readonly<Record<AssistanceOperation, readonly LocalAssistanceModelTaskSlot[]>>);
const ACCURATE_SHOT_MODEL_TASK_SLOTS = modelTaskSlots([LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_TASK]);
const YUNET_FACE_DETECTION_MODEL_ID = 'yunet-face-detection-2026may';
const DFINE_OBJECT_DETECTION_MODEL_ID = 'dfine-nano-coco';

const MEDIA_KINDS = Object.freeze([
	'audio', 'video', 'frame-pack', 'transcript', 'text', 'editorial-context',
] as const);
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

export function normalizeLocalAssistanceSelectedMediaInventory(
	value: unknown,
): LocalAssistanceSelectedMediaInventory {
	const record = exactRecord(value, ['sources'], 'selected-media inventory');
	if (!Array.isArray(record.sources) || record.sources.length > 128) {
		throw new TypeError('The selected-media source inventory is invalid.');
	}
	const seen = new Set<string>();
	const sources = record.sources.map((candidate) => {
		const source = exactRecord(candidate, ['sourceId', 'label', 'mediaKind', 'operations'], 'selected-media source');
		const sourceId = id(source.sourceId);
		if (seen.has(sourceId)) throw new TypeError('A selected-media source identity is repeated.');
		seen.add(sourceId);
		if (!Array.isArray(source.operations) || source.operations.length < 1
			|| source.operations.length > ASSISTANCE_OPERATIONS.length) {
			throw new TypeError('A selected-media source operation inventory is invalid.');
		}
		const operations = Object.freeze(source.operations.map(normalizeAssistanceOperation));
		if (new Set(operations).size !== operations.length) {
			throw new TypeError('A selected-media source repeats an operation.');
		}
		return Object.freeze({ sourceId, label: text(source.label, 160, 'source label'),
			mediaKind: enumValue(source.mediaKind, MEDIA_KINDS, 'media kind'), operations });
	});
	return Object.freeze({ sources: Object.freeze(sources) });
}

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

export function localAssistanceModelCompatible(
	operation: AssistanceOperation,
	model: LocalAssistanceModel,
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): boolean {
	const slots = operationModelTaskSlots(operation, shotDetectionMode);
	return slots.some((slot) => slot.includes(model.task))
		&& (operation !== 'shot-detection' || model.modelId === LOCAL_ASSISTANCE_TRANSNET_V2_MODEL_ID)
		&& (operation !== 'subject-detection'
			|| model.task === 'face-detection' && model.modelId === YUNET_FACE_DETECTION_MODEL_ID
			|| model.task === 'object-detection' && model.modelId === DFINE_OBJECT_DETECTION_MODEL_ID);
}

export function localAssistanceModelTaskSlots(
	operation: AssistanceOperation,
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): readonly LocalAssistanceModelTaskSlot[] {
	return operationModelTaskSlots(operation, shotDetectionMode);
}

export function localAssistanceOperationModelsAvailable(
	operation: AssistanceOperation,
	models: readonly LocalAssistanceModel[],
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): boolean {
	return operationModelTaskSlots(operation, shotDetectionMode).every(
		(slot) => models.some((model) => slot.includes(model.task)
			&& localAssistanceModelCompatible(operation, model, shotDetectionMode)),
	);
}

export function localAssistanceSelectedModels(
	operation: AssistanceOperation,
	models: readonly LocalAssistanceModel[],
	selectedModelIds: readonly string[],
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): readonly LocalAssistanceModel[] | null {
	const slots = operationModelTaskSlots(operation, shotDetectionMode);
	if (new Set(selectedModelIds).size !== selectedModelIds.length) return null;
	const selected = selectedModelIds.map(
		(modelId) => models.find((model) => model.modelId === modelId) ?? null,
	);
	if (selected.some((model) => model === null)) return null;
	const resolved = selected as readonly LocalAssistanceModel[];
	if (resolved.length !== slots.length || resolved.some(
		(model) => !localAssistanceModelCompatible(operation, model, shotDetectionMode),
	)) return null;
	const ordered: LocalAssistanceModel[] = [];
	for (const slot of slots) {
		const matches = resolved.filter((model) => slot.includes(model.task)
			&& localAssistanceModelCompatible(operation, model, shotDetectionMode));
		if (matches.length !== 1) return null;
		ordered.push(matches[0]!);
	}
	return Object.freeze(ordered);
}

export function assertLocalAssistanceShotDetectionReviewMode(
	mode: LocalAssistanceShotDetectionMode,
	review: LocalAssistanceOutputReview,
): void {
	const detector = mode === 'accurate' ? 'transnetv2' : 'ffmpeg-scdet';
	if (review.kind !== 'shot-boundaries' || review.detector !== detector) {
		throw new TypeError('Mark Cuts returned an output from the opposite detection mode.');
	}
}

function operationModelTaskSlots(
	operation: AssistanceOperation,
	shotDetectionMode?: LocalAssistanceShotDetectionMode,
): readonly LocalAssistanceModelTaskSlot[] {
	if (operation !== 'shot-detection') {
		if (shotDetectionMode !== undefined) throw new TypeError('Only Mark Cuts has a detection mode.');
		return MODEL_TASK_SLOTS[operation];
	}
	const mode = shotDetectionMode === undefined
		? 'fast' : normalizeLocalAssistanceShotDetectionMode(shotDetectionMode);
	return mode === 'accurate' ? ACCURATE_SHOT_MODEL_TASK_SLOTS : MODEL_TASK_SLOTS[operation];
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

function modelTaskSlots(
	...slots: readonly (readonly string[])[]
): readonly LocalAssistanceModelTaskSlot[] {
	return Object.freeze(slots.map((slot) => Object.freeze([...slot])));
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

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
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

function id(value: unknown): string {
	if (typeof value !== 'string' || !SOURCE_ID.test(value)) throw new TypeError('A selected-media source id is invalid.');
	return value;
}

function text(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function enumValue<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`The assistance ${label} is invalid.`);
	}
	return value as Values[number];
}

function bytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_BYTES) {
		throw new TypeError('An assistance output byte bound is invalid.');
	}
	return Number(value);
}
