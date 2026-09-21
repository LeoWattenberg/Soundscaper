/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict pathless data authority kept beside, but backward-compatible with, workflow-v1. */

import {
	assistanceWorkflowStageGraph,
	normalizeAssistanceWorkflowId,
	type AssistanceWorkflowId,
	type AssistanceWorkflowInputClaimV1,
	type AssistanceWorkflowOutputClaimV1,
} from './workflow.ts';
import {
	LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES,
	LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES,
	localAssistanceJsonMediaTypes,
} from './local-assistance-media-contract.ts';

export const ASSISTANCE_WORKFLOW_CUSTODY_VERSION = 1;

export interface AssistanceWorkflowCustodyProducerV1 {
	readonly stageId: string;
	readonly slotId: string;
	readonly claimId: string;
}

export interface AssistanceWorkflowCustodyClaimV1 {
	readonly custodyVersion: typeof ASSISTANCE_WORKFLOW_CUSTODY_VERSION;
	readonly workflowId: AssistanceWorkflowId;
	readonly direction: 'input' | 'output';
	readonly jobId: string;
	readonly stageId: string;
	readonly slotId: string;
	readonly claimId: string;
	readonly role: AssistanceWorkflowCustodyRole;
	readonly mediaType: string;
	readonly byteLength: number | null;
	readonly sha256: string | null;
	readonly maximumByteLength: number | null;
	readonly producer: AssistanceWorkflowCustodyProducerV1 | null;
}

export type AssistanceWorkflowCustodyRole = typeof OUTPUT_SPECS[keyof typeof OUTPUT_SPECS]['role']
	| keyof typeof EXTERNAL_INPUT_SPECS
	| typeof HIGHLIGHT_GATHER_INPUT_SPECS[keyof typeof HIGHLIGHT_GATHER_INPUT_SPECS]['role'];

interface SlotMediaSpec {
	readonly role: string;
	readonly mediaTypes: readonly string[];
}

const EXTERNAL_INPUT_SPECS = Object.freeze({
	audio: spec('audio', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES.audio),
	'voice-activity': spec('voice-activity', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES['voice-activity']),
	video: spec('video', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES.video),
	'video-authority': spec('video-authority', localAssistanceJsonMediaTypes('video-authority')),
	'frame-pack': spec('frame-pack', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES['frame-pack']),
	transcript: spec('transcript', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES.transcript),
	text: spec('text', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES.text),
	'editorial-context': spec('editorial-context', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES['editorial-context']),
	'shot-boundaries': spec('shot-boundaries', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['shot-boundaries']),
	// Recognised text comes from an optional stage that a required one consumes, so a
	// workflow that skips OCR supplies it from outside - the same reason shot boundaries
	// appear here as well as among the outputs.
	'recognized-text': spec('recognized-text', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['recognized-text']),
	'reaction-ranges': spec('reaction-ranges', localAssistanceJsonMediaTypes('reaction-ranges')),
	embeddings: spec('embeddings', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES.embeddings),
});

const HIGHLIGHT_GATHER_INPUT_SPECS = Object.freeze({
	video: spec('highlight-video-signals', [
		'application/vnd.soundscaper.highlight-video-signals+json',
	]),
	audio: spec('highlight-audio-signals', [
		'application/vnd.soundscaper.highlight-audio-signals+json',
	]),
	transcript: spec('highlight-transcript-signals', [
		'application/vnd.soundscaper.highlight-transcript-signals+json',
	]),
});

