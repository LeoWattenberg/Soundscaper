/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned review and atomic owned-track acceptance for reaction tags. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
	ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES,
	reviewAssistanceAudioTagsV1,
	type AssistanceAudioTagsV1,
} from '../assistance/m7-semantic-results.ts';
import {
	createAssistanceReactionProposals,
	type AssistanceReactionProposal,
	type AssistanceReactionProposalOptions,
} from '../assistance/reaction-proposals.ts';
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceProposalPhase,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { createAddLabelTrackCommand } from '../commands/factories.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import type { LocalAssistanceRangeLabelAuthority } from './local-assistance-range-label-acceptance.ts';

const TRACK_EXTENSION_KEY = 'org.soundscaper.assistance-reactions-v1';
const PANNs_MODEL_ID = 'panns-cnn10';
const MAXIMUM_LABELS = 10_000;
const SHA256 = /^[a-f\d]{64}$/u;
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const UTF8 = new TextEncoder();

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceReactionDependencies {
	readonly currentAuthority: () => LocalAssistanceRangeLabelAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: DataRecord) => void;
}

export interface LocalAssistanceReactionSnapshot {
	readonly operation: 'audio-tagging';
	readonly phase: AssistanceProposalPhase;
	readonly fence: AssistanceSelectionFence;
	readonly proposals: readonly AssistanceReactionProposal[];
	readonly selectedProposalIds: readonly string[];
}

export interface LocalAssistanceReactionReviewSession {
	readonly signal: AbortSignal;
	snapshot(): LocalAssistanceReactionSnapshot;
	accept(proposalIds: readonly string[]): Promise<void>;
	reject(): Promise<void>;
	cancel(): Promise<void>;
}

interface NormalizedAuthority {
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly tracks: readonly DataRecord[];
}

interface NormalizedRequest {
	readonly fence: AssistanceSelectionFence;
	readonly model: DataRecord;
	readonly claim: DataRecord;
	readonly review: AssistanceAudioTagsV1;
}

export function createLocalAssistanceReactionReviewSession(
	dependencies: LocalAssistanceReactionDependencies,
	requestValue: unknown,
	optionsValue: AssistanceReactionProposalOptions = {},
): LocalAssistanceReactionReviewSession {
	validateDependencies(dependencies);
	const request = normalizeRequest(requestValue);
	const threshold = normalizeThreshold(optionsValue);
	const initial = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(request.fence, initial.fence);
	assertReviewWithinSelection(request.review, initial);
	const proposals = createAssistanceReactionProposals(request.review, { threshold });
	const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
	const trackId = reactionTrackId(request.fence);
	const existing = initial.tracks.find(({ id }) => id === trackId) ?? null;
	if (existing && !ownedTrack(existing, request.fence)) {
		throw new Error(`Assistance reaction track identity ${trackId} is owned by another edit.`);
	}
	const controller = new AbortController();
	let phase: AssistanceProposalPhase = 'review';
	let selectedProposalIds: readonly string[] = Object.freeze([]);

	const snapshot = (): LocalAssistanceReactionSnapshot => Object.freeze({
		operation: 'audio-tagging',
		phase,
		fence: request.fence,
		proposals,
		selectedProposalIds,
	});
	const assertReview = (): void => {
		if (phase !== 'review') throw new Error('This reaction review session no longer accepts decisions.');
	};
	const accept = async (proposalIds: readonly string[]): Promise<void> => {
		assertReview();
		const selected = normalizeDecision(proposalIds, proposalById);
		phase = 'accepting';
		try {
			assertRequestCurrent(requestValue, optionsValue, request, threshold);
			const current = normalizeAuthority(dependencies.currentAuthority());
			assertSameFence(request.fence, current.fence);
			assertReviewWithinSelection(request.review, current);
			const currentTrack = current.tracks.find(({ id }) => id === trackId) ?? null;
			if (!same(currentTrack, existing)) throw new AssistanceProposalStaleError();
			if (selected.size === 0) {
				selectedProposalIds = Object.freeze([]);
				phase = 'accepted';
				return;
			}
			const accepted = proposals.filter(({ id }) => selected.has(id));
			if (accepted.length > MAXIMUM_LABELS) {
				throw new RangeError('The selected reactions exceed the accepted label ceiling.');
			}
			const labels = createLabels(accepted, current, trackId);
			const command = reactionTrackCommand(request.fence, trackId, labels, existing);
			const token = dependencies.captureProject();
			assertCurrentState(dependencies, request.fence, trackId, existing);
			dependencies.assertProject(token);
			assertCurrentState(dependencies, request.fence, trackId, existing);
			assertRequestCurrent(requestValue, optionsValue, request, threshold);
			dependencies.commit(command);
			selectedProposalIds = Object.freeze(accepted.map(({ id }) => id));
			phase = 'accepted';
		} catch (error) {
			phase = 'failed';
			throw error;
		}
	};
	const reject = async (): Promise<void> => {
		assertReview();
		phase = 'rejected';
	};
	const cancel = async (): Promise<void> => {
		assertReview();
		phase = 'cancelled';
		controller.abort(new DOMException('The reaction review was cancelled.', 'AbortError'));
	};
	return Object.freeze({ signal: controller.signal, snapshot, accept, reject, cancel });
}

