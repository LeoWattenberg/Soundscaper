/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned Beat This review, owned-track publication, and held-tempo acceptance. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createAssistanceBeatProposals,
	type AssistanceBeatPointProposal,
} from '../assistance/beat-proposals.ts';
import {
	planAssistanceBeatTempoMap,
	type AssistanceBeatTempoMapPlan,
} from '../assistance/beat-tempo-map.ts';
import {
	ASSISTANCE_BEAT_SAMPLE_RATE,
	reviewAssistanceBeatGridV1,
	type AssistanceBeatGridV1,
	type AssistanceTempoProposalV1,
} from '../assistance/m7-semantic-results.ts';
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceProposalPhase,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { createAddLabelTrackCommand } from '../commands/factories.ts';
import { scaleSampleFrame } from '../timeline-time.ts';

const TRACK_EXTENSION_KEY = 'org.soundscaper.assistance-beats-v1';
const TEMPO_PROPOSAL_ID = 'beat-grid:tempo-map';
const BEAT_THIS_VERSION = '1.1.0';
const BEAT_THIS_MODEL_IDS = new Set(['beat-this-small0', 'beat-this-final0']);
const MAXIMUM_LABELS = 10_000;
const SHA256 = /^[a-f\d]{64}$/u;
const OPAQUE_ID = /^[a-f\d]{40}$/u;
const UTF8 = new TextEncoder();

type DataRecord = Readonly<Record<string, unknown>>;

export interface LocalAssistanceBeatAuthority {
	readonly project: Readonly<{
		readonly id: string;
		readonly schemaFamily: AssistanceSelectionFence['schemaFamily'];
		readonly schemaVersion: number;
		readonly revision: number;
		readonly sampleRate: number;
		readonly tracks: readonly DataRecord[];
		readonly tempoMap: unknown;
	}>;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceBeatDependencies {
	readonly currentAuthority: () => LocalAssistanceBeatAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: DataRecord) => void;
}

export interface LocalAssistanceBeatTempoChoice {
	readonly id: typeof TEMPO_PROPOSAL_ID;
	readonly kind: 'tempo-map';
	readonly selected: false;
	readonly enabled: boolean;
	readonly disabledReason: string | null;
	readonly proposal: AssistanceTempoProposalV1;
}

export interface LocalAssistanceBeatSnapshot {
	readonly operation: 'beat-tracking';
	readonly phase: AssistanceProposalPhase;
	readonly fence: AssistanceSelectionFence;
	readonly trackId: string;
	readonly proposals: readonly AssistanceBeatPointProposal[];
	readonly tempoMapChoice: LocalAssistanceBeatTempoChoice | null;
	readonly selectedProposalIds: readonly string[];
}

export interface LocalAssistanceBeatReviewSession {
	readonly signal: AbortSignal;
	snapshot(): LocalAssistanceBeatSnapshot;
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
	readonly tempoMap: unknown;
}

interface NormalizedRequest {
	readonly fence: AssistanceSelectionFence;
	readonly model: DataRecord;
	readonly claim: DataRecord;
	readonly review: AssistanceBeatGridV1;
}

