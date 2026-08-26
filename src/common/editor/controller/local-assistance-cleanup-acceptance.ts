/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional acceptance of selected transcript-cleanup proposals. */

import {
	acceptedProposalRanges,
	findDisfluencyProposals,
	type DisfluencyOptions,
	type DisfluencyProposal,
} from '../assistance/disfluency.ts';
import {
	assistanceTranscriptCleanupPresetProfile,
	normalizeAssistanceTranscriptCleanupPreset,
	type AssistanceTranscriptCleanupPreset,
} from '../assistance/transcript-cleanup-presets.ts';
import {
	createAssistanceProposalSession,
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceProposalBatch,
	type AssistanceProposalPhase,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { voiceActivitySilenceProposals } from '../assistance/vad-silence.ts';
import {
	createAssistanceTranscriptBodyPublicationV1,
	type AssistanceSpeechRecognitionReviewV1,
} from '../assistance/transcript-body-publication-v1.ts';
import { prepareDisjointRangeDeleteCommand } from '../commands.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import { scaleSampleFrame } from '../timeline-time.ts';

const REVIEW_RECIPE_ID = 'transcript-cleanup-review';
const REVIEW_RECIPE_VERSION = 1;
const DECISION_COMMAND_TYPE = 'assistance-cleanup/proposal';
const MAXIMUM_FILLER_LEXICON_WORDS = 4_096;
const MAXIMUM_FILLER_WORD_LENGTH = 128;
const REQUEST_FIELDS = Object.freeze([
	'selectionFence', 'review', 'models', 'options', 'preset', 'voiceActivity',
] as const);
const MODEL_FIELDS = Object.freeze(['modelId', 'version', 'task', 'artifactSha256s'] as const);
const OPTION_FIELDS = Object.freeze([
	'fillerLexicon', 'minSilenceFrames', 'silencePaddingFrames', 'minConfidence', 'detectRepetitions',
] as const);
const DECISION_FIELDS = Object.freeze(['type', 'proposalId'] as const);
const VOICE_ACTIVITY_FIELDS = Object.freeze(['selectionFence', 'models', 'review'] as const);
const VOICE_ACTIVITY_REVIEW_FIELDS = Object.freeze(['kind', 'sampleRate', 'segments'] as const);
const VOICE_ACTIVITY_SEGMENT_FIELDS = Object.freeze(['startSample', 'sampleCount'] as const);
const SHA256 = /^[a-f\d]{64}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const PARAKEET_MODEL_IDS = new Set(['parakeet-tdt-0.6b-v2', 'parakeet-tdt-0.6b-v3']);
const VAD_MODEL_ID = 'silero-vad-v6';
const VAD_SAMPLE_RATE = 16_000;

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceTranscriptCleanupAuthority {
	readonly project: DataRecord & Readonly<{
		readonly id: string;
		readonly schemaVersion: number;
		readonly revision: number;
		readonly sampleRate: number;
		readonly tracks: readonly DataRecord[];
	}>;
	readonly track: DataRecord;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceTranscriptCleanupDependencies {
	readonly currentAuthority: () => LocalAssistanceTranscriptCleanupAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: AudioEditorCommand) => void;
}

export interface LocalAssistanceTranscriptCleanupRequest {
	readonly selectionFence: AssistanceSelectionFence;
	readonly review: AssistanceSpeechRecognitionReviewV1;
	readonly models: readonly Readonly<{
		readonly modelId: string;
		readonly version: string;
		readonly task: string;
		readonly artifactSha256s: readonly string[];
	}>[];
	readonly options: DisfluencyOptions;
	readonly preset: AssistanceTranscriptCleanupPreset;
	readonly voiceActivity: LocalAssistanceTranscriptCleanupVoiceActivity | null;
}

export interface LocalAssistanceTranscriptCleanupVoiceActivity {
	readonly selectionFence: AssistanceSelectionFence;
	readonly models: readonly Readonly<{
		readonly modelId: string;
		readonly version: string;
		readonly task: string;
		readonly artifactSha256s: readonly string[];
	}>[];
	readonly review: Readonly<{
		readonly kind: 'voice-activity';
		readonly sampleRate: 16_000;
		readonly segments: readonly Readonly<{
			readonly startSample: number;
			readonly sampleCount: number;
		}>[];
	}>;
}

export interface LocalAssistanceTranscriptCleanupSnapshot {
	readonly operation: 'speech-recognition';
	readonly phase: AssistanceProposalPhase;
	readonly fence: AssistanceSelectionFence;
	readonly proposals: readonly DisfluencyProposal[];
}

export interface LocalAssistanceTranscriptCleanupSession {
	readonly signal: AbortSignal;
	snapshot(): LocalAssistanceTranscriptCleanupSnapshot;
	accept(proposalIds: readonly string[]): Promise<void>;
	reject(): Promise<void>;
	cancel(): Promise<void>;
}

interface NormalizedAuthority {
	readonly project: DataRecord;
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly trackId: string;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

/**
 * Create one decision session over an already authenticated and semantically
 * reviewed speech result. The review is normalized through the canonical
 * transcript publication boundary, but no body is published by cleanup.
 */
export function createLocalAssistanceTranscriptCleanupSession(
	dependencies: LocalAssistanceTranscriptCleanupDependencies,
	value: LocalAssistanceTranscriptCleanupRequest,
): LocalAssistanceTranscriptCleanupSession {
	validateDependencies(dependencies);
	const request = normalizeRequest(value);
	const expectedFence = request.selectionFence;
	const initial = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(expectedFence, initial.fence);
	const publication = createAssistanceTranscriptBodyPublicationV1({
		assetId: `transcript-cleanup-review:${expectedFence.sourceSha256}`,
		review: request.review,
		selectedMedia: {
			selectionFence: expectedFence,
			sampleRate: initial.sampleRate,
			sourceVideoTimingSha256: null,
		},
		model: request.model,
		recipe: { id: REVIEW_RECIPE_ID, version: REVIEW_RECIPE_VERSION },
	});
	if (publication.body.language !== 'en') {
		throw new RangeError('Transcript cleanup requires an English Parakeet review.');
	}
	const sourceProposals = [
		...findDisfluencyProposals(publication.body, {
			...request.options, minSilenceFrames: 0, silencePaddingFrames: 0,
		}),
		...voiceActivityProposals(request.voiceActivity, initial, request.preset),
	].sort((left, right) => left.startFrame - right.startFrame
		|| left.endFrame - right.endFrame || left.kind.localeCompare(right.kind));
	if (sourceProposals.length < 1) {
		throw new RangeError('The reviewed transcript produced no cleanup proposals.');
	}
	// A degenerate proposal is dropped rather than thrown on, as the voice-activity
	// path alongside it already does: a model can emit a zero-duration word, and
	// refusing the whole session for one would take away every other well-formed
	// proposal in the transcript.
	const proposals = Object.freeze(
		sourceProposals.flatMap((proposal) => timelineProposal(proposal, initial)),
	);
	if (proposals.length < 1) {
		throw new RangeError('The reviewed transcript produced no cleanup proposals.');
	}
	const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
	const decisionCommands = new Map(proposals.map((proposal) => [
		proposal.id,
		Object.freeze({ type: DECISION_COMMAND_TYPE, proposalId: proposal.id }),
	] as const));
	const session = createAssistanceProposalSession({
		operation: 'speech-recognition',
		fence: expectedFence,
		proposals: proposals.map((proposal) => Object.freeze({
			id: proposal.id,
			kind: `transcript-cleanup:${proposal.kind}`,
			command: decisionCommands.get(proposal.id)!,
		})),
		currentFence: () => normalizeAuthority(dependencies.currentAuthority()).fence,
		commit: async (batch) => commitAcceptedCleanup(
			dependencies, expectedFence, proposals, proposalById, batch,
		),
		discardStaged: () => undefined,
	});
	return Object.freeze({
		signal: session.signal,
		snapshot: () => {
			const inner = session.snapshot();
			return Object.freeze({
				operation: 'speech-recognition' as const,
				phase: inner.phase,
				fence: inner.fence,
				proposals,
			});
		},
		accept: (proposalIds: readonly string[]) => session.accept(proposalIds),
		reject: () => session.reject(),
		cancel: () => session.cancel(),
	});
}

async function commitAcceptedCleanup(
	dependencies: LocalAssistanceTranscriptCleanupDependencies,
	expectedFence: AssistanceSelectionFence,
	proposals: readonly DisfluencyProposal[],
	proposalById: ReadonlyMap<string, DisfluencyProposal>,
	batch: AssistanceProposalBatch,
): Promise<void> {
	assertSameFence(expectedFence, batch.fence);
	if (batch.assistanceAssets.length !== 0) {
		throw new Error('Transcript cleanup cannot publish assistance assets.');
	}
	const acceptedIds = batch.commands.map((command) => decisionProposalId(command, proposalById));
	if (acceptedIds.length === 0) return;
	const ranges = acceptedProposalRanges(proposals, acceptedIds);
	if (ranges.length === 0) return;
	const token = dependencies.captureProject();
	const current = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(expectedFence, current.fence);
	const command = prepareDisjointRangeDeleteCommand(current.project, {
		ranges,
		trackIds: [current.trackId],
		rippleMode: 'track',
	}) as AudioEditorCommand;
	dependencies.assertProject(token);
	assertSameFence(expectedFence, normalizeAuthority(dependencies.currentAuthority()).fence);
	dependencies.commit(command);
}

function decisionProposalId(
	value: Readonly<Record<string, unknown>>,
	proposals: ReadonlyMap<string, DisfluencyProposal>,
): string {
	const command = exactRecord(value, DECISION_FIELDS, 'transcript cleanup decision command');
	if (command.type !== DECISION_COMMAND_TYPE || typeof command.proposalId !== 'string'
		|| !proposals.has(command.proposalId)) {
		throw new Error('The accepted transcript cleanup decision changed before commit.');
	}
	return command.proposalId;
}

function timelineProposal(
	proposal: DisfluencyProposal,
	authority: NormalizedAuthority,
): readonly DisfluencyProposal[] {
	const startFrame = projectFrame(proposal.startFrame, authority);
	const endFrame = projectFrame(proposal.endFrame, authority);
	return endFrame > startFrame ? [Object.freeze({ ...proposal, startFrame, endFrame })] : [];
}

function projectFrame(sourceFrame: number, authority: NormalizedAuthority): number {
	const result = authority.timelineStartFrame + (sourceFrame - authority.sourceStartFrame);
	if (!Number.isSafeInteger(result) || result < authority.timelineStartFrame
		|| result > authority.timelineEndFrame) {
		throw new RangeError('A transcript cleanup proposal exceeds its selected occurrence.');
	}
	return result;
}

function normalizeAuthority(value: LocalAssistanceTranscriptCleanupAuthority): NormalizedAuthority {
	if (!value || typeof value !== 'object' || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Transcript cleanup requires selected-media authority.');
	}
	const fence = validateAssistanceSelectionFence(value.fence);
	const project = value.project;
	if (project.id !== fence.projectId || project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = positiveInteger(project.sampleRate, 'selected project sample rate');
	const timelineStartFrame = frame(value.startFrame, 'selected timeline start');
	const timelineEndFrame = frame(value.endFrame, 'selected timeline end');
	const sourceStartFrame = frame(value.sourceStartFrame, 'selected source start');
	const sourceEndFrame = frame(value.sourceEndFrame, 'selected source end');
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| timelineEndFrame - timelineStartFrame !== sourceEndFrame - sourceStartFrame
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	if (!Array.isArray(project.tracks)) {
		throw new TypeError('Transcript cleanup requires the selected project track inventory.');
	}
	const trackId = stableId(value.track?.id, 'selected cleanup track ID');
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!track || track.type !== 'audio' || !Array.isArray(track.clipIds)
		|| !track.clipIds.some((clipId: unknown) => fence.occurrenceIds.includes(String(clipId)))) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({
		project,
		fence,
		sampleRate,
		trackId,
		timelineStartFrame,
		timelineEndFrame,
		sourceStartFrame,
		sourceEndFrame,
	});
}

function normalizeRequest(value: LocalAssistanceTranscriptCleanupRequest) {
	const request = exactRecord(value, REQUEST_FIELDS, 'transcript cleanup request');
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	const model = authenticatedModel(
		request.models, 'speech-recognition', PARAKEET_MODEL_IDS, 'transcript cleanup',
	);
	return Object.freeze({
		selectionFence: fence,
		review: request.review as AssistanceSpeechRecognitionReviewV1,
		model,
		options: normalizeOptions(request.options),
		preset: normalizeAssistanceTranscriptCleanupPreset(request.preset),
		voiceActivity: normalizeVoiceActivity(request.voiceActivity, fence),
	});
}

function authenticatedModel(
	value: unknown,
	task: string,
	modelIds: ReadonlySet<string>,
	label: string,
) {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new RangeError(`${label} requires exactly one authenticated model.`);
	}
	const model = exactRecord(value[0], MODEL_FIELDS, `${label} model`);
	if (typeof model.modelId !== 'string' || !MODEL_ID.test(model.modelId)) {
		throw new TypeError(`${label} requires a bounded model ID.`);
	}
	if (typeof model.version !== 'string' || model.version.length < 1 || model.version.length > 160
		|| model.version.trim() !== model.version) {
		throw new TypeError(`${label} requires a bounded model version.`);
	}
	if (model.task !== task || !modelIds.has(model.modelId)) {
		throw new RangeError(`${label} requires authenticated ${task === 'speech-recognition'
			? 'Parakeet speech' : 'Silero VAD'} model authority.`);
	}
	if (!Array.isArray(model.artifactSha256s) || model.artifactSha256s.length < 1
		|| model.artifactSha256s.length > 64) {
		throw new RangeError(`${label} requires authenticated model artifacts.`);
	}
	const artifactSha256s = model.artifactSha256s.map((value) => {
		if (typeof value !== 'string' || !SHA256.test(value)) {
			throw new TypeError(`${label} model artifacts require SHA-256 digests.`);
		}
		return value;
	}).sort();
	if (artifactSha256s.some((digest, index) => index > 0 && digest === artifactSha256s[index - 1]!)) {
		throw new Error(`${label} model artifact digests must be unique.`);
	}
	return Object.freeze({ modelId: model.modelId, artifactSha256s: Object.freeze(artifactSha256s) });
}

function normalizeVoiceActivity(value: unknown, fence: AssistanceSelectionFence) {
	if (value === null) return null;
	const authority = exactRecord(value, VOICE_ACTIVITY_FIELDS, 'cleanup voice-activity authority');
	assertSameFence(fence, validateAssistanceSelectionFence(authority.selectionFence));
	authenticatedModel(
		authority.models, 'voice-activity-detection', new Set([VAD_MODEL_ID]), 'cleanup voice activity',
	);
	const review = exactRecord(
		authority.review, VOICE_ACTIVITY_REVIEW_FIELDS, 'cleanup voice-activity review',
	);
	if (review.kind !== 'voice-activity' || review.sampleRate !== VAD_SAMPLE_RATE
		|| !Array.isArray(review.segments)) {
		throw new TypeError('Cleanup voice activity requires an exact reviewed 16 kHz result.');
	}
	const segments = review.segments.map((candidate, index) => {
		const segment = exactRecord(candidate, VOICE_ACTIVITY_SEGMENT_FIELDS,
			`cleanup voice-activity segment ${String(index)}`);
		const startFrame = frame(segment.startSample, 'voice-activity segment start');
		const sampleCount = positiveInteger(segment.sampleCount, 'voice-activity segment count');
		return Object.freeze({ startFrame, endFrame: safeAdd(startFrame, sampleCount) });
	});
	return Object.freeze({ segments: Object.freeze(segments) });
}

function normalizeOptions(value: unknown): DisfluencyOptions {
	const options = exactRecord(value, OPTION_FIELDS, 'transcript cleanup options', true);
	const fillerLexiconValue = options.fillerLexicon ?? [];
	if (!Array.isArray(fillerLexiconValue) || fillerLexiconValue.length > MAXIMUM_FILLER_LEXICON_WORDS) {
		throw new RangeError('Transcript cleanup filler lexicon is out of range.');
	}
	const fillerLexicon = fillerLexiconValue.map((candidate) => {
		if (typeof candidate !== 'string' || candidate.trim() === ''
			|| candidate.length > MAXIMUM_FILLER_WORD_LENGTH) {
			throw new TypeError('Transcript cleanup filler words must be bounded text.');
		}
		return candidate;
	});
	const minSilenceFrames = optionalFrame(options.minSilenceFrames, 'minimum silence frames');
	const silencePaddingFrames = optionalFrame(options.silencePaddingFrames, 'silence padding frames');
	if ((minSilenceFrames ?? 0) > 0 || (silencePaddingFrames ?? 0) > 0) {
		throw new RangeError('Transcript word gaps cannot authorize silence cleanup; reviewed VAD is required.');
	}
	const minConfidence = options.minConfidence;
	if (minConfidence !== undefined && (typeof minConfidence !== 'number'
		|| !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)) {
		throw new RangeError('Transcript cleanup minimum confidence must be in the unit interval.');
	}
	if (options.detectRepetitions !== undefined && typeof options.detectRepetitions !== 'boolean') {
		throw new TypeError('Transcript cleanup repetition detection must be boolean.');
	}
	return Object.freeze({
		fillerLexicon: Object.freeze(fillerLexicon),
		...(minSilenceFrames === undefined ? {} : { minSilenceFrames }),
		...(silencePaddingFrames === undefined ? {} : { silencePaddingFrames }),
		...(minConfidence === undefined ? {} : { minConfidence }),
		...(options.detectRepetitions === undefined ? {} : {
			detectRepetitions: options.detectRepetitions,
		}),
	});
}

function voiceActivityProposals(
	voiceActivity: Readonly<{ readonly segments: readonly Readonly<{
		readonly startFrame: number; readonly endFrame: number;
	}>[] }> | null,
	authority: NormalizedAuthority,
	preset: AssistanceTranscriptCleanupPreset,
): readonly DisfluencyProposal[] {
	if (!voiceActivity) return Object.freeze([]);
	const selected = assistanceTranscriptCleanupPresetProfile(preset);
	const outputFrames = Number(scaleSampleFrame(
		authority.sourceEndFrame - authority.sourceStartFrame,
		authority.sampleRate,
		VAD_SAMPLE_RATE,
		'point',
	));
	return Object.freeze(voiceActivitySilenceProposals({
		sampleRate: VAD_SAMPLE_RATE,
		selectionStartFrame: 0,
		selectionEndFrame: outputFrames,
		segments: voiceActivity.segments,
	}, {
		minimumFrames: selected.minimumSilenceSamples,
		paddingFrames: selected.speechPaddingSamples,
	}).flatMap((proposal) => {
		const startFrame = safeAdd(authority.sourceStartFrame, Number(scaleSampleFrame(
			proposal.startFrame, VAD_SAMPLE_RATE, authority.sampleRate, 'enclosingEnd',
		)));
		const endFrame = safeAdd(authority.sourceStartFrame, Number(scaleSampleFrame(
			proposal.endFrame, VAD_SAMPLE_RATE, authority.sampleRate, 'enclosingStart',
		)));
		return endFrame > startFrame ? [Object.freeze({
			...proposal,
			id: `vad-silence-${String(startFrame)}-${String(endFrame)}`,
			startFrame,
			endFrame,
		})] : [];
	}));
}

function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Transcript cleanup frame geometry overflowed.');
	return result;
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) throw new AssistanceProposalStaleError();
}

function validateDependencies(value: LocalAssistanceTranscriptCleanupDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Transcript cleanup requires exact controller transaction ports.');
	}
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
	allowMissing = false,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.some((key) => !fields.includes(key as Field))
		|| (!allowMissing && (keys.length !== fields.length
			|| fields.some((field) => !Object.hasOwn(record, field))))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return record as Record<Field, unknown>;
}

function optionalFrame(value: unknown, label: string): number | undefined {
	if (value === undefined) return undefined;
	return frame(value, label);
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`The ${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.trim() !== value) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}