function assertRequestCurrent(
	requestValue: unknown,
	optionsValue: AssistanceReactionProposalOptions,
	expected: NormalizedRequest,
	threshold: number,
): void {
	const refreshed = normalizeRequest(requestValue);
	if (!same(refreshed, expected) || normalizeThreshold(optionsValue) !== threshold) {
		throw new AssistanceProposalStaleError();
	}
}

function createLabels(
	proposals: readonly AssistanceReactionProposal[],
	authority: NormalizedAuthority,
	trackId: string,
): readonly DataRecord[] {
	const reviewFrames = reviewFrameCount(authority);
	const timelineDuration = authority.timelineEndFrame - authority.timelineStartFrame;
	return Object.freeze(proposals.map((proposal) => {
		const endSample = Math.min(proposal.endSample, reviewFrames);
		if (proposal.startSample >= endSample) {
			throw new RangeError('A selected reaction has no extent inside the selected media.');
		}
		const startOffset = Math.min(timelineDuration, Number(scaleSampleFrame(
			proposal.startSample, ASSISTANCE_AUDIO_TAG_SAMPLE_RATE, authority.sampleRate,
			'enclosingStart',
		)));
		const endOffset = Math.min(timelineDuration, Number(scaleSampleFrame(
			endSample, ASSISTANCE_AUDIO_TAG_SAMPLE_RATE, authority.sampleRate, 'enclosingEnd',
		)));
		if (endOffset <= startOffset) throw new RangeError('A selected reaction has no timeline extent.');
		return Object.freeze({
			id: `${trackId}:${proposal.id}`,
			title: proposal.label,
			startFrame: safeAdd(authority.timelineStartFrame, startOffset, 'reaction label start'),
			endFrame: safeAdd(authority.timelineStartFrame, endOffset, 'reaction label end'),
		});
	}));
}

function reactionTrackCommand(
	fence: AssistanceSelectionFence,
	trackId: string,
	labels: readonly DataRecord[],
	existing: DataRecord | null,
): DataRecord {
	const add = createAddLabelTrackCommand({
		id: trackId,
		name: 'Reactions',
		labels,
		opaqueExtensions: { [TRACK_EXTENSION_KEY]: trackExtension(fence) },
	}) as unknown as DataRecord;
	if (!existing) return Object.freeze(add);
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze([Object.freeze({ type: 'track/remove', trackId }), add]),
	});
}

function normalizeRequest(value: unknown): NormalizedRequest {
	const request = exactRecord(value,
		['sourceId', 'operation', 'selectionFence', 'models', 'outputs'],
		'local-assistance reaction request');
	if (request.operation !== 'audio-tagging') {
		throw new RangeError('Reaction review requires the audio-tagging operation.');
	}
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	if (request.sourceId !== fence.sourceId) {
		throw new Error('The reviewed reaction source disagrees with its selection fence.');
	}
	const model = normalizeModel(request.models);
	if (!Array.isArray(request.outputs) || request.outputs.length !== 1) {
		throw new RangeError('Reaction review requires one authenticated audio-tags output.');
	}
	const output = exactRecord(request.outputs[0], ['claim', 'review'], 'reviewed reaction output');
	const claim = normalizeClaim(output.claim);
	const review = normalizeReview(output.review);
	return Object.freeze({ fence, model, claim, review });
}

