/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated, frame-exact selected-video custody for explicit shot modes. */

import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import type { AssistanceSelectionFence } from '../assistance/proposal-session.ts';
import {
	normalizeLocalAssistanceShotDetectionMode,
	type LocalAssistanceShotDetectionMode,
} from '../assistance/shot-detection-mode.ts';
import { FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION } from '../project-schema-version.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../storage/media-content-digest.ts';
import {
	createLocalAssistanceSelectionFence,
} from './local-assistance-selected-media.ts';
import {
	loadVideoExportOriginal,
	type VideoExportOriginalStore,
} from './video-export-original-loader.ts';

const HARD_MAXIMUM_INPUT_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const SHOT_BOUNDARIES_MEDIA_TYPE = 'application/vnd.soundscaper.shot-boundaries+json';
const SHA256 = /^[a-f\d]{64}$/u;
const VIDEO_MEDIA_TYPES = new Set([
	'video/mp4',
	'video/quicktime',
	'video/webm',
	'video/x-matroska',
]);

type DataRecord = Readonly<Record<string, unknown>>;

interface SelectedVideoProject extends DataRecord {
	readonly id: string;
	readonly schemaVersion: 31;
	readonly revision: number;
	readonly sampleRate: number;
	readonly primarySequenceId: string;
	readonly selection?: DataRecord | null;
	readonly sources: readonly DataRecord[];
	readonly clips: readonly DataRecord[];
	readonly tracks: readonly DataRecord[];
	readonly sequences: readonly DataRecord[];
	readonly subsequences: readonly DataRecord[];
	readonly multicameraGroups: readonly DataRecord[];
}

export interface LocalAssistanceSelectedVideoPreparationDependencies {
	readonly getProject: () => unknown;
	readonly getSelectedClipId: () => string | null;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly store: VideoExportOriginalStore;
	/** Test/constrained-environment seam; production cannot raise the 8 GiB hard bound. */
	readonly maximumInputBytes?: number;
}

