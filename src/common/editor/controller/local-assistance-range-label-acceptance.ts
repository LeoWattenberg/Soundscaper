/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional acceptance of reviewed VAD silences and anonymous speaker turns. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createAssistanceProposalSession,
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { voiceActivitySilenceProposals } from '../assistance/vad-silence.ts';
import { createAddLabelTrackCommand } from '../commands/factories.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import type {
	LocalAssistanceSpeakerTurnsReview,
	LocalAssistanceVoiceActivityReview,
} from '../ui/local-assistance-result-review.ts';

const REVIEW_SAMPLE_RATE = 16_000;
const MAXIMUM_LABELS = 10_000;
const TRACK_EXTENSION_KEY = 'org.soundscaper.assistance-range-labels-v1';
const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const UTF8 = new TextEncoder();

type SupportedOperation = 'voice-activity-detection' | 'speaker-diarization';
type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceRangeLabelAuthority {
	readonly project: Readonly<{
		readonly id: string;
		readonly schemaFamily: AssistanceSelectionFence['schemaFamily'];
		readonly schemaVersion: number;
		readonly revision: number;
		readonly sampleRate: number;
		readonly tracks: readonly DataRecord[];
	}>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceRangeLabelDependencies {
	readonly currentAuthority: () => LocalAssistanceRangeLabelAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: DataRecord) => void;
}

export interface LocalAssistanceRangeLabelAcceptance {
	acceptValidatedResult(request: unknown): Promise<void>;
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
	readonly operation: SupportedOperation;
	readonly fence: AssistanceSelectionFence;
	readonly review: LocalAssistanceVoiceActivityReview | LocalAssistanceSpeakerTurnsReview;
}

export function createLocalAssistanceRangeLabelAcceptance(
	dependencies: LocalAssistanceRangeLabelDependencies,
): Readonly<LocalAssistanceRangeLabelAcceptance> {
	validateDependencies(dependencies);
	return Object.freeze({
		async acceptValidatedResult(value: unknown): Promise<void> {
			const request = normalizeRequest(value);
			const initial = normalizeAuthority(dependencies.currentAuthority());
			assertSameFence(request.fence, initial.fence);
			const trackId = rangeTrackId(request.operation, request.fence);
			const labels = createLabels(request, initial, trackId);
			if (labels.length > MAXIMUM_LABELS) {
				throw new RangeError('The reviewed assistance result exceeds the accepted label ceiling.');
			}
			const existing = initial.tracks.find(({ id }) => id === trackId) ?? null;
			if (existing && !ownedTrack(existing, request.operation, request.fence)) {
				throw new Error(`Assistance range track identity ${trackId} is owned by another edit.`);
			}
			const command = rangeTrackCommand(request, trackId, labels, existing);
			if (!command) return;
			const proposalId = `range-labels:${request.operation}`;
			const session = createAssistanceProposalSession({
				operation: request.operation,
				fence: request.fence,
				proposals: [Object.freeze({
					id: proposalId,
					kind: `${request.operation}:range-labels`,
					command,
				})],
				currentFence: () => normalizeAuthority(dependencies.currentAuthority()).fence,
				commit: (batch) => {
					if (batch.commands.length !== 1 || !same(batch.commands[0], command)
						|| batch.assistanceAssets.length !== 0) {
						throw new Error('The accepted assistance range proposal changed before commit.');
					}
					const token = dependencies.captureProject();
					const current = normalizeAuthority(dependencies.currentAuthority());
					assertSameFence(request.fence, current.fence);
					const currentTrack = current.tracks.find(({ id }) => id === trackId) ?? null;
					if (!same(currentTrack, existing)) throw new AssistanceProposalStaleError();
					dependencies.assertProject(token);
					assertSameFence(request.fence,
						normalizeAuthority(dependencies.currentAuthority()).fence);
					dependencies.commit(command);
				},
				discardStaged: () => undefined,
			});
			await session.accept([proposalId]);
		},
	});
}

