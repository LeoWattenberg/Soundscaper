/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from './scape-archive-media.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from './scape-project-document.ts';
import {
	planExactTakeCycleCapture,
	type ExactTakeCycleCapturePlan,
	type ExactTakeCycleCaptureRequest,
	type TakeCycleCaptureSpan,
} from './take-cycle-capture-domain.ts';
import {
	createTakeMediaPublicationJournal,
	normalizeTakeMediaPublicationJournal,
	transitionTakeMediaPublicationJournal,
	type NormalizedTakeMediaPublicationBinding,
	type TakeMediaPublicationBinding,
	type TakeMediaPublicationJournal,
	type TakeMediaRecoveryDecision,
} from './take-media-recovery-journal.ts';
import {
	normalizeAudioSourceStageReceipt,
	type AudioSourceStageReceipt,
} from './storage/source-write-repository.ts';
import {
	closedRecord,
	denseArray,
	digest,
	nonNegativeSafeInteger,
	positiveSafeInteger,
	stableId,
} from './take-cycle-recovery-envelope-validation.ts';

const TEXT_ENCODER = new TextEncoder();

export type TakeCycleRecoveryEnvelopeState = 'staged' | 'published' | 'committed';

export interface TakeCycleProjectPublicationFence {
	readonly projectId: string;
	readonly baseRevision: number;
	readonly baseSha256: string;
	readonly targetRevision: number;
	readonly targetSha256: string;
}

export interface TakeCycleProjectPublicationEvidence {
	readonly projectId: string;
	readonly revision: number;
	readonly sha256: string;
}

export interface TakeCycleRecoveryEnvelopeEntry {
	readonly journal: TakeMediaPublicationJournal;
	readonly stageReceipt: AudioSourceStageReceipt;
}

export interface TakeCycleRecoveryCaptureRequest extends ExactTakeCycleCaptureRequest {
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
	readonly takeIds: readonly string[];
}

export interface TakeCycleRecoveryEnvelope {
	readonly version: 1;
	readonly envelopeId: string;
	readonly state: TakeCycleRecoveryEnvelopeState;
	readonly generation: number;
	readonly captureRequest: TakeCycleRecoveryCaptureRequest;
	readonly entries: readonly TakeCycleRecoveryEnvelopeEntry[];
	readonly projectFence: TakeCycleProjectPublicationFence;
	readonly targetProjectDocument: string;
}

export interface TakeCycleRecoveryEnvelopePublication {
	readonly journalId: string;
	readonly mediaId: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly stageReceipt: AudioSourceStageReceipt;
}

export interface CreateTakeCycleRecoveryEnvelopeRequest {
	readonly envelopeId: string;
	readonly generation: number;
	readonly captureRequest: ExactTakeCycleCaptureRequest;
	readonly publications: readonly TakeCycleRecoveryEnvelopePublication[];
	readonly projectFence: TakeCycleProjectPublicationFence;
	readonly targetProjectDocument: string;
}

export interface TakeCycleEnvelopeMediaTransition {
	readonly entryIndex: number;
	readonly currentGeneration: number;
	readonly evidence: TakeMediaPublicationBinding;
}

export interface TakeCycleEnvelopeProjectTransition {
	readonly currentGeneration: number;
	readonly evidence: TakeCycleProjectPublicationEvidence;
}

export interface CleanupTakeCycleStagedMediaAction {
	readonly kind: 'cleanup-staged-media';
	readonly envelopeId: string;
	readonly entryIndex: number;
	readonly binding: NormalizedTakeMediaPublicationBinding;
	readonly stageReceipt: AudioSourceStageReceipt;
}

export interface CleanupTakeCyclePublishedMediaAction {
	readonly kind: 'cleanup-published-media';
	readonly envelopeId: string;
	readonly entryIndex: number;
	readonly binding: NormalizedTakeMediaPublicationBinding;
}

export interface ReplayTakeCycleProjectCommitAction {
	readonly kind: 'replay-project-commit';
	readonly envelope: TakeCycleRecoveryEnvelope;
}

