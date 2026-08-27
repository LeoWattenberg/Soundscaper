/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated, frame-exact selected-video custody for explicit shot modes. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	normalizeAssistanceOperation,
	type AssistanceOperation,
} from '../assistance/operation.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
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
	createLocalAssistanceSelectedVideoTimingBinding,
	createLocalAssistanceSelectedVideoFramePackTiming,
	createLocalAssistanceSelectedVideoReframeFramePackTiming,
	mapLocalAssistanceSelectedVideoTimingBoundary,
	readLocalAssistanceSelectedVideoSourceBoundaryTick as readTimingSourceBoundaryTick,
	readLocalAssistanceSelectedVideoSourceFrameTick as readTimingSourceFrameTick,
	type LocalAssistanceSelectedVideoTimingBinding,
	type LocalAssistanceSelectedVideoSourceFrameTick,
} from './local-assistance-selected-video-timing.ts';
import {
	createLocalAssistanceSelectedVideoFramePacksV1,
	LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE,
	LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS,
	type LocalAssistanceSelectedVideoFramePackRequest,
} from './local-assistance-selected-video-frame-pack.ts';
import {
	createLocalAssistanceSelectedVideoModelFramePack,
	type LocalAssistanceSelectedVideoModelFramePackDependencies,
	type LocalAssistanceSelectedVideoModelFramePackPrepared,
	type LocalAssistanceSelectedVideoModelOperation,
} from './local-assistance-selected-video-model-preparation.ts';
import {
	readLocalAssistanceSelectedVideoShotAnchorFrames,
} from './local-assistance-selected-video-shot-anchors.ts';
import {
	loadVideoExportOriginal,
	type VideoExportOriginalStore,
} from './video-export-original-loader.ts';

const HARD_MAXIMUM_INPUT_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const SHOT_BOUNDARIES_MEDIA_TYPE = 'application/vnd.soundscaper.shot-boundaries+json';
const SHA256 = /^[a-f\d]{64}$/u;
const UTF8 = new TextEncoder();
const VIDEO_MEDIA_TYPES = new Set([
	'video/mp4',
	'video/quicktime',
	'video/webm',
	'video/x-matroska',
]);
const SELECTED_VIDEO_MODEL_OPERATIONS = new Set<LocalAssistanceSelectedVideoModelOperation>([
	'image-text-embedding', 'optical-character-recognition', 'subject-detection', 'saliency-detection',
]);
const SELECTED_VIDEO_OPERATIONS = Object.freeze(
	['shot-detection', ...SELECTED_VIDEO_MODEL_OPERATIONS] as const);

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
	readonly timelineAnnotations?: readonly unknown[];
}

export interface LocalAssistanceSelectedVideoPreparationDependencies {
	readonly getProject: () => unknown;
	readonly getSelectedClipId: () => string | null;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly store: VideoExportOriginalStore;
	/** Test seam; production uses exact browser decode into the assistance frame-pack format. */
	readonly createAccurateFramePacks?: (
		request: LocalAssistanceSelectedVideoFramePackRequest,
	) => PromiseLike<readonly Blob[]> | readonly Blob[];
	/** Test seam; production emits the strict source-authority visual frame-pack format. */
	readonly createVisualFramePack?: LocalAssistanceSelectedVideoModelFramePackDependencies[
		'createFramePack'
	];
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
	readonly timingAuthority: Readonly<{
		readonly schemaVersion: 1;
		readonly sourceTiming: 'cfr' | 'vfr';
		readonly mapping: 'uniform-wall-clock' | 'forward-retime-v2';
	}>;
	readonly fence: AssistanceSelectionFence;
}

interface SelectedVideoAuthorityState {
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly binding: LocalAssistanceSelectedVideoTimingBinding;
	readonly timingAuthoritySha256: string;
}

const SELECTED_VIDEO_AUTHORITY_STATES = new WeakMap<object, SelectedVideoAuthorityState>();

interface LocalAssistanceSelectedVideoShotPrepared {
	readonly sourceId: string;
	readonly operation: 'shot-detection';
	readonly shotDetectionMode: LocalAssistanceShotDetectionMode;
	readonly selectionFence: AssistanceSelectionFence;
	readonly inputs: readonly Readonly<{
		readonly role: 'video' | 'frame-pack';
		readonly mediaType: string;
		readonly bytes: Blob;
	}>[];
	readonly outputs: readonly Readonly<{
		readonly role: 'shot-boundaries';
		readonly mediaType: typeof SHOT_BOUNDARIES_MEDIA_TYPE;
		readonly maximumByteLength: number;
	}>[];
}

