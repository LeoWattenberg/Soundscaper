/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only authenticated storage bridge for the eight owned audio/cut transforms. */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import {
	createAssistanceOwnedAudioCutTransformRegistryV1,
} from '../src/common/editor/assistance/owned-audio-cut-transform-registry-v1.ts';
import type { AssistanceOwnedAudioCutTransformResultV1 } from
	'../src/common/editor/assistance/owned-audio-cut-transform-types-v1.ts';
import { reviewOwnedAssistanceTranscriptV1 } from
	'../src/common/editor/assistance/owned-transform-validation-v1.ts';
import type { AssistanceTokenizerV1 } from
	'../src/common/editor/assistance/transcript-indexing-v1.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowInputClaimV1,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowOutputClaimV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import type { AssistanceWorkflowCustodyClaimV1 } from
	'../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	validateAssistanceOutputClaim,
	validateAssistanceStagedInputClaim,
	type AssistanceOutputClaim,
	type AssistanceStagedInputClaim,
} from './assistance-data-claims.ts';
import type {
	AssistanceWorkflowOwnedStageHandler,
	AssistanceWorkflowStageExecutionV1,
} from './assistance-workflow-executor.ts';
import {
	AssistanceWorkflowOwnedStageUnavailableError,
	normalizeAssistanceWorkflowOwnedAudioCutInputV1,
	type AssistanceWorkflowOwnedAudioCutInputBodyKind,
} from './assistance-workflow-owned-audio-cut-source-normalization.ts';

export const ASSISTANCE_WORKFLOW_OWNED_AUDIO_CUT_STAGE_IDS = Object.freeze([
	'assemble-captions',
	'propose-cleanup',
	'attribute-speakers',
	'merge-reaction-ranges',
	'chunk-transcript',
	'publish-transcript-index',
	'propose-tempo-map',
	'normalize-cuts',
] as const);

type StageId = (typeof ASSISTANCE_WORKFLOW_OWNED_AUDIO_CUT_STAGE_IDS)[number];
interface SlotSpec {
	readonly slotId: string;
	readonly body: AssistanceWorkflowOwnedAudioCutInputBodyKind;
	readonly optional?: boolean;
}

interface StageSpec {
	readonly workflowId: AssistanceWorkflowV1['workflowId'];
	readonly inputs: readonly SlotSpec[];
	readonly outputs: readonly string[];
}

const MAXIMUM_SLOT_BYTES = 64 * 1024 * 1024;
const JSON_MEDIA = 'application/json';
const MATRIX_MEDIA = 'application/vnd.soundscaper.embedding-matrix-v1';
const STAGE_SPECS: Readonly<Record<StageId, StageSpec>> = Object.freeze({
	'assemble-captions': stage('transcribe-captions', [slot('transcript', 'transcript'),
		slot('word-alignment', 'word-alignment', true)], ['captions']),
	'propose-cleanup': stage('clean-filler-silence', [slot('voice-activity', 'voice-activity'),
		slot('transcript', 'transcript', true)], ['cleanup-proposals']),
	'attribute-speakers': stage('identify-speakers', [slot('transcript', 'transcript'),
		slot('speaker-turns', 'speaker-turns')], ['attributed-transcript']),
	'merge-reaction-ranges': stage('mark-reactions', [slot('audio-tags', 'json')],
		['reaction-ranges']),
	'chunk-transcript': stage('index-transcript', [slot('transcript', 'transcript')],
		['text-chunks']),
	'publish-transcript-index': stage('index-transcript', [slot('text-chunks', 'json'),
		slot('embeddings', 'embeddings')], ['transcript-index']),
	'propose-tempo-map': stage('detect-beats-tempo', [slot('beat-grid', 'json')],
		['beat-labels', 'tempo-map-diff']),
	'normalize-cuts': stage('mark-cuts', [slot('shot-boundaries', 'json')], ['cut-proposals']),
});

export interface AssistanceWorkflowOwnedAudioCutTokenizerRequestV1 {
	readonly request: AssistanceWorkflowV1;
	readonly model: AssistanceWorkflowModelBindingV1;
	readonly signal: AbortSignal;
}

export interface AssistanceWorkflowOwnedAudioCutStageCustody {
	workflowCustodyClaim(value: unknown): AssistanceWorkflowCustodyClaimV1;
	resolveInput(value: unknown, signal?: AbortSignal): Promise<Readonly<{
		claim: AssistanceStagedInputClaim | AssistanceOutputClaim;
		path: string;
	}>>;
	openOutput(value: unknown, signal?: AbortSignal): Promise<string>;
	authenticateOutput(value: unknown, signal?: AbortSignal): Promise<AssistanceOutputClaim>;
}