export interface RemoveTakeCycleRecoveryEnvelopeAction {
	readonly kind: 'remove-recovery-envelope';
	readonly envelopeId: string;
	readonly generation: number;
	readonly projectId: string;
}

export type TakeCycleEnvelopeRecoveryAction =
	| CleanupTakeCycleStagedMediaAction
	| CleanupTakeCyclePublishedMediaAction
	| ReplayTakeCycleProjectCommitAction
	| RemoveTakeCycleRecoveryEnvelopeAction;

export type TakeCycleEnvelopeRecoveryDisposition =
	| 'clean'
	| 'cleanup-incomplete'
	| 'replay-published'
	| 'discard-uncommitted'
	| 'settle-committed';

export interface TakeCycleEnvelopeRecoveryPlan {
	readonly kind: 'take-cycle-envelope-recovery';
	readonly disposition: TakeCycleEnvelopeRecoveryDisposition;
	readonly envelopeId: string | null;
	readonly generation: number;
	readonly actions: readonly TakeCycleEnvelopeRecoveryAction[];
}

export interface TakeCycleEnvelopeRecoveryRequest {
	readonly currentGeneration: number;
	readonly decision: TakeMediaRecoveryDecision;
	readonly mediaEvidence: readonly (TakeMediaPublicationBinding | null)[];
	readonly projectEvidence: TakeCycleProjectPublicationEvidence | null;
}

export function createTakeCycleRecoveryEnvelope(
	requestValue: unknown,
): TakeCycleRecoveryEnvelope {
	const request = closedRecord(requestValue, 'take cycle envelope creation request', [
		'envelopeId', 'generation', 'captureRequest', 'publications',
		'projectFence', 'targetProjectDocument',
	]);
	const envelopeId = stableId(request.envelopeId, 'take cycle envelopeId');
	const generation = positiveSafeInteger(request.generation, 'take cycle envelope generation');
	const { captureRequest, plan } = normalizeCaptureRequest(request.captureRequest);
	const publications = denseArray(request.publications, 'take cycle envelope publications');
	if (publications.length !== plan.passes.length) {
		throw new RangeError('Take cycle envelope publications must exactly cover every cycle pass.');
	}
	const entries = publications.map((value, entryIndex): TakeCycleRecoveryEnvelopeEntry => {
		const publication = closedRecord(value, `take cycle envelope publications[${String(entryIndex)}]`, [
			'journalId', 'mediaId', 'byteLength', 'sha256', 'stageReceipt',
		]);
		const journal = createTakeMediaPublicationJournal({
			journalId: publication.journalId,
			binding: {
				generation,
				groupId: plan.groupId,
				laneId: plan.laneId,
				takeId: plan.passes[entryIndex]!.takeId,
				mediaId: publication.mediaId,
				byteLength: publication.byteLength,
				sha256: publication.sha256,
			},
		});
		return normalizeEntry({ journal, stageReceipt: publication.stageReceipt }, entryIndex, plan, generation);
	});
	const projectFence = normalizeProjectFence(request.projectFence);
	const targetProjectDocument = normalizeTargetProjectDocument(
		request.targetProjectDocument,
		projectFence,
	);
	assertEnvelopeIdentities(envelopeId, entries);
	return freezeEnvelope({
		envelopeId, state: 'staged', generation, captureRequest,
		entries, projectFence, targetProjectDocument,
	});
}

