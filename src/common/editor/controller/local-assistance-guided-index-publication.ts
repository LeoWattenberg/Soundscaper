/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit acceptance of reviewed semantic indexes into disposable project custody. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { reviewAssistanceEmbeddingMatrixV1 } from '../assistance/binary-formats-v1.ts';
import {
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from '../assistance/owned-audio-cut-transform-results-v1.ts';
import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from '../assistance/owned-video-highlight-transform-results-v1.ts';
import {
	ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
	createAssistanceSemanticDerivativeBundleV1,
} from '../assistance/semantic-derivative-bundle-v1.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowOutputClaimV1,
} from '../assistance/workflow.ts';
import type {
	AssistanceDerivativeRecordV1,
} from '../storage/assistance-derivative-repository.ts';
import type {
	AssistanceDerivativeRepositoryPort,
} from '../storage/deferred-assistance-derivative-repository.ts';
import type {
	LocalAssistanceGuidedReviewedResult,
} from '../ui/local-assistance-guided-result-review.ts';

const MATRIX_MEDIA_TYPE = 'application/vnd.soundscaper.embedding-matrix-v1';
const MAXIMUM_MATRIX_BYTES = 512 * 1024 * 1024;

export interface LocalAssistanceGuidedIndexPublicationRequest {
	readonly workflow: unknown;
	readonly review: LocalAssistanceGuidedReviewedResult;
	readonly selectedChoiceIds: readonly string[];
	readonly readOutput: (request: Readonly<{
		readonly jobId: string;
		readonly workflowId: 'index-transcript' | 'index-video';
		readonly claim: AssistanceWorkflowOutputClaimV1;
	}>) => Promise<Blob>;
	readonly repository: Pick<AssistanceDerivativeRepositoryPort, 'save'>;
	readonly currentProject: () => PromiseLike<unknown> | unknown;
	readonly signal?: AbortSignal;
}

export type LocalAssistanceGuidedIndexPublicationOutcome = Readonly<{
	readonly outcome: 'not-selected';
}> | Readonly<{
	readonly outcome: 'published';
	readonly record: AssistanceDerivativeRecordV1;
}>;

export async function publishLocalAssistanceGuidedIndex(
	request: LocalAssistanceGuidedIndexPublicationRequest,
): Promise<LocalAssistanceGuidedIndexPublicationOutcome> {
	if (!request || typeof request !== 'object' || typeof request.readOutput !== 'function'
		|| typeof request.repository?.save !== 'function' || typeof request.currentProject !== 'function') {
		throw new TypeError('Guided index publication requires exact custody and repository ports.');
	}
	const workflow = validateAssistanceWorkflow(request.workflow);
	if (workflow.workflowId !== 'index-transcript' && workflow.workflowId !== 'index-video') {
		throw new RangeError('Only Guided semantic-index workflows use disposable index publication.');
	}
	const selectionId = workflow.workflowId === 'index-transcript' ? 'transcript-index' : 'video-index';
	const selections = selectedIds(request.selectedChoiceIds, request.review);
	if (!selections.has(selectionId)) return Object.freeze({ outcome: 'not-selected' });
	if (selections.size !== 1) throw new TypeError('Guided index publication received a foreign selection.');
	assertReviewAuthority(workflow, request.review, selectionId);
	await assertCurrentProject(request.currentProject, workflow.fence.projectId, workflow.fence.revision);
	request.signal?.throwIfAborted();

	const matrixClaim = exactOutputClaim(workflow.outputs,
		workflow.workflowId === 'index-transcript' ? 'embed-transcript' : 'embed-visuals',
		workflow.workflowId === 'index-transcript' ? 'embeddings' : 'visual-embeddings');
	const body = await request.readOutput({ jobId: workflow.jobId,
		workflowId: workflow.workflowId, claim: matrixClaim });
	request.signal?.throwIfAborted();
	if (!(body instanceof Blob) || body.type !== MATRIX_MEDIA_TYPE || body.size < 1
		|| body.size > MAXIMUM_MATRIX_BYTES) {
		throw new TypeError('The Guided index embedding body disagrees with its reserved binary slot.');
	}
	const matrixBytes = new Uint8Array(await body.arrayBuffer());
	const matrix = reviewAssistanceEmbeddingMatrixV1(matrixBytes);
	const semantic = terminalSemantic(workflow.workflowId, request.review, selectionId);
	const embedding = record(semantic.embedding, 'Guided index embedding descriptor');
	if (embedding.byteLength !== matrixBytes.byteLength
		|| embedding.sha256 !== bytesToHex(sha256(matrixBytes))
		|| embedding.rowCount !== matrix.rowCount || embedding.dimensions !== matrix.dimensions) {
		throw new Error('The Guided index embedding matrix disagrees with its reviewed descriptor.');
	}
	const rows = workflow.workflowId === 'index-transcript'
		? searchRows(semantic.rows, 'transcript')
		: searchRows(record(semantic.rows, 'video index rows').visual, 'visual');
	const ocr = workflow.workflowId === 'index-video'
		? searchRows(record(semantic.rows, 'video index rows').ocr, 'OCR') : Object.freeze([]);
	const sourceId = String(semantic.sourceId);
	if (!workflow.fence.sourceRanges.some((range) => range.sourceId === sourceId)) {
		throw new Error('The Guided index source changed after aggregate-fence review.');
	}
	const bytes = createAssistanceSemanticDerivativeBundleV1({
		provider: workflow.workflowId === 'index-transcript' ? 'transcript' : 'visual',
		projectId: workflow.fence.projectId, projectRevision: workflow.fence.revision,
		sequenceId: workflow.fence.sequenceId, sourceId, matrix: matrixBytes, rows, ocr,
	});
	await assertCurrentProject(request.currentProject, workflow.fence.projectId, workflow.fence.revision);
	request.signal?.throwIfAborted();
	const recordValue = await request.repository.save(workflow,
		workflow.workflowId === 'index-transcript' ? 'embeddings' : 'visual-index', {
			mediaType: ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE, bytes,
		});
	return Object.freeze({ outcome: 'published', record: recordValue });
}