export function createLocalAssistanceBeatReviewSession(
	dependencies: LocalAssistanceBeatDependencies,
	requestValue: unknown,
): LocalAssistanceBeatReviewSession {
	validateDependencies(dependencies);
	const request = normalizeRequest(requestValue);
	const initial = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(request.fence, initial.fence);
	assertReviewWithinSelection(request.review, initial);
	const proposals = createAssistanceBeatProposals(request.review);
	const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
	const tempoPlan = request.review.tempoProposal === null ? null : planTempo(
		request.review.tempoProposal, initial,
	);
	const tempoMapChoice = request.review.tempoProposal === null ? null : Object.freeze({
		id: TEMPO_PROPOSAL_ID,
		kind: 'tempo-map' as const,
		selected: false as const,
		enabled: tempoPlan!.enabled,
		disabledReason: tempoPlan!.disabledReason,
		proposal: request.review.tempoProposal,
	});
	const trackId = beatTrackId(request.fence);
	const existing = initial.tracks.find(({ id }) => id === trackId) ?? null;
	if (existing && !ownedTrack(existing, request.fence)) {
		throw new Error(`Assistance Beats track identity ${trackId} is owned by another edit.`);
	}
	const controller = new AbortController();
	let phase: AssistanceProposalPhase = 'review';
	let selectedProposalIds: readonly string[] = Object.freeze([]);

	const snapshot = (): LocalAssistanceBeatSnapshot => Object.freeze({
		operation: 'beat-tracking', phase, fence: request.fence, trackId,
		proposals, tempoMapChoice, selectedProposalIds,
	});
	const assertReview = (): void => {
		if (phase !== 'review') throw new Error('This beat review session no longer accepts decisions.');
	};
	const accept = async (proposalIds: readonly string[]): Promise<void> => {
		assertReview();
		const selected = normalizeDecision(proposalIds, proposalById, tempoMapChoice);
		phase = 'accepting';
		try {
			assertRequestCurrent(requestValue, request);
			const current = assertCurrentState(dependencies, request, initial, trackId, existing);
			const selectedPoints = proposals.filter(({ id }) => selected.has(id));
			if (selectedPoints.length > MAXIMUM_LABELS) {
				throw new RangeError('The selected beats exceed the accepted label ceiling.');
			}
			const commands: DataRecord[] = [];
			if (selectedPoints.length > 0) {
				commands.push(...beatTrackCommands(
					request.fence, trackId, createLabels(selectedPoints, current, trackId), existing,
				));
			}
			if (selected.has(TEMPO_PROPOSAL_ID)) {
				const currentPlan = planTempo(request.review.tempoProposal!, current);
				if (!currentPlan.enabled || !same(currentPlan, tempoPlan)) {
					throw new AssistanceProposalStaleError();
				}
				commands.push(...currentPlan.commands);
			}
			if (commands.length > 0) {
				const command = compound(commands);
				const token = dependencies.captureProject();
				assertCurrentState(dependencies, request, initial, trackId, existing);
				dependencies.assertProject(token);
				assertCurrentState(dependencies, request, initial, trackId, existing);
				assertRequestCurrent(requestValue, request);
				dependencies.commit(command);
			}
			selectedProposalIds = Object.freeze([
				...proposals.filter(({ id }) => selected.has(id)).map(({ id }) => id),
				...(selected.has(TEMPO_PROPOSAL_ID) ? [TEMPO_PROPOSAL_ID] : []),
			]);
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
		controller.abort(new DOMException('The beat review was cancelled.', 'AbortError'));
	};
	return Object.freeze({ signal: controller.signal, snapshot, accept, reject, cancel });
}

function normalizeRequest(value: unknown): NormalizedRequest {
	const request = exactRecord(value,
		['sourceId', 'operation', 'selectionFence', 'models', 'outputs'],
		'local-assistance beat request');
	if (request.operation !== 'beat-tracking') {
		throw new RangeError('Beat review requires the beat-tracking operation.');
	}
	const fence = validateAssistanceSelectionFence(request.selectionFence);
	if (request.sourceId !== fence.sourceId) {
		throw new Error('The reviewed beat source disagrees with its selection fence.');
	}
	const model = normalizeModel(request.models);
	if (!Array.isArray(request.outputs) || request.outputs.length !== 1) {
		throw new RangeError('Beat review requires one authenticated beat-grid output.');
	}
	const output = exactRecord(request.outputs[0], ['claim', 'review'], 'reviewed beat output');
	const claim = normalizeClaim(output.claim);
	const review = normalizeReview(output.review);
	return Object.freeze({ fence, model, claim, review });
}

function normalizeModel(value: unknown): DataRecord {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new RangeError('Beat review requires one exact Beat This model binding.');
	}
	const row = exactRecord(value[0],
		['modelId', 'version', 'task', 'artifactSha256s'], 'beat model binding');
	if (typeof row.modelId !== 'string' || !BEAT_THIS_MODEL_IDS.has(row.modelId)
		|| row.version !== BEAT_THIS_VERSION || row.task !== 'beat-tracking') {
		throw new TypeError('Beat review has an invalid Beat This beat-tracking model identity.');
	}
	if (!Array.isArray(row.artifactSha256s) || row.artifactSha256s.length !== 1
		|| typeof row.artifactSha256s[0] !== 'string' || !SHA256.test(row.artifactSha256s[0])) {
		throw new TypeError('Beat review has invalid exact model artifact authority.');
	}
	return Object.freeze({
		modelId: row.modelId, version: BEAT_THIS_VERSION, task: 'beat-tracking',
		artifactSha256s: Object.freeze([...row.artifactSha256s]),
	});
}