export function normalizeTakeCycleRecoveryEnvelope(value: unknown): TakeCycleRecoveryEnvelope {
	const envelope = closedRecord(value, 'take cycle recovery envelope', [
		'version', 'envelopeId', 'state', 'generation', 'captureRequest',
		'entries', 'projectFence', 'targetProjectDocument',
	]);
	if (envelope.version !== 1) throw new RangeError('Take cycle recovery envelope version must be 1.');
	const envelopeId = stableId(envelope.envelopeId, 'take cycle envelopeId');
	const generation = positiveSafeInteger(envelope.generation, 'take cycle envelope generation');
	const { captureRequest, plan } = normalizeCaptureRequest(envelope.captureRequest);
	const entries = denseArray(envelope.entries, 'take cycle envelope entries')
		.map((entry, entryIndex) => normalizeEntry(entry, entryIndex, plan, generation));
	if (entries.length !== plan.passes.length) {
		throw new RangeError('Take cycle envelope entries must exactly cover every cycle pass.');
	}
	const state = normalizeEnvelopeState(envelope.state, entries);
	const projectFence = normalizeProjectFence(envelope.projectFence);
	const targetProjectDocument = normalizeTargetProjectDocument(
		envelope.targetProjectDocument,
		projectFence,
	);
	assertEnvelopeIdentities(envelopeId, entries);
	return freezeEnvelope({
		envelopeId, state, generation, captureRequest,
		entries, projectFence, targetProjectDocument,
	});
}

export function takeCycleRecoveryEnvelopePlan(
	envelopeValue: unknown,
): ExactTakeCycleCapturePlan {
	return planExactTakeCycleCapture(
		normalizeTakeCycleRecoveryEnvelope(envelopeValue).captureRequest,
	);
}

export function transitionTakeCycleRecoveryEnvelopeMedia(
	envelopeValue: unknown,
	requestValue: unknown,
): TakeCycleRecoveryEnvelope {
	const envelope = normalizeTakeCycleRecoveryEnvelope(envelopeValue);
	const request = closedRecord(requestValue, 'take cycle envelope media transition', [
		'entryIndex', 'currentGeneration', 'evidence',
	]);
	assertCurrentGeneration(envelope, request.currentGeneration);
	const entryIndex = nonNegativeSafeInteger(request.entryIndex, 'take cycle envelope entryIndex');
	const entry = envelope.entries[entryIndex];
	if (!entry) throw new RangeError('Take cycle envelope entryIndex is outside the lane plan.');
	if (envelope.state === 'committed') return envelope;
	const journal = transitionTakeMediaPublicationJournal(entry.journal, {
		event: 'media-published',
		currentGeneration: envelope.generation,
		evidence: request.evidence,
	});
	const entries = envelope.entries.map((candidate, index) => index === entryIndex
		? Object.freeze({ journal, stageReceipt: candidate.stageReceipt })
		: candidate);
	const state = entries.every((candidate) => candidate.journal.state === 'published')
		? 'published' as const
		: 'staged' as const;
	return freezeEnvelope({ ...envelope, state, entries });
}

export function transitionTakeCycleRecoveryEnvelopeProject(
	envelopeValue: unknown,
	requestValue: unknown,
): TakeCycleRecoveryEnvelope {
	const envelope = normalizeTakeCycleRecoveryEnvelope(envelopeValue);
	const request = closedRecord(requestValue, 'take cycle envelope project transition', [
		'currentGeneration', 'evidence',
	]);
	assertCurrentGeneration(envelope, request.currentGeneration);
	assertProjectEvidence(request.evidence, envelope.projectFence, 'target');
	if (envelope.state === 'committed') return envelope;
	if (envelope.state !== 'published') {
		throw new Error('Cannot commit a cycle project before every lane media item is published.');
	}
	const entries = envelope.entries.map((entry) => Object.freeze({
		journal: transitionTakeMediaPublicationJournal(entry.journal, {
			event: 'project-committed',
			currentGeneration: envelope.generation,
			evidence: entry.journal.binding,
		}),
		stageReceipt: entry.stageReceipt,
	}));
	return freezeEnvelope({ ...envelope, state: 'committed', entries });
}

