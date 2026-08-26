/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit controller adaptation from reviewed aggregate terminals to owned primitive publishers. */

import {
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from '../assistance/owned-audio-cut-transform-results-v1.ts';
import type {
	AssistanceBeatLabelsV1,
	AssistanceCleanupProposalsV1,
	AssistanceCutProposalsV1,
	AssistanceReactionRangesV1,
	AssistanceTempoMapDiffV1,
} from '../assistance/owned-audio-cut-transform-types-v1.ts';
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	normalizeAssistanceWorkflowId,
	validateAssistanceWorkflow,
	type AssistanceWorkflowId,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import type { LocalAssistanceAudioPublicationChoice } from
	'./local-assistance-audio-publication.ts';
import {
	createGuidedAttributedTranscriptAcceptanceRequest,
	createGuidedAudioAcceptanceRequest,
	createGuidedBeatAcceptanceRequest,
	createGuidedCutAcceptanceRequest,
	createGuidedReactionAcceptanceRequest,
	createGuidedTranscriptAcceptanceRequest,
	type LocalAssistanceGuidedAdaptedOutput,
} from './local-assistance-guided-result-requests.ts';
import {
	hasLocalAssistanceGuidedFramescaperPort,
	localAssistanceGuidedFramescaperChoices,
	publishLocalAssistanceGuidedFramescaperSelection,
	reviewLocalAssistanceGuidedFramescaperSemantics,
	type LocalAssistanceGuidedFramescaperAcceptancePorts,
} from './local-assistance-guided-framescaper-acceptance.ts';

export type {
	LocalAssistanceGuidedHighlightAcceptanceRequest,
	LocalAssistanceGuidedReframeAcceptanceRequest,
} from './local-assistance-guided-framescaper-acceptance.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type SupportedWorkflowId = 'transcribe-captions' | 'clean-filler-silence' | 'identify-speakers'
	| 'enhance-dialogue' | 'separate-dialogue-music-effects' | 'mark-reactions'
	| 'detect-beats-tempo' | 'mark-cuts' | 'reframe' | 'make-highlights';
type AcceptancePhase = 'review' | 'accepting' | 'accepted' | 'rejected' | 'cancelled' | 'failed';

export type LocalAssistanceGuidedAcceptanceUnsupportedReason =
	| 'workflow-publication-unavailable'
	| 'primitive-acceptance-unavailable'
	| 'retime-publication-unavailable'
	| 'partial-separation-selection';

export interface LocalAssistanceGuidedAcceptanceChoice {
	readonly id: string;
	readonly kind: string;
	readonly label: string;
	readonly selected: false;
	readonly enabled: boolean;
}

export interface LocalAssistanceGuidedAcceptanceSnapshot {
	readonly workflowId: SupportedWorkflowId;
	readonly phase: AcceptancePhase;
	readonly choices: readonly LocalAssistanceGuidedAcceptanceChoice[];
	readonly selectedIds: readonly string[];
}

export type LocalAssistanceGuidedAcceptanceDecisionOutcome = Readonly<{
	outcome: 'accepted'; selectedIds: readonly string[];
}> | Readonly<{
	outcome: 'unsupported'; workflowId: 'separate-dialogue-music-effects';
	reason: 'partial-separation-selection';
}>;

export interface LocalAssistanceGuidedAcceptanceSession {
	readonly signal: AbortSignal;
	snapshot(): LocalAssistanceGuidedAcceptanceSnapshot;
	accept(selectedIds: readonly string[]): Promise<LocalAssistanceGuidedAcceptanceDecisionOutcome>;
	reject(): Promise<void>;
	cancel(): Promise<void>;
}

export type LocalAssistanceGuidedAcceptanceAvailability = Readonly<{
	outcome: 'ready'; session: LocalAssistanceGuidedAcceptanceSession;
}> | Readonly<{
	outcome: 'unsupported'; workflowId: AssistanceWorkflowId;
	reason: Exclude<LocalAssistanceGuidedAcceptanceUnsupportedReason, 'partial-separation-selection'>;
}>;

interface BeatReviewSessionPort {
	readonly signal: AbortSignal;
	snapshot(): unknown;
	accept(selectedIds: readonly string[]): Promise<void>;
	reject(): Promise<void>;
	cancel(): Promise<void>;
}

export interface LocalAssistanceGuidedResultAcceptanceDependencies
	extends LocalAssistanceGuidedFramescaperAcceptancePorts {
	/** Same selected-media projection used by primitive preparation and acceptance. */
	readonly currentSelectionFence: () => unknown;
	/** Existing transcript/shot result facade. */
	readonly acceptValidatedResult?: (request: unknown) => Awaitable<void>;
	/** Existing geometry-authenticated audio publication controller. */
	readonly acceptAudioResult?: (
		request: unknown,
		choice: LocalAssistanceAudioPublicationChoice,
	) => Awaitable<void>;
	/** Existing disjoint ripple-delete publisher over reviewed cleanup proposals. */
	readonly acceptCleanupResult?: (request: Readonly<{
		readonly selectionFence: AssistanceSelectionFence;
		readonly result: AssistanceCleanupProposalsV1;
		readonly selectedProposalIds: readonly string[];
	}>) => Awaitable<void>;
	/** Existing Beat This proposal-session factory. */
	readonly createBeatReviewSession?: (request: unknown) => BeatReviewSessionPort;
	/** Existing owned Reactions label-track proposal-session factory. */
	readonly createReactionReviewSession?: (request: unknown) => BeatReviewSessionPort;
}

export interface LocalAssistanceGuidedResultAcceptance {
	createAcceptanceSession(request: Readonly<{
		readonly workflow: unknown;
		readonly reviewedResult: unknown;
	}>): LocalAssistanceGuidedAcceptanceAvailability;
}

type ReviewedOutput = LocalAssistanceGuidedAdaptedOutput;

interface NormalizedReview {
	readonly outputs: ReadonlyMap<string, ReviewedOutput>;
	readonly choices: readonly LocalAssistanceGuidedAcceptanceChoice[];
}

const SUPPORTED = new Set<AssistanceWorkflowId>([
	'transcribe-captions', 'clean-filler-silence', 'identify-speakers', 'enhance-dialogue',
	'separate-dialogue-music-effects',
	'mark-reactions', 'detect-beats-tempo', 'mark-cuts', 'reframe', 'make-highlights',
]);
const TERMINALS = Object.freeze({
	'transcribe-captions': Object.freeze({ stageId: 'assemble-captions', slots: ['captions'] }),
	'clean-filler-silence': Object.freeze({
		stageId: 'propose-cleanup', slots: ['cleanup-proposals'],
	}),
	'identify-speakers': Object.freeze({
		stageId: 'attribute-speakers', slots: ['attributed-transcript'],
	}),
	'enhance-dialogue': Object.freeze({ stageId: 'enhance-dialogue', slots: ['enhanced-audio'] }),
	'separate-dialogue-music-effects': Object.freeze({
		stageId: 'separate-sources', slots: ['dialogue', 'music', 'effects'],
	}),
	'mark-reactions': Object.freeze({
		stageId: 'merge-reaction-ranges', slots: ['reaction-ranges'],
	}),
	'detect-beats-tempo': Object.freeze({
		stageId: 'propose-tempo-map', slots: ['beat-labels', 'tempo-map-diff'],
	}),
	'mark-cuts': Object.freeze({ stageId: 'normalize-cuts', slots: ['cut-proposals'] }),
	reframe: Object.freeze({ stageId: 'plan-crops', slots: ['reframe-path'] }),
	'make-highlights': Object.freeze({
		stageId: 'assemble-highlights', slots: ['highlight-proposals'],
	}),
} satisfies Readonly<Record<SupportedWorkflowId, Readonly<{
	stageId: string; slots: readonly string[];
}>>>);
const SHA256 = /^[a-f\d]{64}$/u;
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;

export function createLocalAssistanceGuidedResultAcceptance(
	dependencies: LocalAssistanceGuidedResultAcceptanceDependencies,
): Readonly<LocalAssistanceGuidedResultAcceptance> {
	if (!dependencies || typeof dependencies !== 'object'
		|| typeof dependencies.currentSelectionFence !== 'function'
		|| (dependencies.acceptValidatedResult !== undefined
			&& typeof dependencies.acceptValidatedResult !== 'function')
		|| (dependencies.acceptAudioResult !== undefined
			&& typeof dependencies.acceptAudioResult !== 'function')
		|| (dependencies.acceptCleanupResult !== undefined
			&& typeof dependencies.acceptCleanupResult !== 'function')
		|| (dependencies.createBeatReviewSession !== undefined
			&& typeof dependencies.createBeatReviewSession !== 'function')
		|| (dependencies.createReactionReviewSession !== undefined
			&& typeof dependencies.createReactionReviewSession !== 'function')
		|| (dependencies.acceptReframeResult !== undefined
			&& typeof dependencies.acceptReframeResult !== 'function')
		|| (dependencies.acceptHighlightResult !== undefined
			&& typeof dependencies.acceptHighlightResult !== 'function')) {
		throw new TypeError('Guided acceptance requires exact primitive publication ports.');
	}

	return Object.freeze({ createAcceptanceSession });

	function createAcceptanceSession(value: Readonly<{
		readonly workflow: unknown; readonly reviewedResult: unknown;
	}>): LocalAssistanceGuidedAcceptanceAvailability {
		const requestedId = workflowId(value?.workflow);
		if (!SUPPORTED.has(requestedId)) return unsupported(requestedId,
			'workflow-publication-unavailable');
		const workflow = validateAssistanceWorkflow(value.workflow);
		const workflowIdValue = workflow.workflowId as SupportedWorkflowId;
		if (!hasPort(workflowIdValue, dependencies)) return unsupported(workflowIdValue,
			'primitive-acceptance-unavailable');
		const range = soleSourceRange(workflow, workflowIdValue);
		if (workflowIdValue !== 'mark-cuts' && workflowIdValue !== 'reframe'
			&& workflow.fence.sourceRanges.some(({ retimeKind }) => retimeKind !== 'identity')) {
			return unsupported(workflowIdValue, 'retime-publication-unavailable');
		}
		const fence = primitiveFence(workflow, range, workflowIdValue === 'make-highlights'
			? workflow.fence.sourceRanges.flatMap(({ occurrenceIds }) => occurrenceIds).sort()
			: range.occurrenceIds);
		assertCurrentFence(dependencies, fence);
		const review = normalizeReview(workflow, workflowIdValue, value.reviewedResult);
		return Object.freeze({ outcome: 'ready' as const,
			session: createSession(dependencies, workflow, workflowIdValue, fence, review) });
	}
}

function createSession(
	dependencies: LocalAssistanceGuidedResultAcceptanceDependencies,
	workflow: AssistanceWorkflowV1,
	workflowId: SupportedWorkflowId,
	fence: AssistanceSelectionFence,
	review: NormalizedReview,
): LocalAssistanceGuidedAcceptanceSession {
	const controller = new AbortController();
	const proposalSession = workflowId === 'detect-beats-tempo'
		? dependencies.createBeatReviewSession!(createGuidedBeatAcceptanceRequest(
			workflow, fence, review.outputs,
		)) : workflowId === 'mark-reactions'
			? dependencies.createReactionReviewSession!(createGuidedReactionAcceptanceRequest(
				workflow, fence, review.outputs,
			)) : null;
	let phase: AcceptancePhase = 'review';
	let selectedIds: readonly string[] = Object.freeze([]);
	const snapshot = (): LocalAssistanceGuidedAcceptanceSnapshot => Object.freeze({
		workflowId, phase, choices: review.choices, selectedIds,
	});
	const assertReview = (): void => {
		if (phase !== 'review') throw new Error('This Guided acceptance session no longer accepts decisions.');
	};
	const accept = async (
		idsValue: readonly string[],
	): Promise<LocalAssistanceGuidedAcceptanceDecisionOutcome> => {
		assertReview();
		const ids = normalizeDecision(idsValue, review.choices);
		if (workflowId === 'separate-dialogue-music-effects'
			&& ids.length > 0 && ids.length !== review.choices.length) {
			return Object.freeze({ outcome: 'unsupported' as const, workflowId,
				reason: 'partial-separation-selection' as const });
		}
		phase = 'accepting';
		try {
			assertCurrentFence(dependencies, fence);
			if (proposalSession) await proposalSession.accept(ids);
			else if (workflowId !== 'detect-beats-tempo' && workflowId !== 'mark-reactions'
				&& ids.length > 0) await publishSelection(
				dependencies, workflow, workflowId, fence, review, ids,
			);
			selectedIds = Object.freeze([...ids]);
			phase = 'accepted';
			return Object.freeze({ outcome: 'accepted' as const, selectedIds });
		} catch (error) {
			phase = 'failed';
			throw error;
		}
	};
	const reject = async (): Promise<void> => {
		assertReview();
		if (proposalSession) await proposalSession.reject();
		phase = 'rejected';
	};
	const cancel = async (): Promise<void> => {
		assertReview();
		controller.abort(new DOMException('Guided result acceptance was cancelled.', 'AbortError'));
		if (proposalSession) await proposalSession.cancel();
		phase = 'cancelled';
	};
	return Object.freeze({ signal: controller.signal, snapshot, accept, reject, cancel });
}

async function publishSelection(
	dependencies: LocalAssistanceGuidedResultAcceptanceDependencies,
	workflow: AssistanceWorkflowV1,
	workflowId: Exclude<SupportedWorkflowId, 'detect-beats-tempo' | 'mark-reactions'>,
	fence: AssistanceSelectionFence,
	review: NormalizedReview,
	selectedIds: readonly string[],
): Promise<void> {
	if (workflowId === 'transcribe-captions') {
		await dependencies.acceptValidatedResult!(createGuidedTranscriptAcceptanceRequest(
			workflow, fence, review.outputs,
		));
		return;
	}
	if (workflowId === 'clean-filler-silence') {
		await dependencies.acceptCleanupResult!({ selectionFence: fence,
			result: review.outputs.get('cleanup-proposals')!.semantic as AssistanceCleanupProposalsV1,
			selectedProposalIds: selectedIds });
		return;
	}
	if (workflowId === 'identify-speakers') {
		await dependencies.acceptValidatedResult!(createGuidedAttributedTranscriptAcceptanceRequest(
			workflow, fence, review.outputs,
		));
		return;
	}
	if (workflowId === 'mark-cuts') {
		await dependencies.acceptValidatedResult!(createGuidedCutAcceptanceRequest(
			workflow, fence, review.outputs, selectedIds,
		));
		return;
	}
	if (workflowId === 'reframe' || workflowId === 'make-highlights') {
		await publishLocalAssistanceGuidedFramescaperSelection(
			dependencies, workflow, workflowId, review.outputs, selectedIds,
		);
		return;
	}
	const placement = workflowId === 'enhance-dialogue'
		? workflow.settings.workflowId === workflowId ? workflow.settings.placement : 'project-bin'
		: workflow.settings.workflowId === workflowId && workflow.settings.placement === 'muted-aligned-tracks'
			? 'project-bin-and-muted-tracks' : 'project-bin';
	await dependencies.acceptAudioResult!(createGuidedAudioAcceptanceRequest(
		workflow, workflowId, fence, review.outputs,
	), { placement });
}

function normalizeReview(
	workflow: AssistanceWorkflowV1,
	workflowId: SupportedWorkflowId,
	value: unknown,
): NormalizedReview {
	const row = exactRecord(value, ['reviewVersion', 'jobId', 'workflowId', 'outputs', 'choices'],
		'Guided reviewed result');
	if (row.reviewVersion !== 1 || row.jobId !== workflow.jobId || row.workflowId !== workflowId) {
		throw new TypeError('The Guided review does not correlate to its exact workflow.');
	}
	const spec = TERMINALS[workflowId];
	if (!Array.isArray(row.outputs) || row.outputs.length !== spec.slots.length) {
		throw new TypeError('The Guided review omitted a closed terminal output.');
	}
	const bySlot = new Map<string, ReviewedOutput>();
	for (const candidate of row.outputs) {
		const output = reviewedOutput(candidate, workflow, spec.stageId);
		if (!spec.slots.includes(output.slotId) || bySlot.has(output.slotId)) {
			throw new TypeError('The Guided review changed its closed terminal slots.');
		}
		bySlot.set(output.slotId, output);
	}
	const semantics = reviewSemantics(workflowId, bySlot);
	for (const [slotId, semantic] of semantics) {
		const output = bySlot.get(slotId)!;
		bySlot.set(slotId, Object.freeze({ ...output, semantic }));
	}
	const choices = normalizeChoices(row.choices, expectedChoices(workflowId, bySlot));
	return Object.freeze({ outputs: bySlot, choices });
}

function reviewedOutput(
	value: unknown,
	workflow: AssistanceWorkflowV1,
	stageId: string,
): ReviewedOutput {
	const row = exactRecord(value, ['stageId', 'slotId', 'claim', 'mediaType', 'byteLength',
		'sha256', 'body', 'semantic'], 'Guided reviewed output');
	if (row.stageId !== stageId || typeof row.slotId !== 'string') {
		throw new TypeError('A Guided reviewed output changed terminal identity.');
	}
	const matches = workflow.outputs.filter(({ stageId: stage, slotId }) =>
		stage === row.stageId && slotId === row.slotId);
	if (matches.length !== 1 || !same(matches[0], row.claim)) {
		throw new TypeError('A Guided reviewed output changed its aggregate claim.');
	}
	if (!(row.body instanceof Blob) || typeof row.mediaType !== 'string'
		|| row.body.type !== row.mediaType || row.byteLength !== row.body.size
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new TypeError('A Guided reviewed output lost authenticated Blob custody.');
	}
	return Object.freeze({ stageId, slotId: row.slotId, claim: matches[0]!,
		mediaType: row.mediaType, byteLength: Number(row.byteLength), sha256: row.sha256,
		body: row.body, semantic: row.semantic });
}

function reviewSemantics(
	workflowId: SupportedWorkflowId,
	outputs: ReadonlyMap<string, ReviewedOutput>,
): ReadonlyMap<string, unknown> {
	if (workflowId === 'enhance-dialogue' || workflowId === 'separate-dialogue-music-effects') {
		const expectedRole = workflowId === 'enhance-dialogue' ? 'enhanced-audio' : 'separated-audio';
		return new Map([...outputs].map(([slotId, output]) => {
			const row = exactRecord(output.semantic,
				['kind', 'role', 'sampleRate', 'channelCount', 'frameCount', 'sampleFormat'],
				'Guided audio-wave review');
			if (row.kind !== 'audio-wave' || row.role !== expectedRole || row.sampleFormat !== 'float32') {
				throw new TypeError('The Guided audio terminal has invalid reviewed geometry.');
			}
			return [slotId, Object.freeze({ ...row })] as const;
		}));
	}
	if (workflowId === 'reframe' || workflowId === 'make-highlights') {
		return reviewLocalAssistanceGuidedFramescaperSemantics(workflowId, outputs);
	}
	const transformId = workflowId === 'transcribe-captions' ? 'assemble-captions'
		: workflowId === 'clean-filler-silence' ? 'propose-cleanup'
		: workflowId === 'identify-speakers' ? 'attribute-speakers'
		: workflowId === 'mark-reactions' ? 'merge-reaction-ranges'
		: workflowId === 'detect-beats-tempo' ? 'propose-tempo-map' : 'normalize-cuts';
	const values = Object.fromEntries([...outputs].map(([slotId, output]) => [slotId, output.semantic]));
	const reviewed = reviewAssistanceOwnedAudioCutTransformResultV1({
		schemaVersion: 1, transformId, outputs: values,
	});
	return new Map(Object.entries(reviewed.outputs));
}

function expectedChoices(
	workflowId: SupportedWorkflowId,
	outputs: ReadonlyMap<string, ReviewedOutput>,
): readonly Readonly<{ id: string; kind: string }>[] {
	if (workflowId === 'transcribe-captions') return [{ id: 'captions', kind: 'captions' }];
	if (workflowId === 'clean-filler-silence') {
		const cleanup = outputs.get('cleanup-proposals')!.semantic as AssistanceCleanupProposalsV1;
		return cleanup.proposals.map(({ id }) => ({ id, kind: 'cleanup' }));
	}
	if (workflowId === 'identify-speakers') {
		return [{ id: 'attributed-transcript', kind: 'transcript' }];
	}
	if (workflowId === 'enhance-dialogue') return [{ id: 'enhanced-audio', kind: 'audio' }];
	if (workflowId === 'separate-dialogue-music-effects') return [
		{ id: 'dialogue', kind: 'audio' }, { id: 'music', kind: 'audio' },
		{ id: 'effects', kind: 'audio' },
	];
	if (workflowId === 'mark-reactions') {
		const reactions = outputs.get('reaction-ranges')!.semantic as AssistanceReactionRangesV1;
		return reactions.ranges.map(({ id }) => ({ id, kind: 'reaction' }));
	}
	if (workflowId === 'mark-cuts') {
		const cuts = outputs.get('cut-proposals')!.semantic as AssistanceCutProposalsV1;
		return cuts.proposals.map(({ id }) => ({ id, kind: 'cut' }));
	}
	if (workflowId === 'reframe' || workflowId === 'make-highlights') {
		return localAssistanceGuidedFramescaperChoices(workflowId, outputs);
	}
	const labels = outputs.get('beat-labels')!.semantic as AssistanceBeatLabelsV1;
	const diff = outputs.get('tempo-map-diff')!.semantic as AssistanceTempoMapDiffV1;
	return [...labels.points.map(({ id }) => ({ id, kind: 'beat' })),
		...(diff.proposal ? [{ id: 'beat-grid:tempo-map', kind: 'tempo-map' }] : [])];
}

function normalizeChoices(
	value: unknown,
	expected: readonly Readonly<{ id: string; kind: string }>[],
): readonly LocalAssistanceGuidedAcceptanceChoice[] {
	if (!Array.isArray(value) || value.length !== expected.length) {
		throw new TypeError('The Guided acceptance choice set is incomplete.');
	}
	return Object.freeze(value.map((candidate, index) => {
		const row = exactRecord(candidate, ['id', 'kind', 'label', 'selected', 'enabled'],
			'Guided acceptance choice');
		if (row.id !== expected[index]!.id || row.kind !== expected[index]!.kind
			|| row.selected !== false || typeof row.enabled !== 'boolean'
			|| typeof row.label !== 'string' || row.label.length < 1 || row.label.length > 256) {
			throw new TypeError('A Guided acceptance choice changed reviewed proposal authority.');
		}
		return Object.freeze({ id: row.id, kind: row.kind, label: row.label,
			selected: false as const, enabled: row.enabled });
	}));
}

function normalizeDecision(
	value: unknown,
	choices: readonly LocalAssistanceGuidedAcceptanceChoice[],
): readonly string[] {
	if (!Array.isArray(value) || value.length > choices.length) {
		throw new RangeError('The Guided acceptance decision exceeds its reviewed choices.');
	}
	const admitted = new Map(choices.map((choice) => [choice.id, choice]));
	const ids = value.map((candidate) => {
		if (typeof candidate !== 'string' || !ID.test(candidate)) {
			throw new TypeError('A Guided selected proposal identity is invalid.');
		}
		const choice = admitted.get(candidate);
		if (!choice) throw new Error(`Unknown Guided proposal ${candidate}.`);
		if (!choice.enabled) throw new RangeError(`Guided proposal ${candidate} is disabled.`);
		return candidate;
	});
	if (new Set(ids).size !== ids.length) throw new Error('Guided selected proposal IDs must be unique.');
	return Object.freeze(ids);
}

function soleSourceRange(
	workflow: AssistanceWorkflowV1,
	workflowId: SupportedWorkflowId,
): AssistanceWorkflowV1['fence']['sourceRanges'][number] {
	const mediaKind = workflowId === 'mark-cuts' || workflowId === 'reframe'
		|| workflowId === 'make-highlights' ? 'video' : 'audio';
	const ranges = workflow.fence.sourceRanges.filter((range) => range.mediaKind === mediaKind);
	if (ranges.length !== 1) throw new TypeError('Guided acceptance source authority is ambiguous.');
	return ranges[0]!;
}

function primitiveFence(
	workflow: AssistanceWorkflowV1,
	range: AssistanceWorkflowV1['fence']['sourceRanges'][number],
	occurrenceIds: readonly string[] = range.occurrenceIds,
): AssistanceSelectionFence {
	return validateAssistanceSelectionFence({
		projectId: workflow.fence.projectId, schemaVersion: workflow.fence.schemaVersion,
		revision: workflow.fence.revision, sequenceId: workflow.fence.sequenceId,
		occurrenceIds, sourceId: range.sourceId,
		sourceSha256: range.sourceSha256, sourceStartFrame: range.sourceStartFrame,
		sourceEndFrame: range.sourceEndFrame, linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256,
	});
}

function assertCurrentFence(
	dependencies: LocalAssistanceGuidedResultAcceptanceDependencies,
	expected: AssistanceSelectionFence,
): void {
	const current = validateAssistanceSelectionFence(dependencies.currentSelectionFence());
	if (!sameFence(expected, current)) throw new AssistanceProposalStaleError();
}

function hasPort(
	workflowId: SupportedWorkflowId,
	dependencies: LocalAssistanceGuidedResultAcceptanceDependencies,
): boolean {
	if (workflowId === 'enhance-dialogue' || workflowId === 'separate-dialogue-music-effects') {
		return Boolean(dependencies.acceptAudioResult);
	}
	if (workflowId === 'detect-beats-tempo') return Boolean(dependencies.createBeatReviewSession);
	if (workflowId === 'mark-reactions') return Boolean(dependencies.createReactionReviewSession);
	if (workflowId === 'clean-filler-silence') return Boolean(dependencies.acceptCleanupResult);
	if (workflowId === 'reframe' || workflowId === 'make-highlights') {
		return hasLocalAssistanceGuidedFramescaperPort(workflowId, dependencies);
	}
	return Boolean(dependencies.acceptValidatedResult);
}

function workflowId(value: unknown): AssistanceWorkflowId {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Guided acceptance requires one workflow contract.');
	}
	return normalizeAssistanceWorkflowId((value as Readonly<Record<string, unknown>>).workflowId);
}

function unsupported(
	workflowIdValue: AssistanceWorkflowId,
	reason: Exclude<LocalAssistanceGuidedAcceptanceUnsupportedReason, 'partial-separation-selection'>,
): LocalAssistanceGuidedAcceptanceAvailability {
	return Object.freeze({ outcome: 'unsupported', workflowId: workflowIdValue, reason });
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw new TypeError(`The ${label} must carry exactly its schema fields.`);
	}
	return row;
}

function sameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): boolean {
	return left.projectId === right.projectId && left.schemaVersion === right.schemaVersion
		&& left.revision === right.revision && left.sequenceId === right.sequenceId
		&& left.sourceId === right.sourceId && left.sourceSha256 === right.sourceSha256
		&& left.sourceStartFrame === right.sourceStartFrame && left.sourceEndFrame === right.sourceEndFrame
		&& left.linkMembershipSha256 === right.linkMembershipSha256
		&& left.timingAuthoritySha256 === right.timingAuthoritySha256
		&& left.occurrenceIds.length === right.occurrenceIds.length
		&& left.occurrenceIds.every((id, index) => id === right.occurrenceIds[index]);
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