export type LocalAssistanceSelectedVideoPrepared = LocalAssistanceSelectedVideoShotPrepared
	| (Readonly<{
		readonly sourceId: string;
		readonly operation: LocalAssistanceSelectedVideoModelOperation;
		readonly shotDetectionMode?: never;
		readonly selectionFence: AssistanceSelectionFence;
	}> & LocalAssistanceSelectedVideoModelFramePackPrepared);

export interface LocalAssistanceSelectedVideoPreparationRequest {
	readonly sourceId: string; readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly inputRole?: 'video' | 'frame-pack'; readonly signal?: AbortSignal;
}

export interface LocalAssistanceSelectedVideoPreparation {
	listSelectedMedia(): Promise<Readonly<{ readonly sources: readonly Readonly<{
		readonly sourceId: string;
		readonly label: string;
		readonly mediaKind: 'video';
		readonly operations: typeof SELECTED_VIDEO_OPERATIONS;
	}>[] }>>;
	prepareSelectedMedia(request: LocalAssistanceSelectedVideoPreparationRequest):
		Promise<LocalAssistanceSelectedVideoPrepared>;
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
			operations: SELECTED_VIDEO_OPERATIONS,
		})]) });
	}

	async function prepareSelectedMedia(value: LocalAssistanceSelectedVideoPreparationRequest):
	Promise<LocalAssistanceSelectedVideoPrepared> {
		const request = preparationRequest(value);
		request.signal?.throwIfAborted();
		if (request.operation !== 'shot-detection'
			&& !SELECTED_VIDEO_MODEL_OPERATIONS.has(request.operation as LocalAssistanceSelectedVideoModelOperation)) {
			throw new RangeError('This operation has no exact selected video input preparation.');
		}
		const modelOperation = request.operation as LocalAssistanceSelectedVideoModelOperation;
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
		if (request.operation !== 'shot-detection') {
			const state = SELECTED_VIDEO_AUTHORITY_STATES.get(selected);
			if (!state) throw new TypeError('Reframe preparation lost authenticated timing authority.');
			const shotAnchors = readLocalAssistanceSelectedVideoShotAnchorFrames({
				project: selected.project, source: selected.source, sequence: selected.sequence,
				fence: selected.fence, sourceStartFrame: selected.sourceStartFrame,
				sourceEndFrame: selected.sourceEndFrame,
				mapSourceBoundary: (sourceFrame) =>
					mapLocalAssistanceSelectedVideoSourceBoundary(selected, sourceFrame),
				readSourceFrameTick: (sourceFrame) =>
					readLocalAssistanceSelectedVideoSourceFrameTick(selected, sourceFrame),
			});
			const prepared = await createLocalAssistanceSelectedVideoModelFramePack({
				...(dependencies.createVisualFramePack
					? { createFramePack: dependencies.createVisualFramePack } : {}),
			}, { operation: modelOperation, body: bytes,
				timing: createLocalAssistanceSelectedVideoReframeFramePackTiming(
					state.binding, shotAnchors,
				),
				sourceWidth: integer(selected.source.width, 1, 'source width'),
				sourceHeight: integer(selected.source.height, 1, 'source height'),
				signal, assertCurrent: () => dependencies.assertProject(token), maximumInputBytes,
			});
			return Object.freeze({ sourceId: request.sourceId, operation: modelOperation,
				selectionFence: selected.fence, ...prepared });
		}
		const inputs = request.inputRole === 'frame-pack'
			|| request.inputRole === undefined && request.shotDetectionMode === 'accurate'
			? await accurateFramePackInputs(dependencies, selected, bytes, signal, maximumInputBytes,
				() => dependencies.assertProject(token))
			: Object.freeze([Object.freeze({
				role: 'video' as const, mediaType: sourceMediaType, bytes,
			})]);
		signal.throwIfAborted();
		dependencies.assertProject(token);
		return Object.freeze({
			sourceId: request.sourceId,
			operation: 'shot-detection' as const,
			shotDetectionMode: request.shotDetectionMode,
			selectionFence: selected.fence,
			inputs,
			outputs: Object.freeze([Object.freeze({
				role: 'shot-boundaries' as const,
				mediaType: SHOT_BOUNDARIES_MEDIA_TYPE,
				maximumByteLength: MAXIMUM_OUTPUT_BYTES,
			})]),
		});
	}

	return Object.freeze({ listSelectedMedia, prepareSelectedMedia });
}