export interface AssistanceWorkflowOwnedAudioCutStageRuntimeOptions {
	readonly custody: AssistanceWorkflowOwnedAudioCutStageCustody;
	readonly resolveTokenizer?: (
		request: AssistanceWorkflowOwnedAudioCutTokenizerRequestV1,
	) => PromiseLike<AssistanceTokenizerV1 | null> | AssistanceTokenizerV1 | null;
}

export function createAssistanceWorkflowOwnedAudioCutStageRuntime(
	optionsValue: AssistanceWorkflowOwnedAudioCutStageRuntimeOptions,
): Readonly<Record<StageId, AssistanceWorkflowOwnedStageHandler>> {
	const options = validateOptions(optionsValue);
	return Object.freeze(Object.fromEntries(ASSISTANCE_WORKFLOW_OWNED_AUDIO_CUT_STAGE_IDS.map(
		(stageId) => [stageId, (execution: AssistanceWorkflowStageExecutionV1) =>
			runStage(stageId, execution, options)],
	)) as unknown as Record<StageId, AssistanceWorkflowOwnedStageHandler>);
}

async function runStage(
	stageId: StageId,
	execution: AssistanceWorkflowStageExecutionV1,
	options: AssistanceWorkflowOwnedAudioCutStageRuntimeOptions,
) {
	try {
		const request = validateExecution(stageId, execution);
		const spec = STAGE_SPECS[stageId];
		const inputs: Record<string, unknown> = {};
		for (const inputSpec of spec.inputs) {
			const claim = execution.inputs.find(({ slotId }) => slotId === inputSpec.slotId);
			if (!claim) {
				if (inputSpec.optional) { inputs[inputSpec.slotId] = null; continue; }
				throw new TypeError(`The owned ${stageId} stage omitted ${inputSpec.slotId}.`);
			}
			inputs[inputSpec.slotId] = await readInput(
				claim, inputSpec, execution, options.custody,
			);
		}
		execution.progress(1, 3);
		const tokenizer = stageId === 'chunk-transcript'
			? await tokenizerForTranscript(inputs.transcript, request, execution.signal, options)
			: null;
		const registry = createAssistanceOwnedAudioCutTransformRegistryV1({ tokenizer });
		const result = registry.run({ schemaVersion: 1, transformId: stageId,
			settings: request.settings, inputs });
		execution.progress(2, 3);
		await publishOutputs(result, spec, execution, options.custody);
		execution.progress(3, 3);
		return Object.freeze({ outcome: 'completed' as const });
	} catch (error) {
		if (error instanceof AssistanceWorkflowOwnedStageUnavailableError) {
			return Object.freeze({ outcome: 'unavailable' as const, reason: 'stage-unavailable' as const });
		}
		throw error;
	}
}

async function readInput(
	claim: AssistanceWorkflowInputClaimV1,
	spec: SlotSpec,
	execution: AssistanceWorkflowStageExecutionV1,
	custody: AssistanceWorkflowOwnedAudioCutStageCustody,
): Promise<unknown> {
	const token = custody.workflowCustodyClaim(claim);
	assertCustodyCorrelation(token, execution, claim, 'input');
	const expectedMedia = spec.body === 'embeddings' ? [MATRIX_MEDIA]
		: [JSON_MEDIA, `application/vnd.soundscaper.${token.role}+json`];
	if (!expectedMedia.includes(token.mediaType)) {
		throw new TypeError(`The ${spec.slotId} input media type is incompatible with its body.`);
	}
	const resolved = await custody.resolveInput(token, execution.signal);
	const resolvedClaim = token.producer === null
		? validateAssistanceStagedInputClaim(resolved.claim)
		: validateAssistanceOutputClaim(resolved.claim);
	if (resolvedClaim.claimId !== token.claimId || resolvedClaim.jobId !== token.jobId
		|| resolvedClaim.role !== token.role || resolvedClaim.mediaType !== token.mediaType) {
		throw new TypeError(`The ${spec.slotId} input resolved different authenticated custody.`);
	}
	if (resolvedClaim.byteLength > MAXIMUM_SLOT_BYTES
		|| token.byteLength !== null && token.byteLength !== resolvedClaim.byteLength
		|| token.sha256 !== null && token.sha256 !== resolvedClaim.sha256
		|| token.maximumByteLength !== null && resolvedClaim.byteLength > token.maximumByteLength) {
		throw new RangeError(`The ${spec.slotId} input exceeds or disagrees with its byte bound.`);
	}
	const bytes = await readExactBytes(resolved.path, resolvedClaim.byteLength, execution.signal);
	if (bytes.byteLength !== resolvedClaim.byteLength || digest(bytes) !== resolvedClaim.sha256) {
		throw new Error(`The ${spec.slotId} input changed after authentication; its digest is stale.`);
	}
	if (spec.body === 'embeddings') return bytes;
	const value = parseJson(bytes, spec.slotId);
	return normalizeAssistanceWorkflowOwnedAudioCutInputV1(spec.body, value, execution.request);
}

