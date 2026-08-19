/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	createAudioTrackFreezeCoordinatorV21,
	type AudioTrackFreezeCoordinatorCommandV21,
} from '../common/editor/audio-track-freeze-coordinator-v21.ts';
import {
	assertCurrentSoundscaperFreezeProjectV21,
	soundscaperFreezeRenderFingerprintV21,
} from './editor-audio-track-freeze-currency-v21.ts';
import { normalizeAutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import { createStoredChunkProvider, SOURCE_CHUNK_FRAMES } from '../common/editor/controller/source-audio.ts';
import { rackTailFrames } from '../common/editor/effects.js';
import { audioBufferChannels, type PlanarPcm } from '../common/editor/engine/buffer-math.ts';
import { compileProjectPathPdcPlanV21 } from '../common/editor/engine/project-path-pdc-plan-v21.ts';
import type { EnginePublicApi } from '../common/editor/engine/public-api.ts';
import { createAudioEditorEngine } from '../common/editor/engine/runtime-class.ts';
import { createDefaultMixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import { createAudioClipV10, createAudioSourceV10 } from '../common/editor/project-v10.ts';
import { resolveRuntimeProjectProjection } from '../common/editor/runtime-clip-projection.ts';
import { resolveTerminalChannelWidths } from '../common/editor/terminal-channel-widths.ts';
import type { StorageRecord } from '../common/editor/storage/media-records.ts';
import type { AudioSourceWriter } from '../common/editor/storage/source-write-repository.ts';
import type { TransientAnalysisPcmStore } from '../common/editor/controller/transient-analysis-pcm-access.ts';
import { validateSoundscaperProjectV21, type SoundscaperProjectV21 } from './editor-project-v21-validation.ts';
import type {
	SoundscaperAudioTrackFreezePlaybackServiceV21,
	SoundscaperAudioTrackFreezeStatusV21,
} from './editor-audio-track-freeze-playback-v21.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface FreezeStore extends TransientAnalysisPcmStore {
	beginSourceWrite(sourceId: string, metadata: Record<string, unknown>): Promise<AudioSourceWriter>;
	readSourceChunk(sourceId: string, chunkIndex: number, options?: Record<string, unknown>): Promise<unknown>;
	discardSourceIfCurrent(source: StorageRecord): Promise<boolean>;
}

export interface SoundscaperAudioFreezeEnvironmentV21 {
	readonly store: FreezeStore;
	readonly playback: SoundscaperAudioTrackFreezePlaybackServiceV21;
}

export interface SoundscaperAudioFreezeControllerV21 {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{
			readonly commit: (command: AudioTrackFreezeCoordinatorCommandV21) => unknown;
		}>;
	}>;
}

export interface SoundscaperAudioFreezeActionsV21 {
	readonly freeze: (trackId: string) => Promise<unknown>;
	readonly refresh: (trackId: string) => Promise<unknown>;
	readonly unfreeze: (trackId: string) => Promise<unknown>;
	readonly commit: (trackId: string) => Promise<unknown>;
	readonly getStatus: (trackId: string) => SoundscaperAudioTrackFreezeStatusV21 | 'verifying';
}

export interface SoundscaperAudioFreezeActionBindingV21 {
	readonly actions: Readonly<SoundscaperAudioFreezeActionsV21>;
	readonly dispose: () => Promise<void>;
}

export interface SoundscaperAudioFreezeRenderEngineV21 {
	loadProject(
		project: Parameters<EnginePublicApi['loadProject']>[0],
		sourceBuffers?: Parameters<EnginePublicApi['loadProject']>[1],
		options?: Parameters<EnginePublicApi['loadProject']>[2],
	): unknown;
	renderTrack(
		trackId: Parameters<EnginePublicApi['renderTrack']>[0],
		options?: Parameters<EnginePublicApi['renderTrack']>[1],
	): ReturnType<EnginePublicApi['renderTrack']>;
	dispose(): ReturnType<EnginePublicApi['dispose']>;
}

export interface SoundscaperAudioFreezeActionsOptionsV21 {
	/**
	 * The document validator for the revision these actions serve. Later
	 * production revisions inherit this file unchanged, so the revision is a
	 * parameter rather than something the file names.
	 */
	readonly validateProject?: (project: unknown) => unknown;
	/** Lower-only deterministic test seam. */
	readonly createId?: (kind: 'source' | 'clip') => string;
	/** Lower-only renderer test seam. */
	readonly createRenderEngine?: () => SoundscaperAudioFreezeRenderEngineV21;
}