const OUTPUT_SPECS = Object.freeze({
	'voice-activity': spec('voice-activity', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['voice-activity']),
	transcript: spec('transcript', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES.transcript),
	'word-alignment': spec('word-alignment', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['word-alignment']),
	captions: spec('captions', localAssistanceJsonMediaTypes('captions')),
	'cleanup-proposals': spec('cleanup-proposals', localAssistanceJsonMediaTypes('cleanup-proposals')),
	'speaker-turns': spec('speaker-turns', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['speaker-turns']),
	'attributed-transcript': spec('attributed-transcript', localAssistanceJsonMediaTypes('attributed-transcript')),
	'enhanced-audio': spec('enhanced-audio', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['enhanced-audio']),
	'dereverberated-audio': spec('enhanced-audio', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['enhanced-audio']),
	dialogue: spec('separated-audio', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['separated-audio']),
	music: spec('separated-audio', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['separated-audio']),
	effects: spec('separated-audio', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['separated-audio']),
	'audio-tags': spec('audio-tags', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['audio-tags']),
	'reaction-ranges': spec('reaction-ranges', localAssistanceJsonMediaTypes('reaction-ranges')),
	'text-chunks': spec('text-chunks', localAssistanceJsonMediaTypes('text-chunks')),
	embeddings: spec('embeddings', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES.embeddings),
	'transcript-index': spec('transcript-index', localAssistanceJsonMediaTypes('transcript-index')),
	'beat-grid': spec('beat-grid', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['beat-grid']),
	'beat-labels': spec('beat-labels', localAssistanceJsonMediaTypes('beat-labels')),
	'tempo-map-diff': spec('tempo-map-diff', localAssistanceJsonMediaTypes('tempo-map-diff')),
	'shot-boundaries': spec('shot-boundaries', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['shot-boundaries']),
	'cut-proposals': spec('cut-proposals', localAssistanceJsonMediaTypes('cut-proposals')),
	'frame-pack': spec('frame-pack', LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES['frame-pack']),
	'visual-embeddings': spec('embeddings', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES.embeddings),
	'recognized-text': spec('recognized-text', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['recognized-text']),
	'video-index': spec('video-index', localAssistanceJsonMediaTypes('video-index')),
	'subject-tracks': spec('subject-tracks', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['subject-tracks']),
	'saliency-map': spec('saliency-map', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['saliency-map']),
	'tracked-subjects': spec('tracked-subjects', localAssistanceJsonMediaTypes('tracked-subjects')),
	'reframe-path': spec('reframe-path', localAssistanceJsonMediaTypes('reframe-path')),
	'highlight-signals': spec('highlight-signals', localAssistanceJsonMediaTypes('highlight-signals')),
	'highlight-candidates': spec('highlight-candidates', localAssistanceJsonMediaTypes('highlight-candidates')),
	'editorial-proposal': spec('editorial-proposal', LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['editorial-proposal']),
	'highlight-proposals': spec('highlight-proposals', localAssistanceJsonMediaTypes('highlight-proposals')),
});

const CLAIM_KEYS = Object.freeze([
	'custodyVersion', 'workflowId', 'direction', 'jobId', 'stageId', 'slotId', 'claimId',
	'role', 'mediaType', 'byteLength', 'sha256', 'maximumByteLength', 'producer',
]);
const PRODUCER_KEYS = Object.freeze(['stageId', 'slotId', 'claimId']);
const ID = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const SLOT = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const MAXIMUM_BYTES = 16 * 1024 ** 4;

export function createAssistanceWorkflowCustodyClaimV1(
	value: Omit<AssistanceWorkflowCustodyClaimV1, 'role' | 'mediaType' | 'producer'>
		& Partial<Pick<AssistanceWorkflowCustodyClaimV1, 'role' | 'mediaType' | 'producer'>>,
): AssistanceWorkflowCustodyClaimV1 {
	const outputSpec = value.direction === 'output'
		? assistanceWorkflowCustodySlotSpec(value.workflowId, value.stageId, 'output', value.slotId)
		: value.producer
			? assistanceWorkflowCustodySlotSpec(
				value.workflowId, value.producer.stageId, 'output', value.producer.slotId,
			)
			: assistanceWorkflowCustodySlotSpec(value.workflowId, value.stageId, 'input', value.slotId);
	return validateAssistanceWorkflowCustodyClaimV1({ ...value, producer: value.producer ?? null,
		role: value.role ?? outputSpec.role,
		mediaType: value.mediaType ?? outputSpec.mediaTypes[0],
	});
}