export function planTakeCycleEnvelopeRecovery(
	envelopeValue: unknown,
	requestValue: unknown,
): TakeCycleEnvelopeRecoveryPlan {
	const request = closedRecord(requestValue, 'take cycle envelope recovery request', [
		'currentGeneration', 'decision', 'mediaEvidence', 'projectEvidence',
	]);
	const currentGeneration = positiveSafeInteger(
		request.currentGeneration,
		'take cycle recovery currentGeneration',
	);
	if (request.decision !== 'recover' && request.decision !== 'discard') {
		throw new RangeError('Take cycle envelope recovery decision must be recover or discard.');
	}
	if (envelopeValue === null) {
		if (denseArray(request.mediaEvidence, 'take cycle recovery media evidence').length
			|| request.projectEvidence !== null) {
			throw new Error('Take cycle recovery evidence has no owning envelope.');
		}
		return freezeRecoveryPlan('clean', null, currentGeneration, []);
	}
	const envelope = normalizeTakeCycleRecoveryEnvelope(envelopeValue);
	assertCurrentGeneration(envelope, currentGeneration);
	const evidence = denseArray(request.mediaEvidence, 'take cycle recovery media evidence');
	if (evidence.length !== envelope.entries.length) {
		throw new RangeError('Take cycle recovery media evidence must exactly cover every envelope entry.');
	}
	let observed = envelope;
	const present = evidence.map((candidate, entryIndex): boolean => {
		if (candidate === null) {
			return false;
		}
		observed = transitionTakeCycleRecoveryEnvelopeMedia(observed, {
			entryIndex, currentGeneration, evidence: candidate,
		});
		return true;
	});
	const projectObservation = classifyProjectEvidence(request.projectEvidence, envelope.projectFence);
	if (projectObservation === 'target') {
		if (!present.every(Boolean)) {
			throw new Error('The exact target project references missing take cycle media.');
		}
		if (request.decision === 'discard') {
			throw new Error('Cannot discard cycle media referenced by the exact target project.');
		}
		return freezeRecoveryPlan('settle-committed', envelope.envelopeId, currentGeneration, [
			removeEnvelopeAction(envelope),
		]);
	}
	if (envelope.state === 'committed') {
		throw new Error('A committed take cycle envelope is missing its exact target project.');
	}
	if (request.decision === 'recover' && present.every(Boolean)) {
		return freezeRecoveryPlan('replay-published', envelope.envelopeId, currentGeneration, [
			Object.freeze({ kind: 'replay-project-commit', envelope: observed }),
			removeEnvelopeAction(envelope),
		]);
	}
	const cleanup = envelope.entries.map((entry, entryIndex): TakeCycleEnvelopeRecoveryAction => (
		present[entryIndex] || entry.journal.state !== 'staged'
			? Object.freeze({
				kind: 'cleanup-published-media',
				envelopeId: envelope.envelopeId,
				entryIndex,
				binding: entry.journal.binding,
			})
			: Object.freeze({
				kind: 'cleanup-staged-media',
				envelopeId: envelope.envelopeId,
				entryIndex,
				binding: entry.journal.binding,
				stageReceipt: entry.stageReceipt,
			})
	));
	return freezeRecoveryPlan(
		request.decision === 'recover' ? 'cleanup-incomplete' : 'discard-uncommitted',
		envelope.envelopeId,
		currentGeneration,
		[...cleanup, removeEnvelopeAction(envelope)],
	);
}

function normalizeCaptureRequest(value: unknown): Readonly<{
	readonly captureRequest: TakeCycleRecoveryCaptureRequest;
	readonly plan: ExactTakeCycleCapturePlan;
}> {
	const request = closedRecord(value, 'take cycle envelope capture request', [
		'groupId', 'laneId', 'loopStartSample', 'loopEndSample',
		'captureSpans', 'takeIds', 'interrupted',
	]);
	const plan = planExactTakeCycleCapture(request);
	const spans = denseArray(request.captureSpans, 'take cycle envelope capture spans')
		.map((span, index): TakeCycleCaptureSpan => {
			const record = closedRecord(span, `take cycle envelope capture spans[${String(index)}]`, [
				'startSample', 'endSample',
			]);
			return Object.freeze({
				startSample: Number(record.startSample),
				endSample: Number(record.endSample),
			});
		});
	return Object.freeze({
		plan,
		captureRequest: Object.freeze({
			groupId: plan.groupId,
			laneId: plan.laneId,
			loopStartSample: plan.loopStartSample,
			loopEndSample: plan.loopEndSample,
			captureSpans: Object.freeze(spans),
			takeIds: Object.freeze(plan.passes.map(({ takeId }) => takeId)),
			interrupted: plan.interrupted,
		}),
	});
}