interface FreezeBody {
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
	readonly sampleRate: number;
}

interface FreezeStage {
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly descriptor: DataRecord;
	readonly writer: AudioSourceWriter;
	authority: StorageRecord | null;
}

interface ProjectTicket {
	readonly project: SoundscaperProjectV21;
	readonly trackId: string;
	/** What the render reads, so an unrelated edit does not discard the freeze. */
	readonly fingerprint: string;
}

/** Bind the generic freeze transaction to browser rendering, PCM storage, and controller CAS. */
export function createSoundscaperAudioFreezeActionsV21(
	environment: SoundscaperAudioFreezeEnvironmentV21,
	controller: SoundscaperAudioFreezeControllerV21,
	options: SoundscaperAudioFreezeActionsOptionsV21 = {},
): Readonly<SoundscaperAudioFreezeActionBindingV21> {
	assertDependencies(environment, controller, options);
	const validateProject = options.validateProject ?? validateSoundscaperProjectV21;
	const createId = options.createId ?? defaultId;
	const createRenderEngine = options.createRenderEngine ?? createAudioEditorEngine;
	const coordinator = createAudioTrackFreezeCoordinatorV21<
		SoundscaperProjectV21, ProjectTicket, FreezeBody, FreezeStage
	>({
		controller: {
			capture: ({ trackId, signal }) => {
				throwIfAborted(signal);
				const project = exactCurrentProject(controller, validateProject);
				const track = exactRecordById(project.tracks, trackId, 'audio freeze track');
				if (track.type !== 'audio') throw new RangeError(`Track ${trackId} is not audio.`);
				if (track.locked === true) throw new Error(`Audio track ${trackId} is locked.`);
				assertNoSidechainIntoRack(project, track, trackId);
				return Object.freeze({
					project,
					ticket: Object.freeze({
						project, trackId, fingerprint: soundscaperFreezeRenderFingerprintV21(project, trackId),
					}),
				});
			},
			assertCurrent: (ticket) => assertCurrent(controller, ticket),
			executeIfCurrent: (ticket, command, { signal }) => {
				throwIfAborted(signal);
			assertCurrent(controller, ticket);
			const result = controller.actions.edit.commit(command);
			const current = exactCurrentProject(controller, validateProject);
			if (result !== current) throw new Error('Audio freeze command did not publish the current project.');
			return current;
			},
		},
		planRenderRange: ({ project, trackId }) => planFreezeRange(project, trackId),
		allocateDerivedSourceId: () => stableId(createId('source'), 'audio freeze derived source'),
		hashSourceContent: ({ project, source, signal }) => environment.playback.hashSourceContent(
			project.id, source, signal,
		),
		render: async (request) => renderFreezeBody(
			environment.store, controller, createRenderEngine, request,
		),
		hashRenderedBody: ({ body, signal }) => Promise.resolve(hashFreezeBody(body, signal)),
		stageDerivedSource: async (request) => stageFreezeSource(environment.store, request),
		verifyStagedSource: async ({ stage, sourceId, contentSha256, signal }) => {
			throwIfAborted(signal);
			if (stage.sourceId !== sourceId || stage.contentSha256 !== contentSha256
				|| stage.writer.framesWritten !== Number(stage.descriptor.frameCount)) {
				throw new Error('The staged freeze source failed exact geometry verification.');
			}
			return stage.descriptor;
		},
		admitVerifiedFreeze: (request) => environment.playback.admitVerifiedFreeze(request),
		publishStagedSource: async ({ stage, signal }) => {
			const authority = await stage.writer.commit({
				contentSha256: stage.contentSha256,
				frameCount: stage.descriptor.frameCount,
				channelCount: stage.descriptor.channelCount,
				sampleRate: stage.descriptor.sampleRate,
				chunkFrames: stage.descriptor.chunkFrames,
			}, { signal, ifAbsent: true });
			stage.authority = authority;
			const actual = await environment.playback.hashSourceContent(
				`freeze-stage:${stage.sourceId}`, stage.descriptor, signal,
			);
			if (actual !== stage.contentSha256) throw new Error('Published freeze PCM failed content verification.');
		},
		rollbackStagedSource: async ({ stage }) => {
			if (stage.authority === null) {
				await stage.writer.abort();
				return;
			}
			if (!await environment.store.discardSourceIfCurrent(stage.authority)) {
				throw new Error(`Published freeze source ${stage.sourceId} changed before rollback.`);
			}
		},
	});
	let active: Readonly<{ trackId: string; abort: AbortController; promise: Promise<unknown> }> | null = null;
	let disposed = false;
	const run = (trackId: string, operation: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> => {
		if (disposed) return Promise.reject(new Error('Soundscaper audio freeze actions are disposed.'));
		const previous = active;
		previous?.abort.abort(new DOMException('A newer audio freeze operation replaced this task.', 'AbortError'));
		const abort = new AbortController();
		const promise = (async () => {
			if (previous) await previous.promise.catch(() => undefined);
			throwIfAborted(abort.signal);
			return operation(abort.signal);
		})();
		const entry = Object.freeze({ trackId, abort, promise });
		active = entry;
		void promise.finally(() => { if (active === entry) active = null; }).catch(() => undefined);
		return promise;
	};
	const freeze = (trackId: string) => run(trackId, (signal) => coordinator.freeze({ trackId, signal }));
	const actions = Object.freeze({
		freeze,
		refresh: freeze,
		unfreeze: (trackId: string) => run(trackId, (signal) => coordinator.unfreeze({ trackId, signal })),
		commit: (trackId: string) => run(trackId, (signal) => {
			const project = exactCurrentProject(controller, validateProject);
			const track = exactRecordById(project.tracks, trackId, 'committed frozen track');
			const freezeValue = dataRecord(track.audioFreeze, 'committed audio freeze');
			return coordinator.commit({
				trackId,
				derivedClip: committedFreezeClip(
					stableId(createId('clip'), 'committed freeze clip'), freezeValue,
				),
				signal,
			});
		}),
		getStatus: (trackId: string): SoundscaperAudioTrackFreezeStatusV21 | 'verifying' => {
			if (active?.trackId === trackId) return 'verifying';
			if (disposed || !controller.project || typeof controller.project !== 'object') return 'unknown';
			return environment.playback.getFreezeStatus(controller.project, trackId);
		},
	});
	return Object.freeze({
		actions,
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			const pending = active;
			pending?.abort.abort(new DOMException('Audio freeze actions were disposed.', 'AbortError'));
			await pending?.promise.catch(() => undefined);
		},
	});
}

