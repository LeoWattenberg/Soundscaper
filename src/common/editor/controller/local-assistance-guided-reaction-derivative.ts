/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retain reviewed one-second PANNs scores in disposable project custody. */

import { reviewAssistanceAudioTagsV1 } from '../assistance/m7-semantic-results.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceWorkflowFenceV1,
	type AssistanceWorkflowOutputClaimV1,
} from '../assistance/workflow.ts';
import { readProjectSchemaIdentity } from '../project-schema-identity.ts';
import type { AssistanceDerivativeRecordV1 } from
	'../storage/assistance-derivative-repository.ts';
import type { AssistanceDerivativeRepositoryPort } from
	'../storage/deferred-assistance-derivative-repository.ts';

const AUDIO_TAGS_MEDIA_TYPE = 'application/vnd.soundscaper.audio-tags+json';
const AUDIO_TAGS_MEDIA_TYPES = new Set(['application/json', AUDIO_TAGS_MEDIA_TYPE]);
const MAXIMUM_AUDIO_TAGS_BYTES = 8 * 1024 * 1024;
const UTF8 = new TextEncoder();

export interface LocalAssistanceGuidedReactionDerivativeRequest {
	readonly workflow: unknown;
	readonly readOutput: (request: Readonly<{
		readonly jobId: string;
		readonly workflowId: 'mark-reactions';
		readonly claim: AssistanceWorkflowOutputClaimV1;
	}>) => Promise<Blob>;
	readonly repository: Pick<AssistanceDerivativeRepositoryPort, 'save'>;
	readonly currentProject: () => PromiseLike<unknown> | unknown;
	readonly signal?: AbortSignal;
}

export async function retainLocalAssistanceGuidedReactionScores(
	request: LocalAssistanceGuidedReactionDerivativeRequest,
): Promise<AssistanceDerivativeRecordV1> {
	if (!request || typeof request !== 'object' || typeof request.readOutput !== 'function'
		|| typeof request.repository?.save !== 'function' || typeof request.currentProject !== 'function'
		|| (request.signal !== undefined && !(request.signal instanceof AbortSignal))) {
		throw new TypeError('Guided reaction retention requires exact custody and repository ports.');
	}
	const workflow = validateAssistanceWorkflow(request.workflow);
	if (workflow.workflowId !== 'mark-reactions') {
		throw new RangeError('Only the Guided reaction workflow retains PANNs scores.');
	}
	const claim = exactOutputClaim(workflow.outputs, 'tag-reactions', 'audio-tags');
	await assertCurrentProject(request.currentProject, workflow.fence);
	request.signal?.throwIfAborted();
	const body = await request.readOutput({ jobId: workflow.jobId,
		workflowId: 'mark-reactions', claim });
	request.signal?.throwIfAborted();
	if (!(body instanceof Blob) || !AUDIO_TAGS_MEDIA_TYPES.has(body.type) || body.size < 1
		|| body.size > MAXIMUM_AUDIO_TAGS_BYTES) {
		throw new TypeError('The Guided audio-tags body disagrees with its reserved JSON slot.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
			await body.arrayBuffer(),
		)) as unknown;
	} catch {
		throw new TypeError('The Guided audio-tags body is not valid UTF-8 JSON.');
	}
	const reviewed = reviewAssistanceAudioTagsV1(parsed);
	const bytes = UTF8.encode(JSON.stringify(reviewed));
	await assertCurrentProject(request.currentProject, workflow.fence);
	request.signal?.throwIfAborted();
	return await request.repository.save(workflow, 'audio-tags', {
		mediaType: AUDIO_TAGS_MEDIA_TYPE, bytes,
	});
}

function exactOutputClaim(
	claims: readonly AssistanceWorkflowOutputClaimV1[],
	stageId: string,
	slotId: string,
): AssistanceWorkflowOutputClaimV1 {
	const matches = claims.filter((claim) => claim.stageId === stageId && claim.slotId === slotId);
	if (matches.length !== 1) throw new TypeError('The Guided audio-tags claim is missing or repeated.');
	return matches[0]!;
}

async function assertCurrentProject(
	read: () => PromiseLike<unknown> | unknown,
	fence: AssistanceWorkflowFenceV1,
): Promise<void> {
	const value = await read();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Guided reaction retention requires current project authority.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	const identity = readProjectSchemaIdentity(row);
	if (identity.schemaFamily !== fence.schemaFamily
		|| identity.schemaVersion !== fence.schemaVersion
		|| row.projectId !== fence.projectId || row.projectRevision !== fence.revision) {
		throw new DOMException('The Guided reaction project authority is stale.', 'AbortError');
	}
}
