/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed terminal-output selection and semantic re-admission for Guided workflows. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	validateAssistanceWorkflow,
	type AssistanceGuidedWorkflowId,
	type AssistanceWorkflowOutputClaimV1,
	type AssistanceWorkflowV1,
} from './workflow.ts';
import { assistanceWorkflowCustodySlotSpec } from './workflow-custody-v1.ts';
import {
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from './owned-audio-cut-transform-results-v1.ts';
import type {
	AssistanceOwnedAudioCutTransformIdV1,
} from './owned-audio-cut-transform-types-v1.ts';
import {
	reviewAssistanceOwnedVideoHighlightTransformResultV1,
} from './owned-video-highlight-transform-results-v1.ts';
import type {
	AssistanceOwnedVideoHighlightTransformIdV1,
} from './owned-video-highlight-transform-types-v1.ts';
import { reviewAssistanceEditorialProposalV1 } from './m7-semantic-results.ts';
import type {
	AssistanceWorkflowReviewAuthorityV1,
} from './workflow-review-authority-v1.ts';
import { validateAssistanceWorkflowReviewAuthorityV1 } from
	'./workflow-review-authority-v1.ts';
import type { LocalAssistanceOutputClaim } from './local-assistance-bridge.ts';
import {
	reviewLocalAssistanceOutput,
} from './local-assistance-result-review.ts';

const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;

type CompletedWorkflowResult = Readonly<{
	contractVersion: 1;
	jobId: string;
	workflowId: AssistanceWorkflowV1['workflowId'];
	stageIds: readonly string[];
	outputs: AssistanceWorkflowV1['outputs'];
}>;

export type LocalAssistanceGuidedReviewAuthority = AssistanceWorkflowReviewAuthorityV1;

export interface LocalAssistanceGuidedReviewChoice {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly selected: false;
	readonly enabled: boolean;
}

export interface LocalAssistanceGuidedReviewedOutput {
	readonly stageId: string;
	readonly slotId: string;
	readonly claim: AssistanceWorkflowOutputClaimV1;
	readonly mediaType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly body: Blob;
	readonly semantic: unknown;
}

export interface LocalAssistanceGuidedReviewedResult {
	readonly reviewVersion: 1;
	readonly jobId: string;
	readonly workflowId: AssistanceGuidedWorkflowId;
	readonly outputs: readonly LocalAssistanceGuidedReviewedOutput[];
	readonly choices: readonly LocalAssistanceGuidedReviewChoice[];
}

export interface LocalAssistanceGuidedResultReviewRequest {
	readonly workflow: AssistanceWorkflowV1;
	readonly result: CompletedWorkflowResult;
	readonly readOutput: (request: Readonly<{
		jobId: string;
		workflowId: AssistanceWorkflowV1['workflowId'];
		claim: AssistanceWorkflowOutputClaimV1;
	}>) => Promise<Blob>;
	readonly authority?: LocalAssistanceGuidedReviewAuthority;
	readonly signal?: AbortSignal;
}

interface TerminalSpec {
	readonly stageId: string;
	readonly slotIds: readonly string[];
	readonly reviewer: 'audio' | 'editorial' | AssistanceOwnedAudioCutTransformIdV1
		| AssistanceOwnedVideoHighlightTransformIdV1;
}

const TERMINALS = Object.freeze({
	'transcribe-captions': terminal('assemble-captions', ['captions'], 'assemble-captions'),
	'clean-filler-silence': terminal('propose-cleanup', ['cleanup-proposals'], 'propose-cleanup'),
	'identify-speakers': terminal('attribute-speakers', ['attributed-transcript'], 'attribute-speakers'),
	'enhance-dialogue': terminal('enhance-dialogue', ['enhanced-audio'], 'audio'),
	'reduce-reverb': terminal('reduce-reverb', ['dereverberated-audio'], 'audio'),
	'separate-dialogue-music-effects': terminal('separate-sources',
		['dialogue', 'music', 'effects'], 'audio'),
	'mark-reactions': terminal('merge-reaction-ranges', ['reaction-ranges'], 'merge-reaction-ranges'),
	'index-transcript': terminal('publish-transcript-index', ['transcript-index'],
		'publish-transcript-index'),
	'detect-beats-tempo': terminal('propose-tempo-map', ['beat-labels', 'tempo-map-diff'],
		'propose-tempo-map'),
	'mark-cuts': terminal('normalize-cuts', ['cut-proposals'], 'normalize-cuts'),
	'index-video': terminal('publish-video-index', ['video-index'], 'publish-video-index'),
	reframe: terminal('plan-crops', ['reframe-path'], 'plan-crops'),
	'make-highlights': terminal('assemble-highlights', ['highlight-proposals'], 'assemble-highlights'),
	'generate-editorial-text': terminal('generate-editorial-text', ['editorial-proposal'], 'editorial'),
} satisfies Readonly<Record<AssistanceGuidedWorkflowId, TerminalSpec>>);

export async function reviewLocalAssistanceGuidedResult(
	request: LocalAssistanceGuidedResultReviewRequest,
): Promise<LocalAssistanceGuidedReviewedResult> {
	if (!request || typeof request !== 'object' || typeof request.readOutput !== 'function') {
		throw new TypeError('Guided result review requires exact output custody.');
	}
	const workflow = validateAssistanceWorkflow(request.workflow);
	if (workflow.workflowId.startsWith('advanced:')) {
		throw new RangeError('Advanced operations use the operation-v1 result reviewer.');
	}
	const workflowId = workflow.workflowId as AssistanceGuidedWorkflowId;
	assertCompletedResult(request.result, workflow);
	const spec = TERMINALS[workflowId];
	if (!workflow.stageIds.includes(spec.stageId)) {
		throw new TypeError('The completed Guided workflow omitted its terminal stage.');
	}
	const claims = spec.slotIds.map((slotId) => exactTerminalClaim(workflow, spec.stageId, slotId));
	request.signal?.throwIfAborted();
	const loaded: LoadedOutput[] = [];
	for (const claim of claims) {
		request.signal?.throwIfAborted();
		const body = await request.readOutput({
			jobId: workflow.jobId, workflowId, claim,
		});
		loaded.push(await loadOutput(workflowId, claim, body, request.signal));
	}
	request.signal?.throwIfAborted();
	const authority = validateAssistanceWorkflowReviewAuthorityV1(request.authority ?? {
		reviewAuthorityVersion: 1, audioWave: null, editorialCandidateIds: null,
		highlightVideoSignals: null,
		media: { audio: null, video: null },
	});
	const semantics = await reviewSemantics(spec, loaded, authority);
	assertSemanticSourceAuthority(workflow, semantics);
	const outputs = Object.freeze(loaded.map((output) => Object.freeze({
		stageId: output.claim.stageId, slotId: output.claim.slotId, claim: output.claim,
		mediaType: output.body.type, byteLength: output.body.size, sha256: output.sha256,
		body: output.body, semantic: semantics.get(output.claim.slotId),
	})));
	return Object.freeze({ reviewVersion: 1, jobId: workflow.jobId, workflowId,
		outputs, choices: reviewChoices(workflowId, semantics) });
}

interface LoadedOutput {
	readonly claim: AssistanceWorkflowOutputClaimV1;
	readonly body: Blob;
	readonly sha256: string;
	readonly json: unknown;
}

async function loadOutput(
	workflowId: AssistanceGuidedWorkflowId,
	claim: AssistanceWorkflowOutputClaimV1,
	bodyValue: unknown,
	signal?: AbortSignal,
): Promise<LoadedOutput> {
	const slot = assistanceWorkflowCustodySlotSpec(workflowId, claim.stageId, 'output', claim.slotId);
	if (!(bodyValue instanceof Blob) || bodyValue.size < 1
		|| !slot.mediaTypes.includes(bodyValue.type)) {
		throw new TypeError('A Guided terminal body disagrees with its reserved slot.');
	}
	const audio = claim.slotId === 'enhanced-audio' || claim.slotId === 'dereverberated-audio'
		|| claim.slotId === 'dialogue' || claim.slotId === 'music' || claim.slotId === 'effects';
	if (!audio && bodyValue.size > MAXIMUM_JSON_BYTES) {
		throw new RangeError('A Guided terminal body exceeds its semantic review bound.');
	}
	signal?.throwIfAborted();
	const bytes = audio ? null : new Uint8Array(await bodyValue.arrayBuffer());
	const digest = audio ? await digestBlob(bodyValue, signal) : bytesToHex(sha256(bytes!));
	let json: unknown = null;
	if (!audio) {
		try {
			json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes!)) as unknown;
		} catch {
			throw new TypeError('A Guided terminal result is not valid UTF-8 JSON.');
		}
	}
	return Object.freeze({ claim, body: bodyValue.slice(0, bodyValue.size, bodyValue.type),
		sha256: digest, json });
}