function planFreezeRange(project: SoundscaperProjectV21, trackId: string) {
	const runtime = resolveRuntimeProjectProjection(project);
	const track = exactRecordById(runtime.tracks, trackId, 'audio freeze track');
	const clips = arrayValue(track.clipIds, 'audio freeze track.clipIds')
		.map((id) => exactRecordById(runtime.clips, String(id), 'audio freeze clip'));
	if (clips.length === 0) throw new RangeError('An empty audio track cannot be frozen.');
	const renderStartFrame = Math.min(...clips.map((clip) => nonNegativeInteger(clip.timelineStartFrame, 'clip start')));
	const laneEndFrame = Math.max(...clips.map((clip) => safeAdd(
		nonNegativeInteger(clip.timelineStartFrame, 'clip start'),
		positiveInteger(clip.durationFrames, 'clip duration'),
		'clip range',
	)));
	const sampleRate = positiveInteger(project.sampleRate, 'project sample rate');
	const tailFrames = track.effectsActive === false ? 0 : rackTailFrames(track.effects, sampleRate, 10);
	return Object.freeze({
		renderStartFrame,
		renderFrameCount: safeAdd(laneEndFrame - renderStartFrame, tailFrames, 'freeze render range'),
	});
}

async function renderFreezeBody(
	store: FreezeStore,
	controller: SoundscaperAudioFreezeControllerV21,
	createEngine: () => SoundscaperAudioFreezeRenderEngineV21,
	request: Readonly<{
		readonly project: SoundscaperProjectV21;
		readonly trackId: string;
		readonly renderStartFrame: number;
		readonly renderFrameCount: number;
		readonly sampleRate: number;
		readonly signal?: AbortSignal;
	}>,
): Promise<Readonly<{ readonly body: FreezeBody; readonly frameCount: number; readonly sampleRate: number; readonly channelCount: number }>> {
	const ticket: ProjectTicket = Object.freeze({
		project: request.project,
		trackId: request.trackId,
		fingerprint: soundscaperFreezeRenderFingerprintV21(request.project, request.trackId),
	});
	const runtime = resolveRuntimeProjectProjection(request.project);
	const track = exactRecordById(runtime.tracks, request.trackId, 'audio freeze render track');
	const ownedIds = new Set(arrayValue(track.clipIds, 'audio freeze render track.clipIds').map(String));
	const runtimeClips = dataArray(runtime.clips, 'runtime project.clips');
	const clips = runtimeClips.filter((clip) => ownedIds.has(String(clip.id)));
	const sourceIds = new Set(clips.map((clip) => String(clip.sourceId)));
	const sources = dataArray(runtime.sources, 'runtime project.sources')
		.filter((source) => sourceIds.has(String(source.id)));
	const providers = new Map<string, ReturnType<typeof createStoredChunkProvider>>();
	const engine = createEngine();
	let failure: unknown = null;
	try {
		for (const source of sources) {
			throwIfAborted(request.signal);
			const storageKey = String(source.storageKey ?? source.id);
			const metadata = await store.getSourceMetadata(storageKey);
			assertCurrentSoundscaperFreezeProjectV21(controller, ticket);
			if (!metadata) throw new Error(`Stored PCM for ${String(source.id)} is unavailable.`);
			providers.set(String(source.id), createStoredChunkProvider(store, source as never, metadata));
		}
		const latency = compileProjectPathPdcPlanV21(request.project, { sampleRate: request.sampleRate })
			.freezeLatencyFramesByTrack.get(request.trackId) ?? 0;
		const laneEndFrame = request.renderStartFrame + request.renderFrameCount
			- (track.effectsActive === false ? 0 : rackTailFrames(track.effects, request.sampleRate, 10));
		const renderProject = freezeRenderProject(runtime, track, clips, sources);
		engine.loadProject(renderProject as never, new Map(), { chunkSources: providers });
		const rendered = await engine.renderTrack(request.trackId, {
			startFrame: request.renderStartFrame,
			endFrame: laneEndFrame,
			includeTail: (request.renderStartFrame + request.renderFrameCount - laneEndFrame) / request.sampleRate,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: request.renderFrameCount,
			preRollFrames: latency,
			signal: request.signal,
		});
		assertCurrentSoundscaperFreezeProjectV21(controller, ticket);
		const channels = Object.freeze(audioBufferChannels(rendered as AudioBuffer | PlanarPcm)
			.map((channel) => channel.slice()));
		if (channels.length === 0 || channels.some((channel) => channel.length !== request.renderFrameCount)) {
			throw new RangeError('The offline freeze renderer returned unexpected PCM geometry.');
		}
		const body = Object.freeze({ channels, frameCount: request.renderFrameCount, sampleRate: request.sampleRate });
		return Object.freeze({ body, frameCount: body.frameCount, sampleRate: body.sampleRate, channelCount: channels.length });
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		await cleanupRenderResources(engine, providers, failure);
	}
}