function createLabels(
	request: NormalizedRequest,
	authority: NormalizedAuthority,
	trackId: string,
): readonly DataRecord[] {
	const outputFrames = Number(scaleSampleFrame(
		authority.sourceEndFrame - authority.sourceStartFrame,
		authority.sampleRate,
		REVIEW_SAMPLE_RATE,
		'point',
	));
	if (request.review.kind === 'voice-activity') {
		const segments = request.review.segments.map(({ startSample, sampleCount }) => ({
			startFrame: startSample,
			endFrame: safeAdd(startSample, sampleCount, 'voice-activity segment end'),
		}));
		assertRangesWithinSelection(segments, outputFrames, true);
		const silences = voiceActivitySilenceProposals({
			sampleRate: REVIEW_SAMPLE_RATE,
			selectionStartFrame: 0,
			selectionEndFrame: outputFrames,
			segments,
		});
		return Object.freeze(silences.map((silence, index) => label(
			trackId, index, 'Silence', silence.startFrame, silence.endFrame, authority,
		)));
	}
	const turns = request.review.turns.map(({ startSample, sampleCount, speakerId }) => ({
		startFrame: startSample,
		endFrame: safeAdd(startSample, sampleCount, 'speaker turn end'),
		speakerId,
	}));
	assertRangesWithinSelection(turns, outputFrames, false);
	return Object.freeze(turns.map((turn, index) => label(
		trackId, index, `Speaker ${String(turn.speakerId + 1)}`,
		turn.startFrame, turn.endFrame, authority,
	)));
}

function label(
	trackId: string,
	index: number,
	title: string,
	startSample: number,
	endSample: number,
	authority: NormalizedAuthority,
): DataRecord {
	const duration = authority.timelineEndFrame - authority.timelineStartFrame;
	const startOffset = Math.min(duration, Number(scaleSampleFrame(
		startSample, REVIEW_SAMPLE_RATE, authority.sampleRate, 'enclosingStart',
	)));
	const endOffset = Math.min(duration, Number(scaleSampleFrame(
		endSample, REVIEW_SAMPLE_RATE, authority.sampleRate, 'enclosingEnd',
	)));
	if (endOffset <= startOffset) throw new RangeError('An assistance range has no timeline extent.');
	return Object.freeze({
		id: `${trackId}:range:${String(index)}`,
		title,
		startFrame: safeAdd(authority.timelineStartFrame, startOffset, 'range label start'),
		endFrame: safeAdd(authority.timelineStartFrame, endOffset, 'range label end'),
	});
}