export interface LocalAssistanceSelectedVideoAuthority {
	readonly project: SelectedVideoProject;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
	readonly sequence: DataRecord;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceSelectedVideoPrepared {
	readonly sourceId: string;
	readonly operation: 'shot-detection';
	readonly shotDetectionMode: LocalAssistanceShotDetectionMode;
	readonly selectionFence: AssistanceSelectionFence;
	readonly inputs: readonly Readonly<{
		readonly role: 'video';
		readonly mediaType: string;
		readonly bytes: Blob;
	}>[];
	readonly outputs: readonly Readonly<{
		readonly role: 'shot-boundaries';
		readonly mediaType: typeof SHOT_BOUNDARIES_MEDIA_TYPE;
		readonly maximumByteLength: number;
	}>[];
}

export interface LocalAssistanceSelectedVideoPreparation {
	listSelectedMedia(): Promise<Readonly<{ readonly sources: readonly Readonly<{
		readonly sourceId: string;
		readonly label: string;
		readonly mediaKind: 'video';
		readonly operations: readonly ['shot-detection'];
	}>[] }>>;
	prepareSelectedMedia(request: Readonly<{
		readonly sourceId: string;
		readonly operation: AssistanceOperation;
		readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
		readonly signal?: AbortSignal;
	}>): Promise<LocalAssistanceSelectedVideoPrepared>;
}

export function createLocalAssistanceSelectedVideoPreparation(
	dependencies: LocalAssistanceSelectedVideoPreparationDependencies,
): Readonly<LocalAssistanceSelectedVideoPreparation> {
	assertDependencies(dependencies);
	const maximumInputBytes = inputBound(dependencies.maximumInputBytes);

	async function listSelectedMedia() {
		let selected: LocalAssistanceSelectedVideoAuthority;
		try { selected = resolveLocalAssistanceSelectedVideoAuthority(dependencies); }
		catch { return Object.freeze({ sources: Object.freeze([]) }); }
		return Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: identifier(selected.source.id, 'source ID'),
			label: identifier(selected.clip.title ?? selected.source.name, 'selected-video label'),
			mediaKind: 'video' as const,
			operations: Object.freeze(['shot-detection'] as const),
		})]) });
	}

	async function prepareSelectedMedia(value: Readonly<{
		readonly sourceId: string;
		readonly operation: AssistanceOperation;
		readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
		readonly signal?: AbortSignal;
	}>): Promise<LocalAssistanceSelectedVideoPrepared> {
		const request = preparationRequest(value);
		request.signal?.throwIfAborted();
		if (request.operation !== 'shot-detection') {
			throw new RangeError('This operation has no exact selected video input preparation.');
		}
		const token = dependencies.captureProject();
		const selected = resolveLocalAssistanceSelectedVideoAuthority(dependencies);
		if (identifier(selected.source.id, 'source ID') !== request.sourceId) {
			throw new Error('The requested assistance source is no longer the selected occurrence.');
		}
		const signal = request.signal ?? new AbortController().signal;
		const original = await loadVideoExportOriginal({
			store: dependencies.store,
			project: selected.project,
			sourceId: request.sourceId,
			storageKey: storageKey(selected.source.storageKey),
			signal,
			assertCurrent: () => dependencies.assertProject(token),
		});
		if (original === null) {
			throw new Error('The selected video original is unavailable from managed or linked custody.');
		}
		const sourceMediaType = videoMediaType(selected.source.mimeType);
		const canonical = canonicalMediaContentBlob(original);
		if (canonical.size < 1 || canonical.size > maximumInputBytes) {
			throw new RangeError('The selected video original exceeds its authenticated input bound.');
		}
		if (canonical.type !== '' && canonical.type !== sourceMediaType) {
			throw new TypeError('The selected video original MIME type does not match its source authority.');
		}
		const contentSha256 = await digestMediaContent(canonical, { signal });
		signal.throwIfAborted();
		dependencies.assertProject(token);
		if (contentSha256 !== digest(selected.source.contentSha256, 'source digest')) {
			throw new Error('The selected video original digest does not match its source authority.');
		}
		const bytes = canonical.type === sourceMediaType
			? canonical : canonical.slice(0, canonical.size, sourceMediaType);
		return Object.freeze({
			sourceId: request.sourceId,
			operation: 'shot-detection' as const,
			shotDetectionMode: request.shotDetectionMode,
			selectionFence: selected.fence,
			inputs: Object.freeze([Object.freeze({
				role: 'video' as const, mediaType: sourceMediaType, bytes,
			})]),
			outputs: Object.freeze([Object.freeze({
				role: 'shot-boundaries' as const,
				mediaType: SHOT_BOUNDARIES_MEDIA_TYPE,
				maximumByteLength: MAXIMUM_OUTPUT_BYTES,
			})]),
		});
	}

	return Object.freeze({ listSelectedMedia, prepareSelectedMedia });
}