/**
 * Refuse to bake a rack another strip is keying.
 *
 * The freeze renders the track alone, through a graph built for it, so an
 * authored sidechain edge feeding an effect in its rack does not exist during
 * that render. The dynamics worklet then keys itself from its own input, and
 * what gets baked is a self-keyed limiter or gate — audibly not what plays.
 * Rendering the key track alongside would mean pulling its media, its identity,
 * and its own staleness into the freeze, so until that exists this refuses
 * rather than committing a render that disagrees with playback.
 */
function assertNoSidechainIntoRack(
	project: SoundscaperProjectV21,
	track: DataRecord,
	trackId: string,
): void {
	const effectIds = new Set(dataArray(track.effects, 'audio freeze track.effects').map(({ id }) => String(id)));
	if (effectIds.size === 0) return;
	const edges = dataArray(
		dataRecord((project as unknown as DataRecord).mixer, 'project.mixer').edges,
		'project.mixer.edges',
	);
	for (const edge of edges) {
		if (edge.enabled === false) continue;
		const destination = edge.destination as DataRecord | undefined;
		if (destination?.kind !== 'effect-sidechain') continue;
		const strip = destination.strip as DataRecord | undefined;
		if (strip?.kind !== 'track' || String(strip.id) !== trackId) continue;
		if (!effectIds.has(String(destination.effectId))) continue;
		throw new Error(
			`Audio track ${trackId} has an effect keyed by a sidechain, which a freeze cannot render.`,
		);
	}
}