function normalizeClaim(value: unknown): DataRecord {
	const claim = exactRecord(value,
		['claimVersion', 'claimId', 'jobId', 'role', 'mediaType', 'byteLength', 'sha256'],
		'beat-grid output claim');
	if (claim.claimVersion !== 1 || claim.role !== 'beat-grid'
		|| (claim.mediaType !== 'application/json'
			&& claim.mediaType !== 'application/vnd.soundscaper.beat-grid+json')
		|| typeof claim.claimId !== 'string' || !OPAQUE_ID.test(claim.claimId)
		|| typeof claim.jobId !== 'string' || !OPAQUE_ID.test(claim.jobId)
		|| !Number.isSafeInteger(claim.byteLength) || Number(claim.byteLength) < 1
		|| Number(claim.byteLength) > 8 * 1024 * 1024
		|| typeof claim.sha256 !== 'string' || !SHA256.test(claim.sha256)) {
		throw new TypeError('Beat review has an invalid authenticated output claim.');
	}
	return Object.freeze({ ...claim });
}

function normalizeReview(value: unknown): AssistanceBeatGridV1 {
	const review = exactRecord(value,
		['kind', 'schemaVersion', 'sampleRate', 'points', 'tempoProposal'],
		'beat-grid semantic review');
	if (review.kind !== 'beat-grid') throw new TypeError('Beat review requires a reviewed beat grid.');
	return reviewAssistanceBeatGridV1({
		schemaVersion: review.schemaVersion,
		sampleRate: review.sampleRate,
		points: review.points,
		tempoProposal: review.tempoProposal,
	});
}

function normalizeAuthority(value: LocalAssistanceBeatAuthority): NormalizedAuthority {
	if (!value || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Beat acceptance requires selected-media authority.');
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
		tempoMap: structuredClone(value.project.tempoMap),
	});
}

function assertReviewWithinSelection(
	review: AssistanceBeatGridV1,
	authority: NormalizedAuthority,
): void {
	const frameCount = Number(scaleSampleFrame(
		authority.sourceEndFrame - authority.sourceStartFrame,
		authority.sampleRate,
		ASSISTANCE_BEAT_SAMPLE_RATE,
		'point',
	));
	for (const [index, point] of review.points.entries()) {
		if (point.sample >= frameCount) {
			throw new RangeError(`Beat point ${String(index)} exceeds the selected media.`);
		}
	}
	if (review.tempoProposal?.kind === 'piecewise-held') {
		for (const [index, change] of review.tempoProposal.changes.entries()) {
			if (change.startSample >= frameCount) {
				throw new RangeError(`Tempo change ${String(index)} exceeds the selected media.`);
			}
		}
	}
}

function createLabels(
	proposals: readonly AssistanceBeatPointProposal[],
	authority: NormalizedAuthority,
	trackId: string,
): readonly DataRecord[] {
	return Object.freeze(proposals.map((proposal) => {
		const offset = Number(scaleSampleFrame(
			proposal.sample, ASSISTANCE_BEAT_SAMPLE_RATE, authority.sampleRate, 'point',
		));
		const position = safeAdd(authority.timelineStartFrame, offset, 'beat label position');
		if (position >= authority.timelineEndFrame) {
			throw new RangeError('A selected beat falls outside the selected timeline media.');
		}
		return Object.freeze({
			id: `${trackId}:${proposal.kind}:${String(proposal.sample)}`,
			title: proposal.label,
			startFrame: position,
			endFrame: position,
		});
	}));
}