function rangeTrackCommand(
	request: NormalizedRequest,
	trackId: string,
	labels: readonly DataRecord[],
	existing: DataRecord | null,
): DataRecord | null {
	if (labels.length === 0) {
		return existing ? Object.freeze({ type: 'track/remove', trackId }) : null;
	}
	const add = createAddLabelTrackCommand({
		id: trackId,
		name: request.operation === 'voice-activity-detection' ? 'Silences' : 'Speakers',
		labels,
		opaqueExtensions: {
			[TRACK_EXTENSION_KEY]: trackExtension(request.operation, request.fence),
		},
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
		'local-assistance range acceptance request');
	const operation = supportedOperation(request.operation);
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	if (request.sourceId !== fence.sourceId) {
		throw new Error('The reviewed assistance source disagrees with its selection fence.');
	}
	normalizeModels(request.models, operation);
	if (!Array.isArray(request.outputs) || request.outputs.length !== 1) {
		throw new RangeError('Range-label acceptance requires one reviewed output.');
	}
	const output = exactRecord(request.outputs[0], ['claim', 'review'], 'reviewed range output');
	normalizeClaim(output.claim, operation);
	const review = operation === 'voice-activity-detection'
		? normalizeVoiceReview(output.review)
		: normalizeSpeakerReview(output.review);
	return Object.freeze({ operation, fence, review });
}

function normalizeVoiceReview(value: unknown): LocalAssistanceVoiceActivityReview {
	const review = exactRecord(value, ['kind', 'sampleRate', 'segments'], 'voice-activity review');
	if (review.kind !== 'voice-activity' || review.sampleRate !== REVIEW_SAMPLE_RATE
		|| !Array.isArray(review.segments) || review.segments.length > 100_000) {
		throw new TypeError('The accepted voice-activity review is invalid.');
	}
	let priorEnd = 0;
	const segments = review.segments.map((candidate, index) => {
		const segment = exactRecord(candidate, ['startSample', 'sampleCount'], `voice segment ${index}`);
		const startSample = integer(segment.startSample, 0, `voice segment ${index} start`);
		const sampleCount = integer(segment.sampleCount, 1, `voice segment ${index} count`);
		const end = safeAdd(startSample, sampleCount, `voice segment ${index} end`);
		if (startSample < priorEnd) throw new RangeError('Accepted voice segments must be ordered and disjoint.');
		priorEnd = end;
		return Object.freeze({ startSample, sampleCount });
	});
	return Object.freeze({ kind: 'voice-activity', sampleRate: REVIEW_SAMPLE_RATE,
		segments: Object.freeze(segments) });
}

function normalizeSpeakerReview(value: unknown): LocalAssistanceSpeakerTurnsReview {
	const review = exactRecord(value, ['kind', 'sampleRate', 'turns'], 'speaker-turns review');
	if (review.kind !== 'speaker-turns' || review.sampleRate !== REVIEW_SAMPLE_RATE
		|| !Array.isArray(review.turns) || review.turns.length > 100_000) {
		throw new TypeError('The accepted speaker-turns review is invalid.');
	}
	let prior: Readonly<{ startSample: number; sampleCount: number; speakerId: number }> | null = null;
	const turns = review.turns.map((candidate, index) => {
		const turn = exactRecord(candidate,
			['startSample', 'sampleCount', 'speakerId'], `speaker turn ${index}`);
		const normalized = Object.freeze({
			startSample: integer(turn.startSample, 0, `speaker turn ${index} start`),
			sampleCount: integer(turn.sampleCount, 1, `speaker turn ${index} count`),
			speakerId: integer(turn.speakerId, 0, `speaker turn ${index} identity`),
		});
		safeAdd(normalized.startSample, normalized.sampleCount, `speaker turn ${index} end`);
		if (prior && compareTurns(prior, normalized) > 0) {
			throw new RangeError('Accepted speaker turns must use stable ordering.');
		}
		prior = normalized;
		return normalized;
	});
	return Object.freeze({ kind: 'speaker-turns', sampleRate: REVIEW_SAMPLE_RATE,
		turns: Object.freeze(turns) });
}

function normalizeModels(value: unknown, operation: SupportedOperation): void {
	if (!Array.isArray(value)) throw new TypeError('Range-label acceptance requires an exact model set.');
	const tasks = operation === 'voice-activity-detection'
		? ['voice-activity-detection']
		: ['speaker-embedding', 'speaker-segmentation'];
	if (value.length !== tasks.length) throw new RangeError('Range-label acceptance has an invalid model set.');
	const actualTasks = value.map((candidate, index) => {
		const model = exactRecord(candidate,
			['modelId', 'version', 'task', 'artifactSha256s'], `accepted model ${index}`);
		if (typeof model.modelId !== 'string' || !MODEL_ID.test(model.modelId)
			|| typeof model.version !== 'string' || model.version.length < 1 || model.version.length > 160
			|| model.version.trim() !== model.version || typeof model.task !== 'string') {
			throw new TypeError('Range-label acceptance has an invalid model identity.');
		}
		if (!Array.isArray(model.artifactSha256s) || model.artifactSha256s.length < 1
			|| model.artifactSha256s.length > 64
			|| model.artifactSha256s.some((digest) => typeof digest !== 'string' || !SHA256.test(digest))
			|| new Set(model.artifactSha256s).size !== model.artifactSha256s.length) {
			throw new TypeError('Range-label acceptance has invalid model artifact authority.');
		}
		return model.task;
	}).sort();
	if (!same(actualTasks, [...tasks].sort())) {
		throw new RangeError('Range-label acceptance has an invalid model set.');
	}
}

function normalizeClaim(value: unknown, operation: SupportedOperation): void {
	const claim = exactRecord(value,
		['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256'],
		'accepted range output claim');
	const role = operation === 'voice-activity-detection' ? 'voice-activity' : 'speaker-turns';
	if (claim.claimVersion !== 1 || claim.role !== role
		|| (claim.mediaType !== 'application/json'
			&& claim.mediaType !== `application/vnd.soundscaper.${role}+json`)
		|| !JOB_ID.test(String(claim.claimId)) || !JOB_ID.test(String(claim.jobId))
		|| !Number.isSafeInteger(claim.byteLength) || Number(claim.byteLength) < 1
		|| Number(claim.byteLength) > 8 * 1024 * 1024 || !SHA256.test(String(claim.sha256))) {
		throw new TypeError('The accepted range output claim is invalid.');
	}
}

function normalizeAuthority(value: LocalAssistanceRangeLabelAuthority): NormalizedAuthority {
	if (!value || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Range-label acceptance requires selected-media authority.');
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
	return Object.freeze({ fence, sampleRate, timelineStartFrame, timelineEndFrame,
		sourceStartFrame, sourceEndFrame, tracks: Object.freeze([...value.project.tracks]) });
}

function assertRangesWithinSelection(
	ranges: readonly Readonly<{ startFrame: number; endFrame: number }>[],
	selectionFrames: number,
	requireDisjoint: boolean,
): void {
	let priorEnd = 0;
	for (const [index, range] of ranges.entries()) {
		if (range.startFrame < 0 || range.endFrame <= range.startFrame || range.endFrame > selectionFrames) {
			throw new RangeError(`Assistance range ${index} exceeds the selected audio.`);
		}
		if (requireDisjoint && range.startFrame < priorEnd) {
			throw new RangeError('Assistance ranges must be ordered and disjoint.');
		}
		priorEnd = Math.max(priorEnd, range.endFrame);
	}
}

function trackExtension(operation: SupportedOperation, fence: AssistanceSelectionFence): DataRecord {
	return Object.freeze({
		schemaVersion: 1,
		operation,
		sourceId: fence.sourceId,
		sourceSha256: fence.sourceSha256,
		sourceStartFrame: fence.sourceStartFrame,
		sourceEndFrame: fence.sourceEndFrame,
	});
}

function ownedTrack(track: DataRecord, operation: SupportedOperation, fence: AssistanceSelectionFence): boolean {
	if (track.type !== 'label') return false;
	const extensions = dataRecord(track.opaqueExtensions);
	return same(extensions?.[TRACK_EXTENSION_KEY], trackExtension(operation, fence));
}

function rangeTrackId(operation: SupportedOperation, fence: AssistanceSelectionFence): string {
	const digest = bytesToHex(sha256(UTF8.encode(JSON.stringify({
		operation,
		sourceId: fence.sourceId,
		sourceSha256: fence.sourceSha256,
		sourceStartFrame: fence.sourceStartFrame,
		sourceEndFrame: fence.sourceEndFrame,
	}))));
	return `${operation === 'voice-activity-detection'
		? 'assistance-vad-silences' : 'assistance-speaker-turns'}:${digest}`;
}

function supportedOperation(value: unknown): SupportedOperation {
	if (value !== 'voice-activity-detection' && value !== 'speaker-diarization') {
		throw new RangeError('Only reviewed VAD or speaker turns can be accepted as range labels.');
	}
	return value;
}

function compareTurns(
	left: Readonly<{ startSample: number; sampleCount: number; speakerId: number }>,
	right: Readonly<{ startSample: number; sampleCount: number; speakerId: number }>,
): number {
	return compareInteger(left.startSample, right.startSample)
		|| compareInteger(left.speakerId, right.speakerId)
		|| compareInteger(left.sampleCount, right.sampleCount);
}

function compareInteger(left: number, right: number): number {
	return left === right ? 0 : left < right ? -1 : 1;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const record = value as DataRecord;
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
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

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (!same(left, right)) throw new AssistanceProposalStaleError();
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateDependencies(value: LocalAssistanceRangeLabelDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Range-label acceptance requires exact controller ports.');
	}
}