function freezeRenderProject(
	project: DataRecord,
	track: DataRecord,
	clips: readonly DataRecord[],
	sources: readonly DataRecord[],
): DataRecord {
	const trackId = stableId(track.id, 'freeze render track');
	const effectIds = new Set(dataArray(track.effects, 'freeze render track.effects').map(({ id }) => String(id)));
	const automationLanes = dataArray(project.automationLanes, 'project.automationLanes').filter((value) => {
		const lane = normalizeAutomationLaneV21(value);
		return lane.address.kind === 'effect' && lane.address.strip.kind === 'track'
			&& lane.address.strip.id === trackId && effectIds.has(lane.address.effectId);
	});
	const masterChannels = Number(project.masterChannels);
	const trackWidth = resolveTerminalChannelWidths({
		...project,
		tracks: [track],
		clips,
		sources,
	} as never, masterChannels).tracks.get(trackId) ?? masterChannels;
	return Object.freeze({
		...project,
		// The capture is pre-master, so the programme width is not the render width. Sizing
		// the offline context from masterChannels downmixed a wide stem to the delivery
		// width, and committing that render narrowed the track underneath every channel map
		// already pointing at it, leaving a document that could not build a graph at all.
		masterChannels: trackWidth,
		tracks: Object.freeze([Object.freeze({ ...track, gain: 1, pan: 0, mute: false, solo: false })]),
		clips: Object.freeze(clips),
		sources: Object.freeze(sources),
		automationLanes: Object.freeze(automationLanes),
		trackFolders: Object.freeze([]),
		mixer: createDefaultMixerGraphV21([{ id: trackId, channelCount: trackWidth }], trackWidth),
		master: Object.freeze({
			...dataRecord(project.master, 'project.master'),
			gain: 1, pan: 0, mute: false, solo: false, effectsActive: false, effects: Object.freeze([]),
		}),
	});
}

async function stageFreezeSource(
	store: FreezeStore,
	request: Readonly<{
		readonly sourceId: string;
		readonly contentSha256: string;
		readonly frameCount: number;
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly body: FreezeBody;
		readonly signal?: AbortSignal;
	}>,
): Promise<FreezeStage> {
	const descriptor = Object.freeze(createAudioSourceV10({
		id: request.sourceId,
		name: 'Frozen track render',
		mimeType: 'audio/x-soundscaper-pcm',
		storageKey: request.sourceId,
		contentSha256: request.contentSha256,
		frameCount: request.frameCount,
		channelCount: request.channelCount,
		sampleRate: request.sampleRate,
		originalSampleRate: request.sampleRate,
		sampleFormat: 'float32',
		chunkFrames: SOURCE_CHUNK_FRAMES,
	}));
	const writer = await store.beginSourceWrite(request.sourceId, {
		sampleRate: request.sampleRate,
		channelCount: request.channelCount,
		chunkFrames: SOURCE_CHUNK_FRAMES,
		contentSha256: request.contentSha256,
		derivedKind: 'audio-track-freeze-v1',
	});
	try {
		for (let start = 0; start < request.frameCount; start += SOURCE_CHUNK_FRAMES) {
			throwIfAborted(request.signal);
			const end = Math.min(request.frameCount, start + SOURCE_CHUNK_FRAMES);
			await writer.write(request.body.channels.map((channel) => channel.subarray(start, end)), {
				signal: request.signal,
			});
		}
		return { sourceId: request.sourceId, contentSha256: request.contentSha256, descriptor, writer, authority: null };
	} catch (error) {
		await writer.abort();
		throw error;
	}
}

function hashFreezeBody(body: FreezeBody, signal?: AbortSignal): string {
	const digestWriter = sha256.create();
	for (let start = 0; start < body.frameCount; start += SOURCE_CHUNK_FRAMES) {
		throwIfAborted(signal);
		const end = Math.min(body.frameCount, start + SOURCE_CHUNK_FRAMES);
		const header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, end - start, true);
		digestWriter.update(header);
		for (const channel of body.channels) digestWriter.update(float32LittleEndian(channel.subarray(start, end)));
	}
	return bytesToHex(digestWriter.digest());
}