function beatTrackCommands(
	fence: AssistanceSelectionFence,
	trackId: string,
	labels: readonly DataRecord[],
	existing: DataRecord | null,
): readonly DataRecord[] {
	const add = Object.freeze(createAddLabelTrackCommand({
		id: trackId, name: 'Beats', labels,
		opaqueExtensions: { [TRACK_EXTENSION_KEY]: trackExtension(fence) },
	})) as unknown as DataRecord;
	return existing
		? Object.freeze([Object.freeze({ type: 'track/remove', trackId }), add])
		: Object.freeze([add]);
}

function planTempo(
	proposal: AssistanceTempoProposalV1,
	authority: NormalizedAuthority,
): AssistanceBeatTempoMapPlan {
	return planAssistanceBeatTempoMap(proposal, {
		sequenceStartFrame: authority.timelineStartFrame,
		sampleRate: authority.sampleRate,
		tempoMap: authority.tempoMap,
	});
}

function normalizeDecision(
	value: unknown,
	proposals: ReadonlyMap<string, AssistanceBeatPointProposal>,
	tempoChoice: LocalAssistanceBeatTempoChoice | null,
): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length > proposals.size + (tempoChoice ? 1 : 0)) {
		throw new RangeError('The selected beat subset is out of range.');
	}
	const ids = value.map((candidate) => {
		if (typeof candidate !== 'string' || candidate.length < 1 || candidate.length > 256) {
			throw new TypeError('A selected beat proposal id is invalid.');
		}
		return candidate;
	});
	if (new Set(ids).size !== ids.length) throw new Error('Selected beat proposal ids must be unique.');
	for (const id of ids) {
		if (proposals.has(id)) continue;
		if (id === TEMPO_PROPOSAL_ID && tempoChoice) {
			if (!tempoChoice.enabled) {
				throw new RangeError(tempoChoice.disabledReason ?? 'The tempo-map proposal is disabled.');
			}
			continue;
		}
		throw new Error(`Unknown beat proposal ${id}.`);
	}
	return new Set(ids);
}

function assertCurrentState(
	dependencies: LocalAssistanceBeatDependencies,
	request: NormalizedRequest,
	initial: NormalizedAuthority,
	trackId: string,
	existing: DataRecord | null,
): NormalizedAuthority {
	const current = normalizeAuthority(dependencies.currentAuthority());
	assertSameFence(request.fence, current.fence);
	assertReviewWithinSelection(request.review, current);
	const currentTrack = current.tracks.find(({ id }) => id === trackId) ?? null;
	if (!same(currentTrack, existing) || !same(current.tempoMap, initial.tempoMap)) {
		throw new AssistanceProposalStaleError();
	}
	return current;
}

function assertRequestCurrent(value: unknown, expected: NormalizedRequest): void {
	if (!same(normalizeRequest(value), expected)) throw new AssistanceProposalStaleError();
}

function beatTrackId(fence: AssistanceSelectionFence): string {
	const digest = bytesToHex(sha256(UTF8.encode(JSON.stringify({
		operation: 'beat-tracking', sourceId: fence.sourceId, sourceSha256: fence.sourceSha256,
		sourceStartFrame: fence.sourceStartFrame, sourceEndFrame: fence.sourceEndFrame,
		timingAuthoritySha256: fence.timingAuthoritySha256,
	}))));
	return `assistance-beats:${digest}`;
}

function trackExtension(fence: AssistanceSelectionFence): DataRecord {
	return Object.freeze({
		schemaVersion: 1, operation: 'beat-tracking', sourceId: fence.sourceId,
		sourceSha256: fence.sourceSha256, sourceStartFrame: fence.sourceStartFrame,
		sourceEndFrame: fence.sourceEndFrame, timingAuthoritySha256: fence.timingAuthoritySha256,
	});
}

function ownedTrack(track: DataRecord, fence: AssistanceSelectionFence): boolean {
	if (track.type !== 'label') return false;
	const extensions = dataRecord(track.opaqueExtensions);
	return same(extensions?.[TRACK_EXTENSION_KEY], trackExtension(fence));
}

function compound(commands: readonly DataRecord[]): DataRecord {
	if (commands.length === 1) return commands[0]!;
	return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (!same(left, right)) throw new AssistanceProposalStaleError();
}

function validateDependencies(value: LocalAssistanceBeatDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Beat acceptance requires exact controller ports.');
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
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
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