async function accurateFramePackInputs(
	dependencies: LocalAssistanceSelectedVideoPreparationDependencies,
	selected: LocalAssistanceSelectedVideoAuthority,
	body: Blob,
	signal: AbortSignal,
	maximumInputBytes: number,
	assertCurrent: () => void,
): Promise<readonly Readonly<{
	readonly role: 'frame-pack';
	readonly mediaType: typeof LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE;
	readonly bytes: Blob;
}>[]> {
	const state = SELECTED_VIDEO_AUTHORITY_STATES.get(selected);
	if (!state) throw new TypeError('Accurate Mark Cuts lost its authenticated timing binding.');
	const create = dependencies.createAccurateFramePacks
		?? ((request: LocalAssistanceSelectedVideoFramePackRequest) => (
			createLocalAssistanceSelectedVideoFramePacksV1(request)
		));
	const packs = await create(Object.freeze({
		body,
		timing: createLocalAssistanceSelectedVideoFramePackTiming(state.binding),
		signal,
		assertCurrent,
	}));
	if (!Array.isArray(packs) || packs.length < 1
		|| packs.length > LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS) {
		throw new RangeError('Accurate Mark Cuts returned an invalid frame-pack inventory.');
	}
	let aggregateBytes = 0;
	return Object.freeze(packs.map((bytes) => {
		if (!(bytes instanceof Blob) || bytes.size < 1
			|| bytes.type !== LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE) {
			throw new TypeError('Accurate Mark Cuts requires exact assistance frame-pack Blobs.');
		}
		aggregateBytes += bytes.size;
		if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > maximumInputBytes) {
			throw new RangeError('Accurate Mark Cuts frame packs exceed their authenticated input bound.');
		}
		return Object.freeze({ role: 'frame-pack' as const,
			mediaType: LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE, bytes });
	}));
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
	const sequenceStart = integer(clip.sequenceStartFrame, 0, 'sequence start frame');
	const sequenceCount = integer(clip.sequenceFrameCount, 1, 'sequence frame count');
	const sequenceEnd = safeAdd(sequenceStart, sequenceCount, 'sequence end frame');
	const sourceStart = integer(clip.sourceInFrame, 0, 'source start frame');
	const sourceCount = integer(clip.sourceFrameCount, 1, 'source frame count');
	const sourceEnd = safeAdd(sourceStart, sourceCount, 'source end frame');
	if (sourceEnd > integer(source.sourceFrameCount, 1, 'source frame count')) {
		throw new RangeError('The selected video occurrence exceeds its source-frame bounds.');
	}
	videoMediaType(source.mimeType);
	digest(source.contentSha256, 'source digest');
	storageKey(source.storageKey);
	const timing = createLocalAssistanceSelectedVideoTimingBinding(project, clip, source, sequence, {
		sequenceStart, sequenceCount, sequenceEnd, sourceStart, sourceEnd,
	});
	const baseFence = createLocalAssistanceSelectionFence(project, clip, source, track,
		sequenceStart, sequenceEnd, sourceStart, sourceEnd);
	const fence = timingSelectionFence(baseFence, timing.fenceMaterial);
	const authority = Object.freeze({ project, source, clip, track, sequence,
		sourceStartFrame: sourceStart, sourceEndFrame: sourceEnd,
		timingAuthority: Object.freeze({
			schemaVersion: 1 as const,
			sourceTiming: timing.sourceTimingKind,
			mapping: timing.mappingKind,
		}),
		fence });
	SELECTED_VIDEO_AUTHORITY_STATES.set(authority, Object.freeze({
		source, clip, binding: timing, timingAuthoritySha256: fence.timingAuthoritySha256,
	}));
	return authority;
}

/** Map one authenticated source boundary into this occurrence's exact sequence grid. */
export function mapLocalAssistanceSelectedVideoSourceBoundary(
	authority: LocalAssistanceSelectedVideoAuthority,
	sourceFrameValue: number,
): number | null {
	if (!authority || typeof authority !== 'object') {
		throw new TypeError('Selected-video boundary mapping requires exact video authority.');
	}
	const state = SELECTED_VIDEO_AUTHORITY_STATES.get(authority);
	if (!state || authority.source !== state.source || authority.clip !== state.clip
		|| authority.fence.timingAuthoritySha256 !== state.timingAuthoritySha256) {
		throw new TypeError('Selected-video boundary mapping requires current authenticated timing authority.');
	}
	return mapLocalAssistanceSelectedVideoTimingBoundary(state.binding, sourceFrameValue);
}