function float32LittleEndian(values: Float32Array): Uint8Array {
	const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < values.length; index += 1) view.setFloat32(index * 4, values[index]!, true);
	return bytes;
}

function committedFreezeClip(id: string, freeze: DataRecord): DataRecord {
	const sourceId = stableId(freeze.derivedSourceId, 'committed freeze source');
	const start = nonNegativeInteger(freeze.renderStartFrame, 'committed freeze start');
	const frames = positiveInteger(freeze.renderFrameCount, 'committed freeze frame count');
	return Object.freeze(createAudioClipV10({
		id, sourceId, title: 'Committed frozen track', anchor: 'sample',
		timelineStartFrame: start, durationFrames: frames,
		sourceStartFrame: 0, sourceDurationFrames: frames,
		trimStartFrames: 0, trimEndFrames: 0, gain: 1,
		fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], pitchCents: 0, speedRatio: 1,
	}));
}

async function cleanupRenderResources(
	engine: Pick<SoundscaperAudioFreezeRenderEngineV21, 'dispose'>,
	providers: ReadonlyMap<string, ReturnType<typeof createStoredChunkProvider>>,
	primary: unknown,
): Promise<void> {
	const settled = await Promise.allSettled([
		engine.dispose(),
		...Array.from(providers.values(), (provider) => provider.dispose()),
	]);
	const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason as unknown);
	if (!failures.length) return;
	if (primary !== null) throw new AggregateError([primary, ...failures], 'Freeze render and cleanup both failed.', { cause: primary });
	throw new AggregateError(failures, 'Freeze render cleanup failed.');
}

function exactCurrentProject(
	controller: SoundscaperAudioFreezeControllerV21,
	validateProject: (project: unknown) => unknown = validateSoundscaperProjectV21,
): SoundscaperProjectV21 {
	// Injected for the same reason as the automation target resolver: later
	// production revisions inherit this file, and only the validator differs.
	if (!validateProject(controller.project)) throw new TypeError('An exact Soundscaper production project must be open.');
	return controller.project as SoundscaperProjectV21;
}

function assertCurrent(controller: SoundscaperAudioFreezeControllerV21, ticket: ProjectTicket): void {
	assertCurrentSoundscaperFreezeProjectV21(controller, ticket);
}

function assertDependencies(
	environment: SoundscaperAudioFreezeEnvironmentV21,
	controller: SoundscaperAudioFreezeControllerV21,
	options: SoundscaperAudioFreezeActionsOptionsV21,
): void {
	if (!environment?.store || typeof environment.store.beginSourceWrite !== 'function'
		|| typeof environment.store.discardSourceIfCurrent !== 'function'
		|| typeof environment.playback?.hashSourceContent !== 'function'
		|| typeof environment.playback.admitVerifiedFreeze !== 'function') {
		throw new TypeError('The exact Soundscaper freeze environment is required.');
	}
	if (!controller?.actions?.edit || typeof controller.actions.edit.commit !== 'function') {
		throw new TypeError('The exact Soundscaper freeze controller is required.');
	}
	if (options.createId !== undefined && typeof options.createId !== 'function') throw new TypeError('Freeze createId must be a function.');
	if (options.createRenderEngine !== undefined && typeof options.createRenderEngine !== 'function') {
		throw new TypeError('Freeze createRenderEngine must be a function.');
	}
}

function defaultId(kind: 'source' | 'clip'): string {
	if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Secure freeze ID allocation is unavailable.');
	return `soundscaper-audio-freeze-${kind}-${globalThis.crypto.randomUUID()}`;
}

function exactRecordById(values: readonly unknown[], id: string, name: string): DataRecord {
	const matches = values.filter((value) => dataRecord(value, name).id === id);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} must exist exactly once.`);
	return dataRecord(matches[0], `${name} ${id}`);
}

function dataArray(value: unknown, name: string): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function arrayValue(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be nonnegative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 1) throw new RangeError(`${name} exceeds the safe frame range.`);
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Audio freeze operation aborted.', 'AbortError');
}