function normalizeEntry(
	value: unknown,
	entryIndex: number,
	plan: ExactTakeCycleCapturePlan,
	generation: number,
): TakeCycleRecoveryEnvelopeEntry {
	const entry = closedRecord(value, `take cycle envelope entries[${String(entryIndex)}]`, [
		'journal', 'stageReceipt',
	]);
	const journal = normalizeTakeMediaPublicationJournal(entry.journal);
	const pass = plan.passes[entryIndex];
	if (!pass || journal.binding.generation !== generation
		|| journal.binding.groupId !== plan.groupId || journal.binding.laneId !== plan.laneId
		|| journal.binding.takeId !== pass.takeId) {
		throw new Error('Take cycle envelope journal does not match its exact lane pass.');
	}
	const stageReceipt = normalizeAudioSourceStageReceipt(entry.stageReceipt);
	if (stageReceipt.sourceId !== journal.binding.mediaId) {
		throw new Error('Take cycle stage receipt sourceId must equal its exact mediaId.');
	}
	return Object.freeze({ journal, stageReceipt });
}

function normalizeEnvelopeState(
	value: unknown,
	entries: readonly TakeCycleRecoveryEnvelopeEntry[],
): TakeCycleRecoveryEnvelopeState {
	if (value !== 'staged' && value !== 'published' && value !== 'committed') {
		throw new RangeError('Take cycle envelope state must be staged, published, or committed.');
	}
	const states = entries.map(({ journal }) => journal.state);
	const expected = states.every((state) => state === 'committed')
		? 'committed'
		: states.every((state) => state === 'published')
			? 'published'
			: states.every((state) => state === 'staged' || state === 'published')
				? 'staged'
				: null;
	if (value !== expected) throw new Error('Take cycle envelope state does not match its journal states.');
	return value;
}

function normalizeProjectFence(value: unknown): TakeCycleProjectPublicationFence {
	const fence = closedRecord(value, 'take cycle project publication fence', [
		'projectId', 'baseRevision', 'baseSha256', 'targetRevision', 'targetSha256',
	]);
	const result = Object.freeze({
		projectId: stableId(fence.projectId, 'take cycle projectId'),
		baseRevision: nonNegativeSafeInteger(fence.baseRevision, 'take cycle baseRevision'),
		baseSha256: digest(fence.baseSha256, 'take cycle baseSha256'),
		targetRevision: nonNegativeSafeInteger(fence.targetRevision, 'take cycle targetRevision'),
		targetSha256: digest(fence.targetSha256, 'take cycle targetSha256'),
	});
	if (result.targetRevision !== result.baseRevision + 1) {
		throw new RangeError('Take cycle targetRevision must immediately follow baseRevision.');
	}
	if (result.targetSha256 === result.baseSha256) {
		throw new RangeError('Take cycle base and target project digests must be distinct.');
	}
	return result;
}

function normalizeTargetProjectDocument(
	value: unknown,
	fence: TakeCycleProjectPublicationFence,
): string {
	if (typeof value !== 'string') throw new TypeError('Take cycle target project document must be JSON text.');
	const parsed = parseScapeProjectDocument(value);
	if (serializeScapeProjectDocument(parsed) !== value) {
		throw new Error('Take cycle target project document must use canonical serialization.');
	}
	const project = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
		? parsed as Record<string, unknown>
		: null;
	if (project?.id !== fence.projectId || project.revision !== fence.targetRevision) {
		throw new Error('Take cycle target project document does not match its project fence.');
	}
	if (digestScapeBytes(TEXT_ENCODER.encode(value)) !== fence.targetSha256) {
		throw new Error('Take cycle target project digest does not match its publication fence.');
	}
	return value;
}