/** Revalidate one reviewed model sample against the selected source's exact CFR/VFR tick. */
export function readLocalAssistanceSelectedVideoSourceFrameTick(
	authority: LocalAssistanceSelectedVideoAuthority,
	sourceFrameValue: number,
): LocalAssistanceSelectedVideoSourceFrameTick | null {
	if (!authority || typeof authority !== 'object') {
		throw new TypeError('Selected-video frame timing requires exact video authority.');
	}
	const state = SELECTED_VIDEO_AUTHORITY_STATES.get(authority);
	if (!state || authority.source !== state.source || authority.clip !== state.clip
		|| authority.fence.timingAuthoritySha256 !== state.timingAuthoritySha256) {
		throw new TypeError('Selected-video frame timing requires current authenticated timing authority.');
	}
	return readTimingSourceFrameTick(state.binding, sourceFrameValue);
}

/** Revalidate one selected source boundary, including its exclusive end. */
export function readLocalAssistanceSelectedVideoSourceBoundaryTick(
	authority: LocalAssistanceSelectedVideoAuthority,
	sourceFrameValue: number,
): LocalAssistanceSelectedVideoSourceFrameTick | null {
	if (!authority || typeof authority !== 'object') {
		throw new TypeError('Selected-video boundary timing requires exact video authority.');
	}
	const state = SELECTED_VIDEO_AUTHORITY_STATES.get(authority);
	if (!state || authority.source !== state.source || authority.clip !== state.clip
		|| authority.fence.timingAuthoritySha256 !== state.timingAuthoritySha256) {
		throw new TypeError('Selected-video boundary timing requires current authenticated authority.');
	}
	return readTimingSourceBoundaryTick(state.binding, sourceFrameValue);
}

function assertDependencies(value: unknown): asserts value is LocalAssistanceSelectedVideoPreparationDependencies {
	if (!value || typeof value !== 'object'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).getProject !== 'function'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).getSelectedClipId !== 'function'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).captureProject !== 'function'
		|| typeof (value as LocalAssistanceSelectedVideoPreparationDependencies).assertProject !== 'function'
		|| ((value as LocalAssistanceSelectedVideoPreparationDependencies).createAccurateFramePacks
			!== undefined && typeof (value as LocalAssistanceSelectedVideoPreparationDependencies)
				.createAccurateFramePacks !== 'function')
		|| ((value as LocalAssistanceSelectedVideoPreparationDependencies).createVisualFramePack
			!== undefined && typeof (value as LocalAssistanceSelectedVideoPreparationDependencies)
				.createVisualFramePack !== 'function')
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

function timingSelectionFence(
	fence: AssistanceSelectionFence,
	material: DataRecord,
): AssistanceSelectionFence {
	return validateAssistanceSelectionFence({
		...fence,
		timingAuthoritySha256: digestValue(material),
	});
}

function digestValue(value: unknown): string {
	return bytesToHex(sha256(UTF8.encode(JSON.stringify(value))));
}

function preparationRequest(value: unknown): Readonly<{
	sourceId: string;
	operation: AssistanceOperation;
	shotDetectionMode: LocalAssistanceShotDetectionMode;
	inputRole?: 'video' | 'frame-pack';
	signal?: AbortSignal;
}> {
	const fields = ['sourceId', 'operation', 'shotDetectionMode', 'inputRole', 'signal'];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !Object.hasOwn(value, 'sourceId') || !Object.hasOwn(value, 'operation')
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Selected-video preparation requires its exact request.');
	}
	const record = value as DataRecord;
	if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) {
		throw new TypeError('Selected-video preparation requires a valid cancellation signal.');
	}
	const operation = normalizeAssistanceOperation(record.operation);
	if (operation !== 'shot-detection' && Object.hasOwn(record, 'shotDetectionMode')) {
		throw new TypeError('Visual model preparation cannot carry a shot-detection mode.');
	}
	const inputRole = record.inputRole;
	if (inputRole !== undefined && (operation !== 'shot-detection'
		|| inputRole !== 'video' && inputRole !== 'frame-pack')) {
		throw new TypeError('Selected-video input-role preparation is unsupported.');
	}
	const shotDetectionMode = Object.hasOwn(record, 'shotDetectionMode')
		? normalizeLocalAssistanceShotDetectionMode(record.shotDetectionMode) : 'fast';
	if (inputRole === 'frame-pack' && shotDetectionMode !== 'accurate') {
		throw new TypeError('Frame-pack shot preparation requires Accurate mode.');
	}
	return Object.freeze({
		sourceId: identifier(record.sourceId, 'requested source ID'),
		operation, shotDetectionMode, ...(inputRole ? { inputRole } : {}),
		...(record.signal ? { signal: record.signal } : {}),
	});
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
