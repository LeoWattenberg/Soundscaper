/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retain normalized reusable semantics only at an explicit Guided acceptance boundary. */

import {
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from '../assistance/owned-audio-cut-transform-results-v1.ts';
import type { AssistanceCutProposalsV1 } from
	'../assistance/owned-audio-cut-transform-types-v1.ts';
import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../assistance/owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedHighlightProposalsV1,
	AssistanceOwnedReframePathV1,
} from '../assistance/owned-video-highlight-transform-types-v1.ts';
import {
	ASSISTANCE_RANKING_DERIVATIVE_MEDIA_TYPE,
	ASSISTANCE_SALIENCY_DERIVATIVE_MEDIA_TYPE,
	ASSISTANCE_SHOT_TABLE_DERIVATIVE_MEDIA_TYPE,
	ASSISTANCE_TRACKER_DERIVATIVE_MEDIA_TYPE,
	createAssistanceRankingCheckpointDerivativeV1,
	createAssistanceReframeStateDerivativesV1,
	createAssistanceShotTableDerivativeV1,
} from '../assistance/reusable-derivatives-v1.ts';
import {
	validateAssistanceWorkflow,
	validateAssistanceWorkflowFenceV1,
	type AssistanceGuidedWorkflowId,
	type AssistanceWorkflowOutputClaimV1,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import { assistanceWorkflowCustodySlotSpec } from '../assistance/workflow-custody-v1.ts';
import type { AssistanceDerivativeRecordV1 } from
	'../storage/assistance-derivative-repository.ts';
import type { AssistanceDerivativeRepositoryPort } from
	'../storage/deferred-assistance-derivative-repository.ts';
import type { LocalAssistanceGuidedReviewedResult } from
	'../ui/local-assistance-guided-result-review.ts';

const MAXIMUM_JSON_BYTES = 64 * 1024 * 1024;

export interface LocalAssistanceGuidedReusableDerivativeRequest {
	readonly workflow: unknown;
	readonly review: LocalAssistanceGuidedReviewedResult;
	readonly readOutput: (request: Readonly<{
		readonly jobId: string;
		readonly workflowId: AssistanceGuidedWorkflowId;
		readonly claim: AssistanceWorkflowOutputClaimV1;
	}>) => Promise<Blob>;
	readonly repository: Pick<AssistanceDerivativeRepositoryPort, 'saveBatch'>;
	readonly resolveCurrentFence: (
		workflow: AssistanceWorkflowV1,
		signal: AbortSignal,
	) => PromiseLike<unknown> | unknown;
	readonly signal?: AbortSignal;
}

export async function retainLocalAssistanceGuidedReusableDerivatives(
	request: LocalAssistanceGuidedReusableDerivativeRequest,
): Promise<readonly AssistanceDerivativeRecordV1[]> {
	if (!request || typeof request !== 'object' || typeof request.readOutput !== 'function'
		|| typeof request.repository?.saveBatch !== 'function'
		|| typeof request.resolveCurrentFence !== 'function'
		|| (request.signal !== undefined && !(request.signal instanceof AbortSignal))) {
		throw new TypeError('Reusable Guided retention requires exact review and custody ports.');
	}
	const workflow = validateAssistanceWorkflow(request.workflow);
	if (workflow.workflowId !== 'mark-cuts' && workflow.workflowId !== 'reframe'
		&& workflow.workflowId !== 'make-highlights') return Object.freeze([]);
	const signal = request.signal ?? new AbortController().signal;
	await assertCurrentFence(request.resolveCurrentFence, workflow, signal);
	signal.throwIfAborted();
	const payloads = workflow.workflowId === 'mark-cuts'
		? markCutPayload(workflow, request.review)
		: workflow.workflowId === 'reframe'
			? await reframePayloads(workflow, request.review, request.readOutput, signal)
			: await rankingPayload(workflow, request.review, request.readOutput, signal);
	await assertCurrentFence(request.resolveCurrentFence, workflow, signal);
	signal.throwIfAborted();
	return await request.repository.saveBatch(workflow, payloads.map((payload) => ({
		kind: payload.kind, payload: { mediaType: payload.mediaType, bytes: payload.bytes },
	})), () => assertCurrentFence(request.resolveCurrentFence, workflow, signal));
}

type Payload = Readonly<{
	readonly kind: 'shot-table' | 'saliency-map' | 'tracker-state' | 'ranking-checkpoint';
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}>;

function markCutPayload(
	workflow: AssistanceWorkflowV1,
	review: LocalAssistanceGuidedReviewedResult,
): readonly Payload[] {
	const semantic = terminalSemantic(workflow, review, 'normalize-cuts', 'cut-proposals', 'audio');
	const cuts = semantic as AssistanceCutProposalsV1;
	const shots = { schemaVersion: 1, detector: cuts.detector, timescale: cuts.timescale,
		sourceFrameCount: cuts.sourceFrameCount,
		boundaries: cuts.proposals.map(({ sourceFrame, presentationTick, score }) => ({
			sourceFrame, presentationTick, score,
		})) };
	return Object.freeze([Object.freeze({ kind: 'shot-table',
		mediaType: ASSISTANCE_SHOT_TABLE_DERIVATIVE_MEDIA_TYPE,
		bytes: createAssistanceShotTableDerivativeV1(workflow, shots) })]);
}

async function reframePayloads(
	workflow: AssistanceWorkflowV1,
	review: LocalAssistanceGuidedReviewedResult,
	readOutput: LocalAssistanceGuidedReusableDerivativeRequest['readOutput'],
	signal: AbortSignal,
): Promise<readonly Payload[]> {
	const terminal = terminalSemantic(
		workflow, review, 'plan-crops', 'reframe-path', 'video',
	) as AssistanceOwnedReframePathV1;
	const tracked = await readJson(workflow, 'track-subjects', 'tracked-subjects', readOutput, signal);
	const saliency = await readJson(workflow, 'detect-saliency', 'saliency-map', readOutput, signal);
	const normalized = createAssistanceReframeStateDerivativesV1(
		workflow, terminal, tracked, saliency,
	);
	return Object.freeze([
		Object.freeze({ kind: 'saliency-map', mediaType: ASSISTANCE_SALIENCY_DERIVATIVE_MEDIA_TYPE,
			bytes: normalized.saliency }),
		Object.freeze({ kind: 'tracker-state', mediaType: ASSISTANCE_TRACKER_DERIVATIVE_MEDIA_TYPE,
			bytes: normalized.tracker }),
	]);
}

async function rankingPayload(
	workflow: AssistanceWorkflowV1,
	review: LocalAssistanceGuidedReviewedResult,
	readOutput: LocalAssistanceGuidedReusableDerivativeRequest['readOutput'],
	signal: AbortSignal,
): Promise<readonly Payload[]> {
	const terminal = terminalSemantic(
		workflow, review, 'assemble-highlights', 'highlight-proposals', 'video',
	) as AssistanceOwnedHighlightProposalsV1;
	const candidates = await readJson(
		workflow, 'rank-highlights', 'highlight-candidates', readOutput, signal,
	);
	const shots = await readJson(
		workflow, 'detect-highlight-shots', 'shot-boundaries', readOutput, signal,
	);
	return Object.freeze([
		Object.freeze({ kind: 'shot-table', mediaType: ASSISTANCE_SHOT_TABLE_DERIVATIVE_MEDIA_TYPE,
			bytes: createAssistanceShotTableDerivativeV1(workflow, shots) }),
		Object.freeze({ kind: 'ranking-checkpoint',
			mediaType: ASSISTANCE_RANKING_DERIVATIVE_MEDIA_TYPE,
			bytes: createAssistanceRankingCheckpointDerivativeV1(workflow, candidates, terminal) }),
	]);
}

function terminalSemantic(
	workflow: AssistanceWorkflowV1,
	review: LocalAssistanceGuidedReviewedResult,
	stageId: string,
	slotId: string,
	reviewer: 'audio' | 'video',
): unknown {
	if (review.reviewVersion !== 1 || review.jobId !== workflow.jobId
		|| review.workflowId !== workflow.workflowId || review.outputs.length !== 1) {
		throw new TypeError('Reusable Guided retention changed reviewed workflow authority.');
	}
	const expected = exactOutputClaim(workflow, stageId, slotId);
	const output = review.outputs[0]!;
	if (output.stageId !== stageId || output.slotId !== slotId
		|| output.claim.claimId !== expected.claimId) {
		throw new TypeError('Reusable Guided retention changed terminal claim authority.');
	}
	const wrapped = { schemaVersion: 1, transformId: stageId,
		outputs: { [slotId]: output.semantic } };
	const result = reviewer === 'audio'
		? reviewAssistanceOwnedAudioCutTransformResultV1(wrapped)
		: reviewAssistanceOwnedVideoHighlightTransformResultV1(wrapped);
	return (result.outputs as Readonly<Record<string, unknown>>)[slotId];
}

async function readJson(
	workflow: AssistanceWorkflowV1,
	stageId: string,
	slotId: string,
	readOutput: LocalAssistanceGuidedReusableDerivativeRequest['readOutput'],
	signal: AbortSignal,
): Promise<unknown> {
	const claim = exactOutputClaim(workflow, stageId, slotId);
	const spec = assistanceWorkflowCustodySlotSpec(
		workflow.workflowId, stageId, 'output', slotId,
	);
	const body = await readOutput({ jobId: workflow.jobId,
		workflowId: workflow.workflowId as AssistanceGuidedWorkflowId, claim });
	signal.throwIfAborted();
	if (!(body instanceof Blob) || body.size < 1 || body.size > MAXIMUM_JSON_BYTES
		|| !spec.mediaTypes.includes(body.type)) {
		throw new TypeError(`The reusable ${slotId} body disagrees with authenticated custody.`);
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
			await body.arrayBuffer(),
		)) as unknown;
	} catch {
		throw new TypeError(`The reusable ${slotId} body is not valid UTF-8 JSON.`);
	}
}

function exactOutputClaim(
	workflow: AssistanceWorkflowV1,
	stageId: string,
	slotId: string,
): AssistanceWorkflowOutputClaimV1 {
	const matches = workflow.outputs.filter((claim) => claim.stageId === stageId
		&& claim.slotId === slotId);
	if (matches.length !== 1) throw new TypeError(`The reusable ${slotId} claim is missing or repeated.`);
	return matches[0]!;
}

async function assertCurrentFence(
	resolve: LocalAssistanceGuidedReusableDerivativeRequest['resolveCurrentFence'],
	workflow: AssistanceWorkflowV1,
	signal: AbortSignal,
): Promise<void> {
	signal.throwIfAborted();
	const current = validateAssistanceWorkflowFenceV1(await resolve(workflow, signal));
	signal.throwIfAborted();
	if (JSON.stringify(current) !== JSON.stringify(workflow.fence)) {
		throw new DOMException('Reusable Guided aggregate-fence authority is stale.', 'AbortError');
	}
}
