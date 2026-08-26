/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import {
	ASSISTANCE_BINARY_MAXIMUM_BYTES,
	ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES,
	reviewAssistanceEmbeddingMatrixV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import { createAssistanceOwnedVideoHighlightTransformRegistryV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-registry-v1.ts';
import type {
	AssistanceOwnedFramePackPlanV1,
	AssistanceOwnedVideoHighlightTransformResultV1,
} from '../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import {
	assistanceWorkflowStageGraph,
	validateAssistanceWorkflow,
	type AssistanceWorkflowInputClaimV1,
	type AssistanceWorkflowOutputClaimV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	validateAssistanceWorkflowCustodyClaimV1,
	type AssistanceWorkflowCustodyClaimV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import {
	reviewFramescaperAssistanceHighlightsV1,
} from '../src/framescaper/editor-local-assistance-highlight-review.ts';
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
import { assertAssistanceOwnedVideoHighlightResultFenceV1 } from
	'./assistance-workflow-owned-video-highlight-fence.ts';
import { materializeAssistanceSelectedVideoAuthorityV1 } from
	'./assistance-selected-video-authority.ts';
import { assertAssistanceOwnedFramePackMatchesPlanV1 } from
	'./assistance-owned-frame-pack-materialization.ts';

export const ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS = Object.freeze([
	'sample-shot-frames',
	'publish-video-index',
	'track-subjects',
	'plan-crops',
	'gather-signals',
	'rank-highlights',
	'assemble-highlights',
] as const);
type StageId = typeof ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS[number];
type InputKind = 'json' | 'matrix' | 'video';

interface InputSpec {
	readonly slotId: string;
	readonly kind: InputKind;
	readonly optional?: boolean;
}

interface StageSpec {
	readonly workflowId: AssistanceWorkflowV1['workflowId'];
	readonly inputs: readonly InputSpec[];
	readonly output: string;
}
export interface AssistanceWorkflowOwnedVideoHighlightInputCaptureV1 {
	readonly claim: AssistanceStagedInputClaim | AssistanceOutputClaim;
	readonly path: string;
}

export interface AssistanceWorkflowOwnedFramePackMaterializationRequestV1 {
	readonly request: AssistanceWorkflowV1;
	readonly plan: AssistanceOwnedFramePackPlanV1;
	readonly source: AssistanceWorkflowOwnedVideoHighlightInputCaptureV1;
	readonly signal: AbortSignal;
}

export interface AssistanceWorkflowOwnedVisualTagsMaterializationRequestV1 {
	readonly request: AssistanceWorkflowV1;
	readonly plan: AssistanceOwnedFramePackPlanV1;
	readonly matrix: Uint8Array;
	readonly signal: AbortSignal;
}

export interface AssistanceWorkflowOwnedVisualTagsMaterializationV1 {
	readonly matrix: Uint8Array;
	readonly tags: unknown;
}

/** Closed main-only seam for data that cannot truthfully be represented by current slotted bodies. */
export interface AssistanceWorkflowOwnedVideoHighlightMaterializerV1 {
	materializeFramePack?(request: AssistanceWorkflowOwnedFramePackMaterializationRequestV1):
		PromiseLike<readonly Uint8Array[] | null> | readonly Uint8Array[] | null;
	resolveVisualTags?(request: AssistanceWorkflowOwnedVisualTagsMaterializationRequestV1):
		PromiseLike<AssistanceWorkflowOwnedVisualTagsMaterializationV1 | null>
		| AssistanceWorkflowOwnedVisualTagsMaterializationV1 | null;
}

export interface AssistanceWorkflowOwnedVideoHighlightStageCustodyV1 {
	workflowCustodyClaim(value: unknown): AssistanceWorkflowCustodyClaimV1;
	resolveInput(value: unknown, signal?: AbortSignal): Promise<Readonly<{
		claim: AssistanceStagedInputClaim | AssistanceOutputClaim;
		path: string;
	}>>;
	openOutput(value: unknown, signal?: AbortSignal): Promise<string>;
	authenticateOutput(value: unknown, signal?: AbortSignal): Promise<AssistanceOutputClaim>;
}

export interface AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1 {
	readonly custody: AssistanceWorkflowOwnedVideoHighlightStageCustodyV1;
	readonly materializer?: AssistanceWorkflowOwnedVideoHighlightMaterializerV1;
}

interface ResolvedInput {
	readonly value: unknown;
	readonly capture: AssistanceWorkflowOwnedVideoHighlightInputCaptureV1;
}

interface StoredFramePlan {
	readonly identity: string;
	readonly plan: AssistanceOwnedFramePackPlanV1;
}

const JSON_MEDIA = 'application/json';
const MATRIX_MEDIA = 'application/vnd.soundscaper.embedding-matrix-v1';
const FRAME_MEDIA = 'application/vnd.soundscaper.frame-pack';
const MAXIMUM_JSON_BYTES = 64 * 1024 * 1024;
const MAXIMUM_SOURCE_BYTES = 16 * 1024 ** 3;
const MAXIMUM_HELD_FRAME_PLANS = 128;
const STAGE_SPECS: Readonly<Record<StageId, StageSpec>> = Object.freeze({
	'sample-shot-frames': stage('index-video', [input('video', 'video'),
		input('video-authority', 'json'), input('shot-boundaries', 'json')], 'frame-pack'),
	'publish-video-index': stage('index-video', [input('visual-embeddings', 'matrix'),
		input('recognized-text', 'json')], 'video-index'),
	'track-subjects': stage('reframe', [input('subject-tracks', 'json')], 'tracked-subjects'),
	'plan-crops': stage('reframe', [input('tracked-subjects', 'json'),
		input('saliency-map', 'json')], 'reframe-path'),
	'gather-signals': stage('make-highlights', [input('video', 'json'), input('audio', 'json', true),
		input('transcript', 'json', true), input('shot-boundaries', 'json', true),
		input('audio-tags', 'json', true), input('reaction-ranges', 'json', true),
		input('embeddings', 'matrix', true)],
	'highlight-signals'),
	'rank-highlights': stage('make-highlights', [input('highlight-signals', 'json')],
		'highlight-candidates'),
	'assemble-highlights': stage('make-highlights', [input('highlight-candidates', 'json'),
		input('editorial-proposal', 'json', true)], 'highlight-proposals'),
});

export function createAssistanceWorkflowOwnedVideoHighlightStageRuntime(
	optionsValue: AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1,
): Readonly<Record<StageId, AssistanceWorkflowOwnedStageHandler>> {
	const options = validateOptions(optionsValue);
	const framePlans = new Map<string, StoredFramePlan>();
	return Object.freeze(Object.fromEntries(ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS.map(
		(stageId) => [stageId, (execution: AssistanceWorkflowStageExecutionV1) =>
			runStage(stageId, execution, options, framePlans)],
	)) as unknown as Record<StageId, AssistanceWorkflowOwnedStageHandler>);
}

async function runStage(
	stageId: StageId,
	execution: AssistanceWorkflowStageExecutionV1,
	options: AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1,
	framePlans: Map<string, StoredFramePlan>,
) {
	try {
		const request = validateExecution(stageId, execution);
		const spec = STAGE_SPECS[stageId];
		const resolved: Record<string, ResolvedInput | null> = {};
		for (const inputSpec of spec.inputs) {
			const claim = execution.inputs.find(({ slotId }) => slotId === inputSpec.slotId);
			if (!claim) {
				if (inputSpec.optional) { resolved[inputSpec.slotId] = null; continue; }
				throw new TypeError(`The owned ${stageId} stage omitted ${inputSpec.slotId}.`);
			}
			resolved[inputSpec.slotId] = await resolveInput(claim, inputSpec, execution, options.custody);
		}
		execution.progress(1, 4);
		const inputs = await transformInputs(stageId, request, resolved, options, framePlans,
			execution.signal);
		execution.signal.throwIfAborted();
		const result = createAssistanceOwnedVideoHighlightTransformRegistryV1().run({
			schemaVersion: 1, transformId: stageId, settings: request.settings, inputs,
		});
		assertAssistanceOwnedVideoHighlightResultFenceV1(result, request);
		const heldPlan = framePlans.get(request.jobId);
		if (stageId === 'sample-shot-frames' && (heldPlan
			? heldPlan.identity !== workflowIdentity(request) : framePlans.size >= MAXIMUM_HELD_FRAME_PLANS))
			unavailable('The exact sampled-frame plan inventory cannot admit this workflow.');
		const prepared = await prepareOutput(stageId, result, request, resolved,
			execution, options);
		execution.progress(2, 4);
		await writePrepared(prepared, execution, options.custody);
		execution.progress(3, 4);
		await authenticatePrepared(prepared, execution, options.custody);
		if (stageId === 'sample-shot-frames') {
			storeFramePlan(framePlans, request, framePlan(result));
		} else if (stageId === 'publish-video-index') {
			framePlans.delete(request.jobId);
		}
		execution.progress(4, 4);
		return Object.freeze({ outcome: 'completed' as const });
	} catch (error) {
		if (error instanceof OwnedVideoHighlightStageUnavailableError) {
			return Object.freeze({ outcome: 'unavailable' as const, reason: 'stage-unavailable' as const });
		}
		throw error;
	}
}

async function transformInputs(
	stageId: StageId,
	request: AssistanceWorkflowV1,
	resolved: Readonly<Record<string, ResolvedInput | null>>,
	options: AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1,
	framePlans: ReadonlyMap<string, StoredFramePlan>,
	signal: AbortSignal,
): Promise<Readonly<Record<string, unknown>>> {
	const values = Object.fromEntries(Object.entries(resolved).map(([slotId, item]) =>
		[slotId, item?.value ?? null])) as Record<string, unknown>;
	if (stageId === 'sample-shot-frames') {
		const source = requiredResolved(resolved.video, 'video');
		values.video = materializeAssistanceSelectedVideoAuthorityV1({
			value: requiredResolved(resolved['video-authority'], 'video-authority').value,
			request, videoClaim: source.capture.claim,
		});
		delete values['video-authority'];
	}
	if (stageId === 'publish-video-index') {
		const stored = framePlans.get(request.jobId);
		if (!stored || stored.identity !== workflowIdentity(request)) {
			unavailable('The exact sampled-frame plan is unavailable for index publication.');
		}
		const matrix = requiredResolved(resolved['visual-embeddings'], 'visual-embeddings').value;
		if (!(matrix instanceof Uint8Array)) throw new TypeError('Visual embeddings lost binary custody.');
		const tagged = await options.materializer?.resolveVisualTags?.({ request, plan: stored.plan,
			matrix: matrix.slice(), signal });
		signal.throwIfAborted();
		if (!tagged || !(tagged.matrix instanceof Uint8Array)) {
			unavailable('Visual tag materialization is unavailable.');
		}
		values['visual-embeddings'] = Object.freeze({ schemaVersion: 1,
			kind: 'visual-embeddings', framePack: stored.plan, matrix: tagged.matrix.slice(),
			tags: tagged.tags });
	}
	if (stageId === 'assemble-highlights') {
		values.editorial = values['editorial-proposal'];
		delete values['editorial-proposal'];
	}
	return Object.freeze(values);
}

interface PreparedOutput {
	readonly slotId: string;
	readonly claim: AssistanceWorkflowOutputClaimV1;
	readonly token: AssistanceWorkflowCustodyClaimV1;
	readonly chunks: readonly Uint8Array[];
	readonly byteLength: number;
	readonly sha256: string;
}

async function prepareOutput(
	stageId: StageId,
	result: AssistanceOwnedVideoHighlightTransformResultV1,
	request: AssistanceWorkflowV1,
	resolved: Readonly<Record<string, ResolvedInput | null>>,
	execution: AssistanceWorkflowStageExecutionV1,
	options: AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1,
): Promise<PreparedOutput> {
	const slotId = STAGE_SPECS[stageId].output;
	const claim = execution.outputs.find((candidate) => candidate.slotId === slotId);
	if (!claim || !Object.hasOwn(result.outputs, slotId)) {
		throw new TypeError(`The owned ${stageId} stage omitted ${slotId}.`);
	}
	const token = validateAssistanceWorkflowCustodyClaimV1(options.custody.workflowCustodyClaim(claim));
	assertCustodyCorrelation(token, execution, claim, 'output');
	let chunks: readonly Uint8Array[];
	if (stageId === 'sample-shot-frames') {
		if (token.mediaType !== FRAME_MEDIA) throw new TypeError('Frame-pack output custody has wrong media.');
		const source = requiredResolved(resolved.video, 'video');
		const plan = framePlan(result);
		const materialized = await options.materializer?.materializeFramePack?.({ request, plan,
			source: source.capture, signal: execution.signal });
		execution.signal.throwIfAborted();
		if (materialized === null || materialized === undefined) {
			unavailable('RGBA frame-pack materialization is unavailable.');
		}
		assertAssistanceOwnedFramePackMatchesPlanV1(materialized, plan);
		chunks = Object.freeze(materialized.map((chunk) => chunk.slice()));
	} else {
		if (token.mediaType !== JSON_MEDIA
			&& token.mediaType !== `application/vnd.soundscaper.${token.role}+json`) {
			throw new TypeError(`The ${slotId} output reservation has incompatible JSON media.`);
		}
		const outputs = result.outputs as Readonly<Record<string, unknown>>;
		const value = stageId === 'assemble-highlights'
			? fenceHighlightPublication(highlightProposals(result), request) : outputs[slotId];
		chunks = Object.freeze([new TextEncoder().encode(JSON.stringify(value))]);
	}
	const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	if (chunks.length < 1 || chunks.some((chunk) => !(chunk instanceof Uint8Array)
		|| chunk.byteLength < 1 || stageId === 'sample-shot-frames'
			&& chunk.byteLength > ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES)
		|| byteLength < 1 || byteLength > outputMaximum(stageId)
		|| token.maximumByteLength === null || byteLength > token.maximumByteLength) {
		throw new RangeError(`The ${slotId} output exceeds its exact reservation.`);
	}
	return Object.freeze({ slotId, claim, token, chunks: Object.freeze([...chunks]), byteLength,
		sha256: digestChunks(chunks) });
}

async function resolveInput(
	claim: AssistanceWorkflowInputClaimV1,
	spec: InputSpec,
	execution: AssistanceWorkflowStageExecutionV1,
	custody: AssistanceWorkflowOwnedVideoHighlightStageCustodyV1,
): Promise<ResolvedInput> {
	const token = validateAssistanceWorkflowCustodyClaimV1(custody.workflowCustodyClaim(claim));
	assertCustodyCorrelation(token, execution, claim, 'input');
	assertInputMedia(token, spec);
	const resolved = await custody.resolveInput(token, execution.signal);
	const resolvedClaim = token.producer === null
		? validateAssistanceStagedInputClaim(resolved.claim)
		: validateAssistanceOutputClaim(resolved.claim);
	if (resolvedClaim.claimId !== token.claimId || resolvedClaim.jobId !== token.jobId
		|| resolvedClaim.role !== token.role || resolvedClaim.mediaType !== token.mediaType) {
		throw new TypeError(`The ${spec.slotId} input resolved different authenticated custody.`);
	}
	const maximum = spec.kind === 'json' ? MAXIMUM_JSON_BYTES
		: spec.kind === 'matrix' ? ASSISTANCE_BINARY_MAXIMUM_BYTES : MAXIMUM_SOURCE_BYTES;
	if (resolvedClaim.byteLength > maximum
		|| token.byteLength !== null && token.byteLength !== resolvedClaim.byteLength
		|| token.sha256 !== null && token.sha256 !== resolvedClaim.sha256
		|| token.maximumByteLength !== null && resolvedClaim.byteLength > token.maximumByteLength) {
		throw new RangeError(`The ${spec.slotId} input exceeds or disagrees with its byte bound.`);
	}
	const bytes = await readExactBytes(resolved.path, resolvedClaim.byteLength, execution.signal,
		spec.kind !== 'video');
	if (bytes.sha256 !== resolvedClaim.sha256) {
		throw new Error(`The ${spec.slotId} input changed after authentication; its digest is stale.`);
	}
	let value: unknown = null;
	if (spec.kind === 'json') value = parseJson(bytes.body!, spec.slotId);
	if (spec.kind === 'matrix') {
		reviewAssistanceEmbeddingMatrixV1(bytes.body!);
		value = bytes.body!;
	}
	return Object.freeze({ value,
		capture: Object.freeze({ claim: resolvedClaim, path: resolved.path }) });
}

async function writePrepared(
	prepared: PreparedOutput,
	execution: AssistanceWorkflowStageExecutionV1,
	custody: AssistanceWorkflowOwnedVideoHighlightStageCustodyV1,
): Promise<void> {
	const path = await custody.openOutput(prepared.token, execution.signal);
	const handle = await open(path, 'w');
	try {
		let offset = 0;
		for (const chunk of prepared.chunks) {
			execution.signal.throwIfAborted();
			let chunkOffset = 0;
			while (chunkOffset < chunk.byteLength) {
				const { bytesWritten } = await handle.write(chunk, chunkOffset,
					chunk.byteLength - chunkOffset, offset);
				if (bytesWritten < 1) throw new Error('The owned workflow output write made no progress.');
				chunkOffset += bytesWritten; offset += bytesWritten;
			}
		}
		if (offset !== prepared.byteLength) throw new Error('The owned workflow output write was short.');
		await handle.sync();
	} finally { await handle.close(); }
}

async function authenticatePrepared(
	prepared: PreparedOutput,
	execution: AssistanceWorkflowStageExecutionV1,
	custody: AssistanceWorkflowOwnedVideoHighlightStageCustodyV1,
): Promise<void> {
	const authenticated = validateAssistanceOutputClaim(
		await custody.authenticateOutput(prepared.token, execution.signal),
	);
	if (authenticated.claimId !== prepared.claim.claimId
		|| authenticated.jobId !== execution.request.jobId
		|| authenticated.role !== prepared.token.role
		|| authenticated.mediaType !== prepared.token.mediaType
		|| authenticated.byteLength !== prepared.byteLength
		|| authenticated.sha256 !== prepared.sha256) {
		throw new Error(`The ${prepared.slotId} output authentication changed its exact body.`);
	}
}

function fenceHighlightPublication(
	value: Extract<AssistanceOwnedVideoHighlightTransformResultV1,
		{ transformId: 'assemble-highlights' }>['outputs']['highlight-proposals'],
	request: AssistanceWorkflowV1,
): unknown {
	return reviewFramescaperAssistanceHighlightsV1({ kind: value.kind,
		schemaVersion: value.schemaVersion, workflowId: value.workflowId, fence: request.fence,
		proposals: value.proposals,
	});
}

function framePlan(result: AssistanceOwnedVideoHighlightTransformResultV1): AssistanceOwnedFramePackPlanV1 {
	if (result.transformId !== 'sample-shot-frames') {
		throw new TypeError('The sampled-frame result changed its transform identity.');
	}
	return result.outputs['frame-pack'];
}

function highlightProposals(
	result: AssistanceOwnedVideoHighlightTransformResultV1,
): Extract<AssistanceOwnedVideoHighlightTransformResultV1,
	{ transformId: 'assemble-highlights' }>['outputs']['highlight-proposals'] {
	if (result.transformId !== 'assemble-highlights') {
		throw new TypeError('The highlight result changed its transform identity.');
	}
	return result.outputs['highlight-proposals'];
}

function validateExecution(stageId: StageId, execution: AssistanceWorkflowStageExecutionV1) {
	const request = validateAssistanceWorkflow(execution?.request);
	const spec = STAGE_SPECS[stageId];
	const graphStage = assistanceWorkflowStageGraph(request.workflowId)
		.find((candidate) => candidate.stageId === stageId);
	if (request.workflowId !== spec.workflowId || !graphStage || graphStage.operation !== null
		|| execution.stage.stageId !== stageId || execution.stage.operation !== null
		|| execution.stageIndex !== request.stageIds.indexOf(stageId)
		|| execution.stageCount !== request.stageIds.length
		|| execution.custody.custodyVersion !== 1 || execution.custody.jobId !== request.jobId
		|| execution.custody.stageId !== stageId
		|| JSON.stringify(execution.custody.inputClaimIds) !== JSON.stringify(
			execution.inputs.map(({ claimId }) => claimId))
		|| JSON.stringify(execution.custody.outputClaimIds) !== JSON.stringify(
			execution.outputs.map(({ claimId }) => claimId))
		|| !sameClaimSet(execution.inputs, request.inputs.filter((claim) => claim.stageId === stageId))
		|| !sameClaimSet(execution.outputs, request.outputs.filter((claim) => claim.stageId === stageId))) {
		throw new TypeError('The owned video/highlight stage binding is stale or uncorrelated.');
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
		throw new TypeError('Owned video/highlight custody does not correlate to its exact stage slot.');
	}
}

function assertInputMedia(token: AssistanceWorkflowCustodyClaimV1, spec: InputSpec): void {
	const admitted = spec.kind === 'json' ? [JSON_MEDIA, `application/vnd.soundscaper.${token.role}+json`]
		: spec.kind === 'matrix' ? [MATRIX_MEDIA]
			: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
	if (!admitted.includes(token.mediaType)) {
		throw new TypeError(`The ${spec.slotId} input media type is incompatible with its body.`);
	}
}

function validateOptions(
	value: AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1,
): AssistanceWorkflowOwnedVideoHighlightStageRuntimeOptionsV1 {
	if (!value?.custody || typeof value.custody.workflowCustodyClaim !== 'function'
		|| typeof value.custody.resolveInput !== 'function' || typeof value.custody.openOutput !== 'function'
		|| typeof value.custody.authenticateOutput !== 'function') {
		throw new TypeError('Owned video/highlight stage runtime options are invalid.');
	}
	const materializer = value.materializer;
	if (materializer !== undefined && (!materializer || typeof materializer !== 'object'
		|| materializer.materializeFramePack !== undefined
			&& typeof materializer.materializeFramePack !== 'function'
		|| materializer.resolveVisualTags !== undefined
			&& typeof materializer.resolveVisualTags !== 'function')) {
		throw new TypeError('Owned video/highlight materializer options are invalid.');
	}
	return value;
}

async function readExactBytes(
	path: string,
	byteLength: number,
	signal: AbortSignal,
	retain: boolean,
): Promise<Readonly<{ body: Uint8Array | null; sha256: string }>> {
	const handle = await open(path, 'r');
	const hash = createHash('sha256');
	const body = retain ? new Uint8Array(byteLength) : null;
	try {
		signal.throwIfAborted();
		if ((await handle.stat()).size !== byteLength) throw new Error('Authenticated input length changed.');
		let offset = 0;
		while (offset < byteLength) {
			signal.throwIfAborted();
			const chunk = new Uint8Array(Math.min(1024 * 1024, byteLength - offset));
			const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
			if (bytesRead < 1) throw new Error('Authenticated input ended before its exact length.');
			const read = chunk.subarray(0, bytesRead);
			hash.update(read); body?.set(read, offset); offset += bytesRead;
		}
		if ((await handle.read(new Uint8Array(1), 0, 1, byteLength)).bytesRead !== 0) {
			throw new Error('Authenticated input grew beyond its exact length.');
		}
		return Object.freeze({ body, sha256: hash.digest('hex') });
	} finally { await handle.close(); }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { throw new TypeError(`The ${label} input is not strict UTF-8.`); }
	try { return JSON.parse(text) as unknown; }
	catch { throw new TypeError(`The ${label} input is not strict JSON.`); }
}

function storeFramePlan(
	plans: Map<string, StoredFramePlan>,
	request: AssistanceWorkflowV1,
	plan: AssistanceOwnedFramePackPlanV1,
): void {
	plans.set(request.jobId, Object.freeze({ identity: workflowIdentity(request), plan }));
}

function workflowIdentity(request: AssistanceWorkflowV1): string {
	return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function requiredResolved(value: ResolvedInput | null | undefined, slotId: string): ResolvedInput {
	if (!value) throw new TypeError(`The owned stage omitted resolved ${slotId} custody.`);
	return value;
}

function stage(
	workflowId: StageSpec['workflowId'], inputs: readonly InputSpec[], output: string,
): StageSpec {
	return Object.freeze({ workflowId, inputs: Object.freeze(inputs), output });
}

function input(slotId: string, kind: InputKind, optional = false): InputSpec {
	return Object.freeze({ slotId, kind, ...(optional ? { optional: true } : {}) });
}

function outputMaximum(stageId: StageId): number {
	return stageId === 'sample-shot-frames' ? ASSISTANCE_BINARY_MAXIMUM_BYTES : MAXIMUM_JSON_BYTES;
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

function digestChunks(chunks: readonly Uint8Array[]): string {
	const hash = createHash('sha256');
	for (const chunk of chunks) hash.update(chunk);
	return hash.digest('hex');
}

function unavailable(message: string): never {
	throw new OwnedVideoHighlightStageUnavailableError(message);
}

class OwnedVideoHighlightStageUnavailableError extends Error {}