export function validateAssistanceWorkflowCustodyClaimV1(
	value: unknown,
): AssistanceWorkflowCustodyClaimV1 {
	const row = exactRecord(value, CLAIM_KEYS, 'workflow custody claim');
	if (row.custodyVersion !== ASSISTANCE_WORKFLOW_CUSTODY_VERSION) {
		throw new TypeError('The workflow custody version is unsupported.');
	}
	const workflowId = normalizeAssistanceWorkflowId(row.workflowId);
	const direction = enumValue(row.direction, ['input', 'output'] as const, 'custody direction');
	const jobId = opaqueId(row.jobId, 'job');
	const claimId = opaqueId(row.claimId, 'claim');
	const stageId = slotId(row.stageId, 'stage');
	const claimSlotId = slotId(row.slotId, 'slot');
	const producer = row.producer === null ? null : validateProducer(row.producer);
	let expected: SlotMediaSpec;
	if (direction === 'output') {
		if (producer !== null || row.byteLength !== null || row.sha256 !== null) {
			throw new TypeError('A workflow output custody claim must be one unresolved reservation.');
		}
		expected = assistanceWorkflowCustodySlotSpec(workflowId, stageId, direction, claimSlotId);
	} else if (producer === null) {
		if (row.maximumByteLength !== null) {
			throw new TypeError('An external workflow input cannot carry an output reservation.');
		}
		expected = externalInputSpec(workflowId, stageId, claimSlotId);
	} else {
		assertProducer(workflowId, stageId, claimSlotId, claimId, producer);
		if (row.byteLength !== null || row.sha256 !== null) {
			throw new TypeError('An intermediate workflow input is authenticated after its producer.');
		}
		expected = assistanceWorkflowCustodySlotSpec(
			workflowId, producer.stageId, 'output', producer.slotId,
		);
	}
	const role = enumText(row.role, expected.role, 'custody role') as AssistanceWorkflowCustodyRole;
	const mediaType = admittedMediaType(row.mediaType, expected.mediaTypes);
	const maximumByteLength = row.maximumByteLength === null
		? null : positiveBytes(row.maximumByteLength, 'maximum byte length');
	const byteLength = row.byteLength === null ? null : positiveBytes(row.byteLength, 'byte length');
	const sha256 = row.sha256 === null ? null : digest(row.sha256);
	if (direction === 'output' && maximumByteLength === null) {
		throw new TypeError('A workflow output needs one exact bounded reservation.');
	}
	if (direction === 'input' && producer === null && (byteLength === null || sha256 === null)) {
		throw new TypeError('An external workflow input needs its exact length and digest.');
	}
	if (direction === 'input' && producer !== null && maximumByteLength === null) {
		throw new TypeError('An intermediate workflow input must bind its producer reservation.');
	}
	return Object.freeze({ custodyVersion: ASSISTANCE_WORKFLOW_CUSTODY_VERSION,
		workflowId, direction, jobId, stageId, slotId: claimSlotId, claimId, role,
		mediaType, byteLength, sha256, maximumByteLength, producer });
}

export function workflowClaimFromCustodyV1(
	value: unknown,
): AssistanceWorkflowInputClaimV1 | AssistanceWorkflowOutputClaimV1 {
	const claim = validateAssistanceWorkflowCustodyClaimV1(value);
	return Object.freeze({ claimVersion: 1, direction: claim.direction, claimId: claim.claimId,
		jobId: claim.jobId, stageId: claim.stageId, slotId: claim.slotId }) as
		AssistanceWorkflowInputClaimV1 | AssistanceWorkflowOutputClaimV1;
}

