/* SPDX-License-Identifier: AGPL-3.0-only */

/** Accepted Reframe retention and exact, disposable Make Highlights reuse. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	ASSISTANCE_ACCEPTED_REFRAME_DERIVATIVE_MEDIA_TYPE,
	createAssistanceAcceptedReframeDerivativeV1,
	reviewAssistanceAcceptedReframeDerivativeV1,
	type AssistanceAcceptedReframeDerivativeV1,
} from '../assistance/reframe-derivative-v1.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import type { AssistanceDerivativeRecordV1 } from
	'../storage/assistance-derivative-repository.ts';
import type { AssistanceDerivativeRepositoryPort } from
	'../storage/deferred-assistance-derivative-repository.ts';
import type { LocalAssistanceGuidedHighlightVideoSignalsV1 } from
	'./local-assistance-guided-highlight-signals.ts';
import type { LocalAssistanceGuidedPrimitiveFence } from
	'./local-assistance-guided-transcript-context.ts';

const MAXIMUM_REFRAME_RECORDS = 64;
const MAXIMUM_REFRAME_BYTES = 64 * 1024 * 1024;
const UTF8 = new TextEncoder();
const SHA256 = /^[a-f\d]{64}$/u;
const RECORD_KEY = /^assistance-derivative-v1:([a-f\d]{64}):([a-f\d]{64})$/u;

export interface LocalAssistanceGuidedAcceptedReframeRetentionRequestV1 {
	readonly workflow: unknown;
	readonly result: unknown;
	readonly repository: Pick<AssistanceDerivativeRepositoryPort, 'save'>;
	readonly currentProject: () => PromiseLike<unknown> | unknown;
	readonly signal?: AbortSignal;
}

export async function retainLocalAssistanceGuidedAcceptedReframePathV1(
	request: LocalAssistanceGuidedAcceptedReframeRetentionRequestV1,
): Promise<AssistanceDerivativeRecordV1> {
	if (!request || typeof request !== 'object' || typeof request.repository?.save !== 'function'
		|| typeof request.currentProject !== 'function'
		|| (request.signal !== undefined && !(request.signal instanceof AbortSignal))) {
		throw new TypeError('Accepted Reframe retention requires exact repository and project ports.');
	}
	const workflow = validateAssistanceWorkflow(request.workflow);
	if (workflow.workflowId !== 'reframe') {
		throw new TypeError('Only the closed Reframe workflow retains accepted crop evidence.');
	}
	request.signal?.throwIfAborted();
	const acceptedRevision = await assertAcceptedProject(request.currentProject, workflow);
	const derivative = createAssistanceAcceptedReframeDerivativeV1(
		workflow, request.result, acceptedRevision,
	);
	const bytes = UTF8.encode(JSON.stringify(derivative));
	if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_REFRAME_BYTES) {
		throw new RangeError('Accepted Reframe derivative exceeds its bounded payload size.');
	}
	request.signal?.throwIfAborted();
	const record = await request.repository.save(workflow, 'reframe-path', {
		mediaType: ASSISTANCE_ACCEPTED_REFRAME_DERIVATIVE_MEDIA_TYPE, bytes,
	});
	request.signal?.throwIfAborted();
	await assertAcceptedProject(request.currentProject, workflow);
	return record;
}

export function prepareLocalAssistanceGuidedHighlightReframeEvidenceV1(request: Readonly<{
	readonly video: LocalAssistanceGuidedHighlightVideoSignalsV1;
	readonly fence: LocalAssistanceGuidedPrimitiveFence;
	readonly records: readonly unknown[];
	readonly signal: AbortSignal;
}>): AssistanceAcceptedReframeDerivativeV1 | null {
	if (!(request?.signal instanceof AbortSignal)) {
		throw new TypeError('Highlight Reframe evidence requires one cancellation signal.');
	}
	request.signal.throwIfAborted();
	if (!Array.isArray(request.records) || request.records.length > MAXIMUM_REFRAME_RECORDS) {
		throw new RangeError('Highlight Reframe derivative custody exceeds its record bound.');
	}
	const candidates = request.records.flatMap((candidate) => {
		const record = dataRecord(candidate, 'Highlight Reframe derivative record');
		if (record.kind !== 'reframe-path' || record.projectId !== request.fence.projectId) return [];
		const bytes = authenticatedPayload(record);
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
		} catch {
			throw new TypeError('Highlight Reframe derivative is not valid UTF-8 JSON.');
		}
		const derivative = reviewAssistanceAcceptedReframeDerivativeV1(parsed);
		return matches(derivative, request.video, request.fence) ? [derivative] : [];
	});
	request.signal.throwIfAborted();
	return candidates.length === 1 ? candidates[0]! : null;
}

function authenticatedPayload(record: Record<string, unknown>): Uint8Array {
	const key = typeof record.key === 'string' ? RECORD_KEY.exec(record.key) : null;
	if (record.recordVersion !== 1 || record.schemaVersion !== 1 || key === null
		|| record.projectScopeSha256 !== key[1] || record.identitySha256 !== key[2]
		|| record.mediaType !== ASSISTANCE_ACCEPTED_REFRAME_DERIVATIVE_MEDIA_TYPE
		|| !(record.bytes instanceof Uint8Array) || record.bytes.byteLength < 1
		|| record.bytes.byteLength > MAXIMUM_REFRAME_BYTES
		|| record.size !== record.bytes.byteLength
		|| record.payloadByteLength !== record.bytes.byteLength
		|| typeof record.payloadSha256 !== 'string' || !SHA256.test(record.payloadSha256)
		|| bytesToHex(sha256(record.bytes)) !== record.payloadSha256) {
		throw new Error('Highlight Reframe derivative payload authentication failed.');
	}
	return record.bytes;
}

function matches(
	derivative: AssistanceAcceptedReframeDerivativeV1,
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
	fence: LocalAssistanceGuidedPrimitiveFence,
): boolean {
	const authority = derivative.authority;
	const range = authority.sourceRange;
	if (authority.projectId !== fence.projectId
		|| authority.projectSchemaVersion !== fence.schemaVersion
		|| authority.acceptedProjectRevision !== fence.revision
		|| authority.sequenceId !== fence.sequenceId
		|| range.sourceId !== fence.sourceId || range.sourceSha256 !== fence.sourceSha256
		|| range.sourceStartFrame !== fence.sourceStartFrame
		|| range.sourceEndFrame !== fence.sourceEndFrame
		|| range.linkMembershipSha256 !== fence.linkMembershipSha256
		|| range.timingAuthoritySha256 !== fence.timingAuthoritySha256
		|| range.occurrenceIds.length !== fence.occurrenceIds.length
		|| range.occurrenceIds.some((id, index) => id !== fence.occurrenceIds[index])
		|| video.sourceId !== range.sourceId
		|| video.sourceSize.width !== derivative.result.authority.width
		|| video.sourceSize.height !== derivative.result.authority.height
		|| video.timescale !== derivative.result.authority.timescale
		|| derivative.result.path.targetAspect.width !== 9
		|| derivative.result.path.targetAspect.height !== 16) return false;
	const timing = new Map(video.sourceTimeAuthority.map(({ sourceFrame, presentationTick }) =>
		[sourceFrame, presentationTick] as const));
	return derivative.result.authority.frames.every(({ sourceFrame, presentationTick }) =>
		timing.get(sourceFrame) === presentationTick);
}

async function assertAcceptedProject(
	read: () => PromiseLike<unknown> | unknown,
	workflow: AssistanceWorkflowV1,
): Promise<number> {
	const row = dataRecord(await read(), 'accepted Reframe project authority');
	const acceptedRevision = workflow.fence.revision + 1;
	if (!Number.isSafeInteger(acceptedRevision) || row.projectId !== workflow.fence.projectId
		|| row.projectRevision !== acceptedRevision) {
		throw new DOMException('Accepted Reframe derivative project authority is stale.', 'AbortError');
	}
	return acceptedRevision;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be one record.`);
	}
	return value as Record<string, unknown>;
}