async function tokenizerForTranscript(
	transcriptValue: unknown,
	request: AssistanceWorkflowV1,
	signal: AbortSignal,
	options: AssistanceWorkflowOwnedAudioCutStageRuntimeOptions,
): Promise<AssistanceTokenizerV1 | null> {
	const transcript = reviewOwnedAssistanceTranscriptV1(transcriptValue);
	if (transcript.segments.length === 0) return null;
	const model = request.models.find(({ stageId, slotId }) =>
		stageId === 'embed-transcript' && slotId === 'text-embedder');
	if (!model || !options.resolveTokenizer) {
		throw new AssistanceWorkflowOwnedStageUnavailableError(
			'Transcript chunking needs its exact installed tokenizer.',
		);
	}
	const tokenizer = await options.resolveTokenizer({ request, model, signal });
	if (!tokenizer || typeof tokenizer !== 'object' || typeof tokenizer.encode !== 'function') {
		throw new AssistanceWorkflowOwnedStageUnavailableError(
			'Transcript chunking tokenizer is unavailable.',
		);
	}
	return tokenizer;
}

async function publishOutputs(
	result: AssistanceOwnedAudioCutTransformResultV1,
	spec: StageSpec,
	execution: AssistanceWorkflowStageExecutionV1,
	custody: AssistanceWorkflowOwnedAudioCutStageCustody,
): Promise<void> {
	const outputs = result.outputs as Readonly<Record<string, unknown>>;
	const prepared = spec.outputs.map((slotId) => {
		const claim = execution.outputs.find((candidate) => candidate.slotId === slotId);
		if (!claim || !Object.hasOwn(outputs, slotId)) {
			throw new TypeError(`The owned ${result.transformId} stage omitted ${slotId}.`);
		}
		const token = custody.workflowCustodyClaim(claim);
		assertCustodyCorrelation(token, execution, claim, 'output');
		if (token.mediaType !== JSON_MEDIA
			&& token.mediaType !== `application/vnd.soundscaper.${token.role}+json`) {
			throw new TypeError(`The ${slotId} output reservation has incompatible media.`);
		}
		const bytes = new TextEncoder().encode(JSON.stringify(outputs[slotId]));
		if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_SLOT_BYTES
			|| token.maximumByteLength === null || bytes.byteLength > token.maximumByteLength) {
			throw new RangeError(`The ${slotId} output exceeds its exact reservation.`);
		}
		return Object.freeze({ slotId, claim, token, bytes });
	});
	const paths = new Set<string>();
	for (const item of prepared) {
		const path = await custody.openOutput(item.token, execution.signal);
		if (paths.has(path)) throw new Error('Owned workflow output reservations aliased one path.');
		paths.add(path);
		const handle = await open(path, 'w');
		try { await handle.writeFile(item.bytes); await handle.sync(); }
		finally { await handle.close(); }
	}
	for (const item of prepared) {
		const authenticated = validateAssistanceOutputClaim(
			await custody.authenticateOutput(item.token, execution.signal),
		);
		if (authenticated.claimId !== item.claim.claimId || authenticated.jobId !== execution.request.jobId
			|| authenticated.role !== item.token.role || authenticated.mediaType !== item.token.mediaType
			|| authenticated.byteLength !== item.bytes.byteLength
			|| authenticated.sha256 !== digest(item.bytes)) {
			throw new Error(`The ${item.slotId} output authentication changed its exact body.`);
		}
	}
}