export function resolveLocalAssistanceSelectedVideoAuthority(
	dependencies: Pick<LocalAssistanceSelectedVideoPreparationDependencies,
		'getProject' | 'getSelectedClipId'>,
): LocalAssistanceSelectedVideoAuthority {
	const project = selectedVideoProject(dependencies.getProject());
	if (project.subsequences.length !== 0) {
		throw new Error('Selected-video preparation refuses nested sequence authority.');
	}
	if (project.multicameraGroups.length !== 0) {
		throw new Error('Selected-video preparation refuses multicamera authority.');
	}
	const clipId = dependencies.getSelectedClipId();
	if (typeof clipId !== 'string' || clipId === '') {
		throw new Error('Local assistance requires one selected video occurrence.');
	}
	assertOneSelectedOccurrence(project.selection, clipId);
	const clips = project.clips.filter((candidate) => candidate.id === clipId);
	if (clips.length !== 1 || clips[0]?.kind !== 'video') {
		throw new Error('Local assistance requires one selected video occurrence.');
	}
	const clip = clips[0];
	const owners = project.tracks.filter((track) => track.type === 'video'
		&& Array.isArray(track.clipIds)
		&& track.clipIds.filter((candidate) => candidate === clipId).length === 1);
	if (owners.length !== 1) {
		throw new Error('The selected video occurrence has ambiguous track ownership.');
	}
	const track = owners[0]!;
	const sourceId = identifier(clip.sourceId, 'clip source ID');
	const sources = project.sources.filter((candidate) => candidate.id === sourceId);
	if (sources.length !== 1 || sources[0]?.kind !== 'video') {
		throw new Error('The selected video source is unavailable or ambiguous.');
	}
	const source = sources[0];
	const sequenceId = identifier(clip.sequenceId, 'clip sequence ID');
	const sequences = project.sequences.filter((candidate) => candidate.id === sequenceId
		&& Array.isArray(candidate.trackIds) && candidate.trackIds.includes(track.id));
	if (sequences.length !== 1) {
		throw new Error('The selected video occurrence has ambiguous sequence ownership.');
	}
	const sequence = sequences[0]!;
	assertIdentityTiming(clip, source, sequence);
	const sequenceStart = integer(clip.sequenceStartFrame, 0, 'sequence start frame');
	const sequenceCount = integer(clip.sequenceFrameCount, 1, 'sequence frame count');
	const sequenceEnd = safeAdd(sequenceStart, sequenceCount, 'sequence end frame');
	const sourceStart = integer(clip.sourceInFrame, 0, 'source start frame');
	const sourceCount = integer(clip.sourceFrameCount, 1, 'source frame count');
	const sourceEnd = safeAdd(sourceStart, sourceCount, 'source end frame');
	if (sourceEnd > integer(source.sourceFrameCount, 1, 'source frame count')) {
		throw new RangeError('The selected video occurrence exceeds its source-frame bounds.');
	}
	const fence = createLocalAssistanceSelectionFence(project, clip, source, track,
		sequenceStart, sequenceEnd, sourceStart, sourceEnd);
	return Object.freeze({ project, source, clip, track, sequence,
		sourceStartFrame: sourceStart, sourceEndFrame: sourceEnd, fence });
}

function assertDependencies(value: unknown): asserts value is LocalAssistanceSelectedVideoPreparationDependencies {
	if (!value || typeof value !== 'object'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).getProject !== 'function'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).getSelectedClipId !== 'function'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).captureProject !== 'function'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).assertProject !== 'function'
		|| !(value as LocalAssistanceSelectedVideoPreparationDependencies).store
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).store.loadMediaAsset !== 'function') {
		throw new TypeError('Selected-video preparation requires its exact controller and custody ports.');
	}
}

function selectedVideoProject(value: unknown): SelectedVideoProject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected-video preparation requires an active F31 project.');
	}
	const project = value as Partial<SelectedVideoProject>;
	if (project.schemaVersion !== FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION
		|| !Array.isArray(project.sources) || !Array.isArray(project.clips)
		|| !Array.isArray(project.tracks) || !Array.isArray(project.sequences)
		|| !Array.isArray(project.subsequences) || !Array.isArray(project.multicameraGroups)) {
		throw new TypeError('Selected-video preparation requires exact F31 media authority.');
	}
	return {
		...(project as SelectedVideoProject),
		id: identifier(project.id, 'project ID'),
		revision: integer(project.revision, 0, 'project revision'),
		sampleRate: integer(project.sampleRate, 1, 'project sample rate'),
		primarySequenceId: identifier(project.primarySequenceId, 'primary sequence ID'),
	};
}

function assertOneSelectedOccurrence(selection: DataRecord | null | undefined, clipId: string): void {
	if (!selection || !Object.hasOwn(selection, 'clipIds')) return;
	if (!Array.isArray(selection.clipIds) || selection.clipIds.length !== 1
		|| selection.clipIds[0] !== clipId) {
		throw new Error('Local assistance requires one selected video occurrence.');
	}
}