function terminalSemantic(
	workflowId: 'index-transcript' | 'index-video',
	review: LocalAssistanceGuidedReviewedResult,
	slotId: string,
): Record<string, unknown> {
	const output = review.outputs.find((candidate) => candidate.slotId === slotId);
	if (!output) throw new TypeError('The Guided index review omitted its terminal semantic result.');
	const wrapper = { schemaVersion: 1,
		transformId: workflowId === 'index-transcript' ? 'publish-transcript-index' : 'publish-video-index',
		outputs: { [slotId]: output.semantic } };
	const reviewed = workflowId === 'index-transcript'
		? reviewAssistanceOwnedAudioCutTransformResultV1(wrapper)
		: reviewAssistanceOwnedVideoHighlightTransformResultV1(wrapper);
	return record((reviewed as Readonly<{ outputs: Readonly<Record<string, unknown>> }>).outputs[slotId],
		'Guided index semantic result');
}

function assertReviewAuthority(
	workflow: ReturnType<typeof validateAssistanceWorkflow>,
	review: LocalAssistanceGuidedReviewedResult,
	slotId: string,
): void {
	if (review.reviewVersion !== 1 || review.jobId !== workflow.jobId
		|| review.workflowId !== workflow.workflowId || review.outputs.length !== 1) {
		throw new TypeError('The Guided index review changed its workflow authority.');
	}
	const expected = exactOutputClaim(workflow.outputs,
		workflow.workflowId === 'index-transcript' ? 'publish-transcript-index' : 'publish-video-index',
		slotId);
	const actual = review.outputs[0]!;
	if (actual.claim.claimId !== expected.claimId || actual.stageId !== expected.stageId
		|| actual.slotId !== expected.slotId) {
		throw new TypeError('The Guided index review changed its terminal claim authority.');
	}
}

function exactOutputClaim(
	claims: readonly AssistanceWorkflowOutputClaimV1[], stageId: string, slotId: string,
): AssistanceWorkflowOutputClaimV1 {
	const matches = claims.filter((claim) => claim.stageId === stageId && claim.slotId === slotId);
	if (matches.length !== 1) throw new TypeError('The Guided index output claim is missing or repeated.');
	return matches[0]!;
}

function selectedIds(
	value: unknown,
	review: LocalAssistanceGuidedReviewedResult,
): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length > review.choices.length) {
		throw new RangeError('The Guided index selection inventory is invalid.');
	}
	const available = new Set(review.choices.filter(({ enabled }) => enabled).map(({ id }) => id));
	const result = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== 'string' || !available.has(candidate) || result.has(candidate)) {
			throw new TypeError('The Guided index selection is unavailable or repeated.');
		}
		result.add(candidate);
	}
	return result;
}

async function assertCurrentProject(
	currentProject: LocalAssistanceGuidedIndexPublicationRequest['currentProject'],
	projectId: string,
	projectRevision: number,
): Promise<void> {
	const value = await currentProject();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Guided index publication requires current project authority.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (row.projectId !== projectId || row.projectRevision !== projectRevision) {
		throw new DOMException('The Guided index aggregate fence is stale.', 'AbortError');
	}
}

function searchRows(value: unknown, label: string) {
	if (!Array.isArray(value)) throw new TypeError(`The ${label} search rows are invalid.`);
	return Object.freeze(value.map((candidate) => {
		const row = record(candidate, `${label} search row`);
		return Object.freeze({ resultId: String(row.resultId),
			timelineFrame: Number(row.timelineFrame), label: String(row.label) });
	}));
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as Record<string, unknown>;
}