function classifyProjectEvidence(
	value: unknown,
	fence: TakeCycleProjectPublicationFence,
): 'base' | 'target' {
	if (value === null) throw new Error('Take cycle recovery is missing durable project evidence.');
	const evidence = normalizeProjectEvidence(value);
	if (matchesProjectEvidence(evidence, fence, 'base')) return 'base';
	if (matchesProjectEvidence(evidence, fence, 'target')) return 'target';
	throw new Error('Take cycle project evidence does not match the exact base or target publication fence.');
}

function assertProjectEvidence(
	value: unknown,
	fence: TakeCycleProjectPublicationFence,
	kind: 'base' | 'target',
): void {
	const evidence = normalizeProjectEvidence(value);
	if (!matchesProjectEvidence(evidence, fence, kind)) {
		throw new Error(`Take cycle project evidence does not match the exact ${kind} publication fence.`);
	}
}

function normalizeProjectEvidence(value: unknown): TakeCycleProjectPublicationEvidence {
	const evidence = closedRecord(value, 'take cycle project publication evidence', [
		'projectId', 'revision', 'sha256',
	]);
	return Object.freeze({
		projectId: stableId(evidence.projectId, 'take cycle project evidence projectId'),
		revision: nonNegativeSafeInteger(evidence.revision, 'take cycle project evidence revision'),
		sha256: digest(evidence.sha256, 'take cycle project evidence sha256'),
	});
}

function matchesProjectEvidence(
	evidence: TakeCycleProjectPublicationEvidence,
	fence: TakeCycleProjectPublicationFence,
	kind: 'base' | 'target',
): boolean {
	return evidence.projectId === fence.projectId
		&& evidence.revision === (kind === 'base' ? fence.baseRevision : fence.targetRevision)
		&& evidence.sha256 === (kind === 'base' ? fence.baseSha256 : fence.targetSha256);
}

function assertCurrentGeneration(envelope: TakeCycleRecoveryEnvelope, value: unknown): void {
	const current = positiveSafeInteger(value, 'take cycle recovery currentGeneration');
	if (envelope.generation !== current) {
		throw new Error(
			`Stale take cycle envelope generation ${String(envelope.generation)}; current generation is ${String(current)}.`,
		);
	}
}

function assertEnvelopeIdentities(
	envelopeId: string,
	entries: readonly TakeCycleRecoveryEnvelopeEntry[],
): void {
	const identities = new Set<string>([envelopeId]);
	for (const { journal } of entries) {
		for (const identity of [journal.journalId, journal.binding.takeId, journal.binding.mediaId]) {
			if (identities.has(identity)) throw new RangeError(`Duplicate take cycle envelope identity ${identity}.`);
			identities.add(identity);
		}
	}
}

function freezeEnvelope(
	value: Omit<TakeCycleRecoveryEnvelope, 'version' | 'entries'> & {
		readonly entries: readonly TakeCycleRecoveryEnvelopeEntry[];
	},
): TakeCycleRecoveryEnvelope {
	return Object.freeze({ version: 1, ...value, entries: Object.freeze([...value.entries]) });
}

function removeEnvelopeAction(
	envelope: TakeCycleRecoveryEnvelope,
): RemoveTakeCycleRecoveryEnvelopeAction {
	return Object.freeze({
		kind: 'remove-recovery-envelope',
		envelopeId: envelope.envelopeId,
		generation: envelope.generation,
		projectId: envelope.projectFence.projectId,
	});
}

function freezeRecoveryPlan(
	disposition: TakeCycleEnvelopeRecoveryDisposition,
	envelopeId: string | null,
	generation: number,
	actions: readonly TakeCycleEnvelopeRecoveryAction[],
): TakeCycleEnvelopeRecoveryPlan {
	return Object.freeze({
		kind: 'take-cycle-envelope-recovery',
		disposition,
		envelopeId,
		generation,
		actions: Object.freeze(actions),
	});
}