function normalizeModel(value: unknown): DataRecord {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new RangeError('Reaction review requires one exact audio-tagging model binding.');
	}
	const row = exactRecord(value[0],
		['modelId', 'version', 'task', 'artifactSha256s'], 'reaction model binding');
	if (typeof row.modelId !== 'string' || !MODEL_ID.test(row.modelId)
		|| row.modelId !== PANNs_MODEL_ID
		|| typeof row.version !== 'string' || row.version.length < 1 || row.version.length > 160
		|| row.version.trim() !== row.version || row.task !== 'audio-tagging') {
		throw new TypeError('Reaction review has an invalid audio-tagging model identity.');
	}
	if (!Array.isArray(row.artifactSha256s) || row.artifactSha256s.length < 1
		|| row.artifactSha256s.length > 64
		|| row.artifactSha256s.some((digest) => typeof digest !== 'string' || !SHA256.test(digest))
		|| new Set(row.artifactSha256s).size !== row.artifactSha256s.length) {
		throw new TypeError('Reaction review has invalid model artifact authority.');
	}
	return Object.freeze({
		modelId: row.modelId,
		version: row.version,
		task: 'audio-tagging',
		artifactSha256s: Object.freeze([...row.artifactSha256s]),
	});
}

function normalizeClaim(value: unknown): DataRecord {
	const claim = exactRecord(value,
		['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256'],
		'audio-tags output claim');
	if (claim.claimVersion !== 1 || claim.role !== 'audio-tags'
		|| (claim.mediaType !== 'application/json'
			&& claim.mediaType !== 'application/vnd.soundscaper.audio-tags+json')
		|| typeof claim.claimId !== 'string' || !OPAQUE_ID.test(claim.claimId)
		|| typeof claim.jobId !== 'string' || !OPAQUE_ID.test(claim.jobId)
		|| !Number.isSafeInteger(claim.byteLength) || Number(claim.byteLength) < 1
		|| Number(claim.byteLength) > 8 * 1024 * 1024
		|| typeof claim.sha256 !== 'string' || !SHA256.test(claim.sha256)) {
		throw new TypeError('Reaction review has an invalid authenticated output claim.');
	}
	return Object.freeze({ ...claim });
}

function normalizeReview(value: unknown): AssistanceAudioTagsV1 {
	const review = exactRecord(value,
		['kind', 'schemaVersion', 'sampleRate', 'windowSamples', 'windows'],
		'audio-tags semantic review');
	if (review.kind !== 'audio-tags') {
		throw new TypeError('Reaction review requires reviewed audio tags.');
	}
	return reviewAssistanceAudioTagsV1({
		schemaVersion: review.schemaVersion,
		sampleRate: review.sampleRate,
		windowSamples: review.windowSamples,
		windows: review.windows,
	});
}

function normalizeAuthority(value: LocalAssistanceRangeLabelAuthority): NormalizedAuthority {
	if (!value || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Reaction acceptance requires selected-media authority.');
	}
	const fence = validateAssistanceSelectionFence(value.fence);
	if (value.project.id !== fence.projectId || value.project.schemaFamily !== fence.schemaFamily
		|| value.project.schemaVersion !== fence.schemaVersion
		|| value.project.revision !== fence.revision || !Array.isArray(value.project.tracks)) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = integer(value.project.sampleRate, 1, 'project sample rate');
	const timelineStartFrame = integer(value.startFrame, 0, 'timeline start');
	const timelineEndFrame = integer(value.endFrame, 1, 'timeline end');
	const sourceStartFrame = integer(value.sourceStartFrame, 0, 'source start');
	const sourceEndFrame = integer(value.sourceEndFrame, 1, 'source end');
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| timelineEndFrame - timelineStartFrame !== sourceEndFrame - sourceStartFrame
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({
		fence, sampleRate, timelineStartFrame, timelineEndFrame, sourceStartFrame, sourceEndFrame,
		tracks: Object.freeze([...value.project.tracks]),
	});
}