async function digestBlob(body: Blob, signal?: AbortSignal): Promise<string> {
	const digest = sha256.create();
	const reader = body.stream().getReader();
	try {
		while (true) {
			signal?.throwIfAborted();
			const chunk = await reader.read();
			if (chunk.done) break;
			digest.update(chunk.value);
		}
		signal?.throwIfAborted();
		return bytesToHex(digest.digest());
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

async function reviewSemantics(
	spec: TerminalSpec,
	outputs: readonly LoadedOutput[],
	authority: LocalAssistanceGuidedReviewAuthority,
): Promise<ReadonlyMap<string, unknown>> {
	if (spec.reviewer === 'audio') {
		const reviewed = await Promise.all(outputs.map(async (output) => {
			const role = output.claim.slotId === 'enhanced-audio'
				|| output.claim.slotId === 'dereverberated-audio'
				? 'enhanced-audio' : 'separated-audio';
			const claim: LocalAssistanceOutputClaim = Object.freeze({ claimVersion: 1,
				claimId: output.claim.claimId, jobId: output.claim.jobId, role,
				mediaType: output.body.type, byteLength: output.body.size, sha256: output.sha256 });
			return [output.claim.slotId, await reviewLocalAssistanceOutput(
				claim, output.body, { ...(authority.audioWave ? { audioWave: authority.audioWave } : {}) },
			)] as const;
		}));
		return new Map(reviewed);
	}
	const values = Object.fromEntries(outputs.map(({ claim, json }) => [claim.slotId, json]));
	if (spec.reviewer === 'editorial') {
		if (!authority.editorialCandidateIds) {
			throw new TypeError('Editorial review requires exact candidate authority.');
		}
		return new Map([[spec.slotIds[0]!, reviewAssistanceEditorialProposalV1(
			values[spec.slotIds[0]!], authority.editorialCandidateIds,
		)]]);
	}
	const wrapper = { schemaVersion: 1, transformId: spec.reviewer, outputs: values };
	const reviewed = isAudioCutReviewer(spec.reviewer)
		? reviewAssistanceOwnedAudioCutTransformResultV1(wrapper)
		: reviewAssistanceOwnedVideoHighlightTransformResultV1(wrapper);
	const admitted = (reviewed as Readonly<{ outputs: Readonly<Record<string, unknown>> }>).outputs;
	return new Map(spec.slotIds.map((slotId) => [slotId, admitted[slotId]]));
}

function reviewChoices(
	workflowId: AssistanceGuidedWorkflowId,
	semantics: ReadonlyMap<string, unknown>,
): readonly LocalAssistanceGuidedReviewChoice[] {
	const choice = (id: string, kind: string, label: string, enabled = true) => Object.freeze({
		id, kind, label, selected: false as const, enabled,
	});
	const value = (slotId: string) => record(semantics.get(slotId), `${slotId} semantic result`);
	switch (workflowId) {
		case 'transcribe-captions': {
			const count = array(value('captions').cues).length;
			return Object.freeze([choice('captions', 'captions', `${String(count)} caption ${plural(count, 'cue')}`)]);
		}
		case 'clean-filler-silence': return itemChoices(value('cleanup-proposals').proposals,
			'cleanup', 'Cleanup edit');
		case 'identify-speakers': return Object.freeze([choice(
			'attributed-transcript', 'transcript', 'Attributed transcript',
		)]);
		case 'enhance-dialogue': return Object.freeze([choice(
			'enhanced-audio', 'audio', 'Enhanced Dialogue',
		)]);
		case 'reduce-reverb': return Object.freeze([choice(
			'dereverberated-audio', 'audio', 'Reduced Reverb',
		)]);
		case 'separate-dialogue-music-effects': return Object.freeze([
			choice('dialogue', 'audio', 'Dialogue'), choice('music', 'audio', 'Music'),
			choice('effects', 'audio', 'Effects'),
		]);
		case 'mark-reactions': return itemChoices(value('reaction-ranges').ranges,
			'reaction', 'Reaction range');
		case 'index-transcript': return Object.freeze([choice(
			'transcript-index', 'index', `${String(array(value('transcript-index').rows).length)} transcript index rows`,
		)]);
		case 'detect-beats-tempo': {
			const labels = value('beat-labels');
			const points = labels.publicationRequested === true
				? itemChoices(labels.points, 'beat', 'Beat point') : Object.freeze([]);
			const diff = value('tempo-map-diff');
			return diff.applicationRequested !== true || diff.proposal === null ? points : Object.freeze([
				...points, choice('beat-grid:tempo-map', 'tempo-map', 'Tempo map', true),
			]);
		}
		case 'mark-cuts': return itemChoices(value('cut-proposals').proposals, 'cut', 'Cut');
		case 'index-video': return Object.freeze([choice(
			'video-index', 'index', `${String(array(value('video-index').sampleAuthority).length)} video index rows`,
		)]);
		case 'reframe': return Object.freeze([choice('reframe-path', 'reframe', 'Reframe crop path')]);
		case 'make-highlights': return itemChoices(value('highlight-proposals').proposals,
			'highlight', 'Highlight');
		case 'generate-editorial-text': return itemChoices(value('editorial-proposal').candidates,
			'editorial', 'Editorial text', 'candidateId');
	}
}

function itemChoices(
	value: unknown,
	kind: string,
	label: string,
	idField = 'id',
): readonly LocalAssistanceGuidedReviewChoice[] {
	return Object.freeze(array(value).map((candidate, index) => {
		const row = record(candidate, `${kind} choice`);
		const id = row[idField];
		if (typeof id !== 'string') throw new TypeError(`A reviewed ${kind} choice has no identity.`);
		return Object.freeze({ id, kind, label: `${label} ${String(index + 1)}`,
			selected: false as const, enabled: true });
	}));
}

function assertCompletedResult(value: unknown, workflow: AssistanceWorkflowV1): void {
	const row = exactRecord(value,
		['contractVersion', 'jobId', 'workflowId', 'stageIds', 'outputs'], 'completed workflow result');
	if (row.contractVersion !== 1 || row.jobId !== workflow.jobId || row.workflowId !== workflow.workflowId
		|| !same(row.stageIds, workflow.stageIds) || !same(row.outputs, workflow.outputs)) {
		throw new TypeError('The completed Guided result is not correlated with its workflow claims.');
	}
}

function exactTerminalClaim(
	workflow: AssistanceWorkflowV1,
	stageId: string,
	slotId: string,
): AssistanceWorkflowOutputClaimV1 {
	const matches = workflow.outputs.filter((claim) => claim.stageId === stageId && claim.slotId === slotId);
	if (matches.length !== 1) throw new TypeError('A Guided terminal output claim is missing or repeated.');
	return matches[0]!;
}

function assertSemanticSourceAuthority(
	workflow: AssistanceWorkflowV1,
	semantics: ReadonlyMap<string, unknown>,
): void {
	for (const semantic of semantics.values()) {
		if (!semantic || typeof semantic !== 'object' || Array.isArray(semantic)) continue;
		const sourceId = (semantic as Readonly<Record<string, unknown>>).sourceId;
		if (sourceId !== undefined && (typeof sourceId !== 'string'
			|| !workflow.fence.sourceRanges.some((range) => range.sourceId === sourceId))) {
			throw new RangeError('A Guided terminal result changed its fenced source identity.');
		}
	}
}

function isAudioCutReviewer(
	value: TerminalSpec['reviewer'],
): value is AssistanceOwnedAudioCutTransformIdV1 {
	return [
		'assemble-captions', 'propose-cleanup', 'attribute-speakers', 'merge-reaction-ranges',
		'publish-transcript-index', 'propose-tempo-map', 'normalize-cuts',
	].includes(value);
}

function terminal(
	stageId: string,
	slotIds: readonly string[],
	reviewer: TerminalSpec['reviewer'],
): TerminalSpec {
	return Object.freeze({ stageId, slotIds: Object.freeze([...slotIds]), reviewer });
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	const row = record(value, label);
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return row;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new TypeError('A reviewed Guided result list is invalid.');
	return value;
}

function plural(count: number, singular: string): string { return count === 1 ? singular : `${singular}s`; }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
