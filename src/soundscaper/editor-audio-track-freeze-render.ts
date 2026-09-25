/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	assertCurrentSoundscaperFreezeProject, soundscaperFreezeRenderFingerprint,
	type SoundscaperFreezeTicket,
} from './editor-audio-track-freeze-currency.ts';
import { normalizeAutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import { clipNeedsTimePitchRender } from '../common/editor/clip-time-pitch-cache.js';
import { createStoredChunkProvider, SOURCE_CHUNK_FRAMES } from '../common/editor/controller/source/source-audio.ts';
import { rackTailFrames } from '../common/editor/effects.js';
import { audioBufferChannels, type PlanarPcm } from '../common/editor/engine/buffer-math.ts';
import { compileProjectPathPdcPlanV21 } from '../common/editor/engine/project-path-pdc-plan-v21.ts';
import type { EnginePublicApi } from '../common/editor/engine/public-api.ts';
import type { EngineSourceResolver } from '../common/editor/engine/types.ts';
import { createDefaultMixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import { createAudioSource } from '../common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../common/editor/runtime-clip-projection.ts';
import { resolveTerminalChannelWidths } from '../common/editor/terminal-channel-widths.ts';
import type { StorageRecord } from '../common/editor/storage/media-records.ts';
import type { AudioSourceWriter } from '../common/editor/storage/source-write-repository.ts';
import type { TransientAnalysisPcmStore } from '../common/editor/controller/analysis/transient-analysis-pcm-access.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import {
	arrayValue, dataArray, dataRecord, exactRecordById, nonNegativeInteger,
	positiveInteger, safeAdd, stableId, throwIfAborted, type DataRecord,
} from './editor-audio-track-freeze-values.ts';

export interface FreezeStore extends TransientAnalysisPcmStore {
	beginSourceWrite(sourceId: string, metadata: Record<string, unknown>): Promise<AudioSourceWriter>;
	readSourceChunk(sourceId: string, chunkIndex: number, options?: Record<string, unknown>): Promise<unknown>;
	discardSourceIfCurrent(source: StorageRecord): Promise<boolean>;
}

export interface SoundscaperAudioFreezeRenderEngine {
	setSourceResolver?(sourceResolver: EngineSourceResolver): unknown;
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

export interface FreezeBody {
	readonly channels: readonly Float32Array[];
	readonly frameCount: number;
	readonly sampleRate: number;
}

export interface FreezeStage {
	readonly sourceId: string;
	readonly contentSha256: string;
	readonly descriptor: DataRecord;
	readonly writer: AudioSourceWriter;
	authority: StorageRecord | null;
}

export interface FreezeTimePitchRenderOptions {
	readonly sourceResolver?: EngineSourceResolver;
	readonly prepareTimePitchCaches?: (project: DataRecord, signal?: AbortSignal) => Promise<unknown>;
}

export function planFreezeRange(project: SoundscaperProject, trackId: string) {
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

export async function renderFreezeBody(
	store: FreezeStore,
	controller: Readonly<{ readonly project: unknown }>,
	createEngine: () => SoundscaperAudioFreezeRenderEngine,
	request: Readonly<{
		readonly project: SoundscaperProject;
		readonly trackId: string;
		readonly renderStartFrame: number;
		readonly renderFrameCount: number;
		readonly sampleRate: number;
		readonly signal?: AbortSignal;
	}>,
	options: FreezeTimePitchRenderOptions = {},
): Promise<Readonly<{ readonly body: FreezeBody; readonly frameCount: number; readonly sampleRate: number; readonly channelCount: number }>> {
	const ticket: SoundscaperFreezeTicket = Object.freeze({
		project: request.project,
		trackId: request.trackId,
		fingerprint: soundscaperFreezeRenderFingerprint(request.project, request.trackId),
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
			throwIfAborted(request.signal); assertCurrentSoundscaperFreezeProject(controller, ticket);
			if (!metadata) throw new Error(`Stored PCM for ${String(source.id)} is unavailable.`);
			providers.set(String(source.id), createStoredChunkProvider(store, source as never, metadata));
		}
		const latency = compileProjectPathPdcPlanV21(request.project, { sampleRate: request.sampleRate })
			.freezeLatencyFramesByTrack.get(request.trackId) ?? 0;
		const laneEndFrame = request.renderStartFrame + request.renderFrameCount
			- (track.effectsActive === false ? 0 : rackTailFrames(track.effects, request.sampleRate, 10));
		const renderProject = freezeRenderProject(runtime, track, clips, sources);
		if (options.prepareTimePitchCaches) {
			await options.prepareTimePitchCaches(renderProject, request.signal);
			throwIfAborted(request.signal);
			assertCurrentSoundscaperFreezeProject(controller, ticket);
		}
		if (options.sourceResolver) {
			if (!engine.setSourceResolver) throw new TypeError('The freeze renderer cannot resolve time/pitch sources.');
			engine.setSourceResolver(options.sourceResolver);
		}
		for (const clip of clips) {
			if (clip.warpMap != null || !clipNeedsTimePitchRender(clip)) continue;
			const resolved = options.sourceResolver?.(clip as never, {
				project: renderProject as never, sources: new Map(), defaultBuffer: null,
			});
			if (!resolved) {
				throw new Error(`The time/pitch render for clip ${String(clip.id)} is unavailable for freeze.`);
			}
		}
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
		assertCurrentSoundscaperFreezeProject(controller, ticket);
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

export async function stageFreezeSource(
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
	const descriptor = Object.freeze(createAudioSource({
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

export function hashFreezeBody(body: FreezeBody, signal?: AbortSignal): string {
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

async function cleanupRenderResources(
	engine: Pick<SoundscaperAudioFreezeRenderEngine, 'dispose'>,
	providers: ReadonlyMap<string, ReturnType<typeof createStoredChunkProvider>>,
	primary: unknown,
): Promise<void> {
	const settled = await Promise.allSettled([
		Promise.resolve().then(() => engine.dispose()),
		...Array.from(providers.values(), (provider) => Promise.resolve().then(() => provider.dispose())),
	]);
	const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason as unknown);
	if (!failures.length) return;
	if (primary !== null) throw new AggregateError([primary, ...failures], 'Freeze render and cleanup both failed.', { cause: primary });
	throw new AggregateError(failures, 'Freeze render cleanup failed.');
}