export function assistanceWorkflowCustodySlotSpec(
	workflowIdValue: unknown,
	stageIdValue: unknown,
	direction: 'input' | 'output',
	slotIdValue: unknown,
): SlotMediaSpec {
	const workflowId = normalizeAssistanceWorkflowId(workflowIdValue);
	const stageId = slotId(stageIdValue, 'stage');
	const requestedSlot = slotId(slotIdValue, 'slot');
	const stage = assistanceWorkflowStageGraph(workflowId).find((candidate) => candidate.stageId === stageId);
	const admitted = direction === 'input' ? stage?.inputSlots : stage?.outputSlots;
	if (!stage || !admitted?.some(({ slotId: candidate }) => candidate === requestedSlot)) {
		throw new TypeError(`The workflow stage does not admit that ${direction} custody slot.`);
	}
	const highlightGatherInput = direction === 'input' && workflowId === 'make-highlights'
		&& stageId === 'gather-signals'
		? HIGHLIGHT_GATHER_INPUT_SPECS[requestedSlot as keyof typeof HIGHLIGHT_GATHER_INPUT_SPECS]
		: undefined;
	const candidate = highlightGatherInput ?? (direction === 'output'
		? OUTPUT_SPECS[requestedSlot as keyof typeof OUTPUT_SPECS]
		: EXTERNAL_INPUT_SPECS[requestedSlot as keyof typeof EXTERNAL_INPUT_SPECS]);
	if (!candidate) throw new TypeError('That workflow slot has no direct external custody format.');
	return candidate;
}

function externalInputSpec(
	workflowId: AssistanceWorkflowId, stageId: string, inputSlotId: string,
): SlotMediaSpec {
	return assistanceWorkflowCustodySlotSpec(workflowId, stageId, 'input', inputSlotId);
}

function assertProducer(
	workflowId: AssistanceWorkflowId,
	consumerStageId: string,
	consumerSlotId: string,
	claimId: string,
	producer: AssistanceWorkflowCustodyProducerV1,
): void {
	const graph = assistanceWorkflowStageGraph(workflowId);
	const consumerIndex = graph.findIndex(({ stageId }) => stageId === consumerStageId);
	const producerIndex = graph.findIndex(({ stageId }) => stageId === producer.stageId);
	const consumer = graph[consumerIndex];
	if (consumerIndex < 0 || producerIndex < 0 || producerIndex >= consumerIndex
		|| producer.slotId !== consumerSlotId || producer.claimId !== claimId
		|| !consumer?.inputSlots.some(({ slotId }) => slotId === consumerSlotId)) {
		throw new TypeError('Intermediate custody must name one exact earlier producer claim for the same slot.');
	}
	assistanceWorkflowCustodySlotSpec(workflowId, producer.stageId, 'output', producer.slotId);
}

function validateProducer(value: unknown): AssistanceWorkflowCustodyProducerV1 {
	const row = exactRecord(value, PRODUCER_KEYS, 'workflow custody producer');
	return Object.freeze({ stageId: slotId(row.stageId, 'producer stage'),
		slotId: slotId(row.slotId, 'producer slot'), claimId: opaqueId(row.claimId, 'producer claim') });
}

function spec(role: string, mediaTypes: readonly string[]): SlotMediaSpec {
	return Object.freeze({ role, mediaTypes: Object.freeze([...mediaTypes]) });
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	if (Object.keys(row).length !== keys.length || Object.keys(row).some((key) => !keys.includes(key))) {
		throw new TypeError(`The ${label} schema fields are invalid.`);
	}
	return row;
}

function slotId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SLOT.test(value)) throw new TypeError(`The workflow custody ${label} is invalid.`);
	return value;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The workflow custody ${label} ID is invalid.`);
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError('The workflow custody digest is invalid.');
	return value;
}

function positiveBytes(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAXIMUM_BYTES) {
		throw new RangeError(`The workflow custody ${label} is invalid.`);
	}
	return Number(value);
}

function admittedMediaType(value: unknown, admitted: readonly string[]): string {
	if (typeof value !== 'string' || !admitted.includes(value)) {
		throw new TypeError('The workflow custody media type is incompatible with its slot.');
	}
	return value;
}

function enumText(value: unknown, expected: string, label: string): string {
	if (value !== expected) throw new TypeError(`The workflow ${label} is incompatible with its slot.`);
	return expected;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new TypeError(`The workflow ${label} is invalid.`);
	return value as T[number];
}