function validateExecution(
	stageId: StageId,
	execution: AssistanceWorkflowStageExecutionV1,
): AssistanceWorkflowV1 {
	const request = validateAssistanceWorkflow(execution?.request);
	const spec = STAGE_SPECS[stageId];
	const graphStage = assistanceWorkflowStageGraph(request.workflowId)
		.find((candidate) => candidate.stageId === stageId);
	if (request.workflowId !== spec.workflowId || !graphStage || graphStage.operation !== null
		|| execution.stage.stageId !== stageId || execution.stage.operation !== null
		|| execution.stageIndex !== request.stageIds.indexOf(stageId)
		|| execution.stageCount !== request.stageIds.length
		|| !sameClaimSet(execution.inputs, request.inputs.filter((claim) => claim.stageId === stageId))
		|| !sameClaimSet(execution.outputs, request.outputs.filter((claim) => claim.stageId === stageId))) {
		throw new TypeError('The owned assistance stage binding is stale or uncorrelated.');
	}
	return request;
}

function assertCustodyCorrelation(
	token: AssistanceWorkflowCustodyClaimV1,
	execution: AssistanceWorkflowStageExecutionV1,
	claim: AssistanceWorkflowInputClaimV1 | AssistanceWorkflowOutputClaimV1,
	direction: 'input' | 'output',
): void {
	if (token.direction !== direction || token.workflowId !== execution.request.workflowId
		|| token.jobId !== execution.request.jobId || token.stageId !== execution.stage.stageId
		|| token.slotId !== claim.slotId || token.claimId !== claim.claimId) {
		throw new TypeError('Owned workflow custody does not correlate to its exact stage slot.');
	}
}

function validateOptions(
	value: AssistanceWorkflowOwnedAudioCutStageRuntimeOptions,
): AssistanceWorkflowOwnedAudioCutStageRuntimeOptions {
	if (!value?.custody || typeof value.custody.workflowCustodyClaim !== 'function'
		|| typeof value.custody.resolveInput !== 'function' || typeof value.custody.openOutput !== 'function'
		|| typeof value.custody.authenticateOutput !== 'function'
		|| value.resolveTokenizer !== undefined && typeof value.resolveTokenizer !== 'function') {
		throw new TypeError('Owned audio/cut stage runtime options are invalid.');
	}
	return value;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { throw new TypeError(`The ${label} input is not strict UTF-8.`); }
	try { return JSON.parse(text) as unknown; }
	catch { throw new TypeError(`The ${label} input is not strict JSON.`); }
}

async function readExactBytes(
	path: string,
	byteLength: number,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const handle = await open(path, 'r');
	try {
		signal.throwIfAborted();
		const metadata = await handle.stat();
		if (metadata.size !== byteLength) throw new Error('The authenticated input byte length changed.');
		const bytes = new Uint8Array(byteLength);
		let offset = 0;
		while (offset < byteLength) {
			signal.throwIfAborted();
			const length = Math.min(1024 * 1024, byteLength - offset);
			const { bytesRead } = await handle.read(bytes, offset, length, offset);
			if (bytesRead < 1) throw new Error('The authenticated input ended before its exact length.');
			offset += bytesRead;
		}
		const overflow = new Uint8Array(1);
		if ((await handle.read(overflow, 0, 1, byteLength)).bytesRead !== 0) {
			throw new Error('The authenticated input grew beyond its exact length.');
		}
		return bytes;
	} finally { await handle.close(); }
}

function stage(
	workflowId: StageSpec['workflowId'], inputs: readonly SlotSpec[], outputs: readonly string[],
): StageSpec {
	return Object.freeze({ workflowId, inputs: Object.freeze(inputs), outputs: Object.freeze(outputs) });
}

function slot(
	slotId: string,
	body: AssistanceWorkflowOwnedAudioCutInputBodyKind,
	optional = false,
): SlotSpec {
	return Object.freeze({ slotId, body, ...(optional ? { optional: true } : {}) });
}

function sameClaimSet(
	left: readonly (AssistanceWorkflowInputClaimV1 | AssistanceWorkflowOutputClaimV1)[],
	right: readonly (AssistanceWorkflowInputClaimV1 | AssistanceWorkflowOutputClaimV1)[],
): boolean {
	return left.length === right.length && left.every((claim, index) => {
		const expected = right[index];
		return expected !== undefined && claim.claimId === expected.claimId
			&& claim.direction === expected.direction && claim.jobId === expected.jobId
			&& claim.stageId === expected.stageId && claim.slotId === expected.slotId;
	});
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