function assertIdentityTiming(clip: DataRecord, source: DataRecord, sequence: DataRecord): void {
	if (clip.reversed === true || clip.speedRatio !== 1) {
		throw new Error('Selected-video preparation requires forward identity timing.');
	}
	if (clip.retimeMap !== null) {
		throw new Error('Selected-video preparation refuses occurrence retime maps.');
	}
	if (clip.sequenceFrameCount !== clip.sourceFrameCount) {
		throw new Error('Selected-video preparation requires one-to-one frame geometry.');
	}
	const decision = dataRecord(source.timingDecision, 'video timing decision');
	if (source.timingAsset !== null || decision.mode !== 'conform-cfr-at-ingest') {
		throw new Error('Selected-video preparation requires canonical CFR source timing.');
	}
	const frameRate = rational(source.frameRate, 'source frame rate');
	const decisionRate = rational(decision.rate, 'timing-decision rate');
	const sequenceRate = rational(sequence.rate, 'sequence frame rate');
	if (!sameRational(frameRate, decisionRate) || !sameRational(frameRate, sequenceRate)) {
		throw new Error('Selected-video preparation requires identity rate authority.');
	}
	videoMediaType(source.mimeType);
	digest(source.contentSha256, 'source digest');
	storageKey(source.storageKey);
}

function preparationRequest(value: unknown): Readonly<{
	sourceId: string;
	operation: AssistanceOperation;
	shotDetectionMode: LocalAssistanceShotDetectionMode;
	signal?: AbortSignal;
}> {
	const fields = ['sourceId', 'operation', 'shotDetectionMode', 'signal'];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Object.hasOwn(value, 'sourceId') || !Object.hasOwn(value, 'operation')
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Selected-video preparation requires its exact request.');
	}
	const record = value as DataRecord;
	if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) {
		throw new TypeError('Selected-video preparation requires a valid cancellation signal.');
	}
	return Object.freeze({
		sourceId: identifier(record.sourceId, 'requested source ID'),
		operation: normalizeAssistanceOperation(record.operation),
		shotDetectionMode: Object.hasOwn(record, 'shotDetectionMode')
			? normalizeLocalAssistanceShotDetectionMode(record.shotDetectionMode)
			: 'fast',
		...(record.signal ? { signal: record.signal } : {}),
	});
}

function dataRecord(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The selected ${label} is invalid.`);
	}
	return value as DataRecord;
}

function rational(value: unknown, label: string): Readonly<{ num: number; den: number }> {
	const record = dataRecord(value, label);
	return Object.freeze({ num: integer(record.num, 1, `${label} numerator`),
		den: integer(record.den, 1, `${label} denominator`) });
}

function sameRational(left: Readonly<{ num: number; den: number }>,
	right: Readonly<{ num: number; den: number }>): boolean {
	return BigInt(left.num) * BigInt(right.den) === BigInt(right.num) * BigInt(left.den);
}

function inputBound(value: unknown): number {
	if (value === undefined) return HARD_MAXIMUM_INPUT_BYTES;
	const result = integer(value, 1, 'maximum input byte bound');
	if (result > HARD_MAXIMUM_INPUT_BYTES) {
		throw new RangeError('Selected-video preparation cannot raise its 8 GiB input bound.');
	}
	return result;
}

function videoMediaType(value: unknown): string {
	if (typeof value !== 'string' || !VIDEO_MEDIA_TYPES.has(value)) {
		throw new TypeError('The selected video source MIME type is unsupported.');
	}
	return value;
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The selected ${label} is invalid.`);
	}
	return value;
}

function storageKey(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError('The selected video storage key is invalid.');
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The selected ${label} is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The selected ${label} is invalid.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The selected ${label} is invalid.`);
	return result;
}