function assertReviewWithinSelection(
	review: AssistanceAudioTagsV1,
	authority: NormalizedAuthority,
): void {
	const frameCount = reviewFrameCount(authority);
	for (const [index, window] of review.windows.entries()) {
		if (window.startSample >= frameCount) {
			throw new RangeError(`Audio-tag window ${String(index)} exceeds the selected media.`);
		}
		if (!Number.isSafeInteger(window.startSample + ASSISTANCE_AUDIO_TAG_WINDOW_SAMPLES)) {
			throw new RangeError(`Audio-tag window ${String(index)} exceeds safe timing.`);
		}
	}
}

function reviewFrameCount(authority: NormalizedAuthority): number {
	return Number(scaleSampleFrame(
		authority.sourceEndFrame - authority.sourceStartFrame,
		authority.sampleRate,
		ASSISTANCE_AUDIO_TAG_SAMPLE_RATE,
		'point',
	));
}

function normalizeDecision(
	value: unknown,
	proposals: ReadonlyMap<string, AssistanceReactionProposal>,
): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length > proposals.size) {
		throw new RangeError('The selected reaction subset is out of range.');
	}
	const ids = value.map((candidate) => {
		if (typeof candidate !== 'string' || candidate.length < 1 || candidate.length > 256) {
			throw new TypeError('A selected reaction proposal id is invalid.');
		}
		return candidate;
	});
	if (new Set(ids).size !== ids.length) {
		throw new Error('Selected reaction proposal ids must be unique.');
	}
	for (const id of ids) {
		if (!proposals.has(id)) throw new Error(`Unknown reaction proposal ${id}.`);
	}
	return new Set(ids);
}

function assertCurrentState(
	dependencies: LocalAssistanceReactionDependencies,
	fence: AssistanceSelectionFence,
	trackId: string,
	existing: DataRecord | null,
): void {
	const current = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(fence, current.fence);
	const track = current.tracks.find(({ id }) => id === trackId) ?? null;
	if (!same(track, existing)) throw new AssistanceProposalStaleError();
}

function reactionTrackId(fence: AssistanceSelectionFence): string {
	const digest = bytesToHex(sha256(UTF8.encode(JSON.stringify({
		operation: 'audio-tagging',
		sourceId: fence.sourceId,
		sourceSha256: fence.sourceSha256,
		sourceStartFrame: fence.sourceStartFrame,
		sourceEndFrame: fence.sourceEndFrame,
	}))));
	return `assistance-reactions:${digest}`;
}

function trackExtension(fence: AssistanceSelectionFence): DataRecord {
	return Object.freeze({
		schemaVersion: 1,
		operation: 'audio-tagging',
		sourceId: fence.sourceId,
		sourceSha256: fence.sourceSha256,
		sourceStartFrame: fence.sourceStartFrame,
		sourceEndFrame: fence.sourceEndFrame,
	});
}

function ownedTrack(track: DataRecord, fence: AssistanceSelectionFence): boolean {
	if (track.type !== 'label') return false;
	const extensions = dataRecord(track.opaqueExtensions);
	return same(extensions?.[TRACK_EXTENSION_KEY], trackExtension(fence));
}

function normalizeThreshold(value: AssistanceReactionProposalOptions): number {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Reaction review options must be a record.');
	}
	const keys = Object.keys(value);
	if (keys.some((key) => key !== 'threshold')) {
		throw new TypeError('Reaction review options have unsupported fields.');
	}
	const threshold = value.threshold ?? 0.5;
	if (typeof threshold !== 'number' || !Number.isFinite(threshold)
		|| threshold < 0 || threshold > 1) {
		throw new RangeError('The reaction threshold must be within the unit interval.');
	}
	return threshold;
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (!same(left, right)) throw new AssistanceProposalStaleError();
}

function validateDependencies(value: LocalAssistanceReactionDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Reaction acceptance requires exact controller ports.');
	}
}

function exactRecord(value: unknown, fields: readonly string[], label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as DataRecord;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} has unsupported fields.`);
	}
	return record;
}

function dataRecord(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord : null;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} is invalid.`);
	return result;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
