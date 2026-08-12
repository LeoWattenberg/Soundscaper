/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { projectEffectTailFrames } from '../effects.js';
import {
	AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES,
	AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES,
} from '../pcm-sink-admission.ts';
import { throwIfAborted } from './async-utils.ts';
import {
	audioBufferChannels,
	clamp,
	clampFrame,
	MAX_EFFECT_TAIL_SECONDS,
} from './buffer-math.ts';
import { projectGraphLatencyFrames } from './project-graph.ts';
import { projectEffectRacks } from './project-effects.ts';
import type {
	EngineRuntimeHost,
	PreparedAudioWarpPlayback,
} from './runtime-types.ts';
import type { EngineProject } from './types.ts';

const TEXT_ENCODER = new TextEncoder();
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;

/** Includes the offline output and a possible realtime-context copy. */
export const AUDIO_WARP_EXACT_WINDOW_MAX_USEFUL_BINARY_BYTES = 32 * 1024 * 1024;
export const AUDIO_WARP_EXACT_WINDOW_MAX_SECONDS = 5;
export const AUDIO_WARP_EXACT_MIN_CHUNK_FRAMES = AUDIO_EDITOR_PCM_SINK_MIN_CHUNK_FRAMES;
export const AUDIO_WARP_EXACT_MAX_CHUNK_FRAMES = AUDIO_EDITOR_PCM_SINK_MAX_CHUNK_FRAMES;

interface ExactWindowGeometry {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameCount: number;
	readonly maximumFrameCount: number;
}

interface ExactWindowPlanOptions {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly preRollFrames?: number;
	readonly tailFrames?: number;
	readonly graphLatencyFrames?: number;
	readonly playbackCopy?: boolean;
}

const typedProjectEffectTailFrames = projectEffectTailFrames as (
	project: EngineProject,
	options?: Readonly<{
		trackId?: unknown;
		includeMaster?: boolean;
		maximumSeconds?: number;
	}>,
) => number;

export function projectHasAuthoredAudioWarp(project: EngineRuntimeHost['project']): boolean {
	return Boolean(project?.clips?.some((clip) => clip?.warpMap != null));
}

/** Bind every exact derivative to the complete immutable runtime project authority. */
export function audioWarpPlaybackAuthorityFingerprint(project: EngineRuntimeHost['project']): string {
	if (!project || !projectHasAuthoredAudioWarp(project)) {
		throw new Error('An authored audio warp project is required for playback authority.');
	}
	return bytesToHex(sha256(TEXT_ENCODER.encode(canonicalJson(project))));
}

/** Plan a bounded render window before allocating its OfflineAudioContext output. */
export function planExactAudioWarpWindow(options: ExactWindowPlanOptions): Readonly<ExactWindowGeometry> {
	const startFrame = safeInteger(options.startFrame, 'Exact audio warp window start');
	const endFrame = safeInteger(options.endFrame, 'Exact audio warp window end');
	const sampleRate = positiveSafeInteger(options.sampleRate, 'Exact audio warp sample rate');
	const channelCount = positiveSafeInteger(options.channelCount, 'Exact audio warp channel count');
	if (channelCount > 32) throw new RangeError('Exact audio warp channel count cannot exceed 32.');
	if (endFrame <= startFrame) throw new RangeError('Exact audio warp window must contain timeline frames.');
	const preRollFrames = safeInteger(options.preRollFrames ?? 0, 'Exact audio warp pre-roll');
	const tailFrames = safeInteger(options.tailFrames ?? 0, 'Exact audio warp tail');
	const graphLatencyFrames = safeInteger(options.graphLatencyFrames ?? 0, 'Exact audio warp graph latency');
	const samplesBudget = Math.floor(AUDIO_WARP_EXACT_WINDOW_MAX_USEFUL_BINARY_BYTES
		/ (channelCount * FLOAT32_BYTES));
	const captureOffsetFrames = preRollFrames + graphLatencyFrames;
	// context=(capture offset + requested output); a crop copy coexists when
	// captureOffset>0. Playback then adds one AudioBuffer copy. Sink packet
	// coexistence is no larger than the conservative second requested copy.
	const retainedRequestedCopies = 1
		+ (captureOffsetFrames > 0 ? 1 : 0)
		+ (options.playbackCopy ? 1 : 0)
		+ (!options.playbackCopy && captureOffsetFrames === 0 ? 1 : 0);
	const maximumOutputFrames = Math.floor(
		(samplesBudget - captureOffsetFrames) / retainedRequestedCopies,
	);
	const maximumFrameCount = Math.min(
		Math.floor(AUDIO_WARP_EXACT_WINDOW_MAX_SECONDS * sampleRate),
		maximumOutputFrames - tailFrames,
	);
	if (maximumFrameCount < 1) {
		throw new RangeError('Exact audio warp pre-roll and tail exceed the bounded window budget.');
	}
	const frameCount = Math.min(endFrame - startFrame, maximumFrameCount);
	return Object.freeze({
		startFrame,
		endFrame: startFrame + frameCount,
		frameCount,
		maximumFrameCount,
	});
}

export function clearPreparedAudioWarpPlayback(engine: EngineRuntimeHost): void {
	engine.preparedAudioWarpPlayback = null;
	engine.audioWarpPlaybackPreparation = null;
}

/** Bounded windows cannot reset unbounded or opaque processor state exactly. */
export function assertExactAudioWarpWindowGraph(
	project: EngineRuntimeHost['project'],
	trackId: unknown = null,
	includeMaster = true,
): void {
	if (!project) throw new Error('Exact audio warp rendering requires a project.');
	for (const rack of projectEffectRacks(project)) {
		if (!rack.effectsActive || (rack.scope === 'track' && trackId != null
			&& rack.targetId !== String(trackId)) || (rack.scope === 'master' && !includeMaster)) continue;
		const unsupported = rack.effects.find((effect) => effect?.enabled !== false && effect?.bypassed !== true);
		if (unsupported) {
			throw new Error(
				`Exact bounded audio warp fallback cannot reset the ${String(unsupported.type ?? 'unknown')} processor in the ${rack.scope} rack. Disable it or use realtime warp acceleration.`,
			);
		}
	}
}

/** Render one authority-keyed, bounded exact window for demand-driven playback. */
export function prepareExactAudioWarpPlayback(
	engine: EngineRuntimeHost,
	startFrame: number,
	endFrame = engine.durationFrames,
	signal: AbortSignal | null = null,
): Promise<Readonly<PreparedAudioWarpPlayback>> {
	if (!engine.project || !projectHasAuthoredAudioWarp(engine.project)) {
		return Promise.reject(new Error('Exact audio warp playback requires an authored warp map.'));
	}
	const project = engine.project;
	assertExactAudioWarpWindowGraph(project);
	const graphLatencyFrames = exactGraphLatencyFrames(engine, null, true);
	const range = planExactAudioWarpWindow({
		startFrame: clampFrame(startFrame, 0, engine.durationFrames),
		endFrame: clampFrame(endFrame, 0, engine.durationFrames),
		sampleRate: engine.sampleRate,
		channelCount: clamp(Number(project.masterChannels) || 2, 1, 32),
		graphLatencyFrames,
		playbackCopy: true,
	});
	const authorityFingerprint = audioWarpPlaybackAuthorityFingerprint(project);
	const cached = engine.preparedAudioWarpPlayback;
	if (cached && matchesWindow(cached, project, authorityFingerprint, range)) return Promise.resolve(cached);
	const active = engine.audioWarpPlaybackPreparation;
	if (active && matchesWindow(active, project, authorityFingerprint, range)) return active.promise;
	const promise = renderExactPlaybackWindow(engine, project, authorityFingerprint, range, signal);
	const preparation = Object.freeze({ project, authorityFingerprint, ...range, promise });
	engine.audioWarpPlaybackPreparation = preparation;
	void promise.finally(() => {
		if (engine.audioWarpPlaybackPreparation === preparation) {
			engine.audioWarpPlaybackPreparation = null;
		}
	}).catch(() => undefined);
	return promise;
}

/** Stream an exact fallback as sequential bounded OfflineAudioContext windows. */
export async function renderExactAudioWarpToSink(
	engine: EngineRuntimeHost,
	options: Readonly<Record<string, unknown>>,
): Promise<Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly chunkCount: number;
}>> {
	const signal = abortSignalOption(options.signal);
	throwIfAborted(signal);
	if (!engine.project || !projectHasAuthoredAudioWarp(engine.project)) {
		throw new Error('Exact audio warp streaming requires an authored warp map.');
	}
	const project = engine.project;
	assertExactAudioWarpWindowGraph(project, options.trackId, options.includeMaster !== false);
	const authorityFingerprint = audioWarpPlaybackAuthorityFingerprint(project);
	const requestedSampleRate = options.sampleRate ?? engine.sampleRate;
	if (requestedSampleRate !== engine.sampleRate) {
		throw new RangeError('Exact audio warp fallback streaming requires the project sample rate.');
	}
	const onChunk = options.onChunk;
	if (typeof onChunk !== 'function') throw new TypeError('Exact audio warp streaming requires an onChunk callback.');
	const chunkFrames = boundedChunkFrames(options.chunkFrames ?? 4_096);
	const startFrame = clampFrame(numberOption(options.startFrame) ?? 0, 0, engine.durationFrames);
	const endFrame = clampFrame(numberOption(options.endFrame) ?? engine.durationFrames, startFrame, engine.durationFrames);
	if (endFrame <= startFrame) throw new RangeError('Exact audio warp streaming requires a non-empty range.');
	// The graph preflight admits no stateful or latency-owning processors.
	// Gain, pan, mute, envelopes, and clip fades are absolute-time schedules,
	// so replaying earlier PCM would add cost without restoring state.
	const preRollFrames = 0;
	const tailFrames = exactTailFrames(engine, options.includeTail, options.trackId, options.includeMaster);
	const graphLatencyFrames = exactGraphLatencyFrames(
		engine,
		options.trackId,
		options.includeMaster !== false,
	);
	const expectedFrames = endFrame - startFrame + tailFrames;
	const requestedOutputFrames = nullableNumberOption(options.outputFrames);
	if (requestedOutputFrames != null && requestedOutputFrames !== expectedFrames) {
		throw new RangeError('Exact audio warp fallback does not substitute scalar output-length conversion.');
	}
	let cursor = startFrame;
	let frameOffset = 0;
	let chunkCount = 0;
	let renderedChannelCount: number | null = null;
	// Track/stem routes need not share the master width. Planning against 32
	// channels is conservative; the first window establishes actual geometry.
	const admittedChannelCount = 32;
	while (cursor < endFrame) {
		throwIfAborted(signal);
		assertProjectAuthority(engine, project, authorityFingerprint);
		const activePreRoll = Math.min(preRollFrames, cursor);
		const finalPlan = planExactAudioWarpWindow({
			startFrame: cursor,
			endFrame,
			sampleRate: engine.sampleRate,
			channelCount: admittedChannelCount,
			preRollFrames: activePreRoll,
			tailFrames,
			graphLatencyFrames,
		});
		const finalWindow = finalPlan.endFrame === endFrame;
		const range = finalWindow ? finalPlan : planExactAudioWarpWindow({
			startFrame: cursor,
			endFrame,
			sampleRate: engine.sampleRate,
			channelCount: admittedChannelCount,
			preRollFrames: activePreRoll,
			graphLatencyFrames,
		});
		const rendered = await engine.renderMix({
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			includeTail: finalWindow ? options.includeTail as boolean | number | undefined : false,
			trackId: options.trackId,
			includeMaster: booleanOption(options.includeMaster),
			includeTrackPan: booleanOption(options.includeTrackPan),
			respectMuteSolo: booleanOption(options.respectMuteSolo),
			preRollFrames: activePreRoll,
			signal,
		});
		throwIfAborted(signal);
		assertProjectAuthority(engine, project, authorityFingerprint);
		const channels = audioBufferChannels(rendered);
		const renderedFrames = channels[0]?.length ?? 0;
		const expectedWindowFrames = range.frameCount + (finalWindow ? tailFrames : 0);
		if (renderedChannelCount === null) renderedChannelCount = channels.length;
		assertPlanarGeometry(channels, renderedChannelCount, expectedWindowFrames);
		for (let offset = 0; offset < renderedFrames; offset += chunkFrames) {
			throwIfAborted(signal);
			const packetFrames = Math.min(chunkFrames, renderedFrames - offset);
			const packet = channels.map((channel) => channel.slice(offset, offset + packetFrames));
			await Reflect.apply(onChunk, undefined, [packet, { frameOffset, sampleRate: engine.sampleRate }]);
			frameOffset += packetFrames;
			chunkCount += 1;
			if (typeof options.onProgress === 'function') {
				Reflect.apply(options.onProgress, undefined, [{
					frames: frameOffset,
					totalFrames: expectedFrames,
					progress: Math.min(1, frameOffset / expectedFrames),
				}]);
			}
		}
		cursor = range.endFrame;
	}
	return Object.freeze({
		sampleRate: engine.sampleRate,
		channelCount: renderedChannelCount ?? 0,
		frameCount: frameOffset,
		chunkCount,
	});
}

async function renderExactPlaybackWindow(
	engine: EngineRuntimeHost,
	project: NonNullable<EngineRuntimeHost['project']>,
	authorityFingerprint: string,
	range: Readonly<ExactWindowGeometry>,
	signal: AbortSignal | null,
): Promise<Readonly<PreparedAudioWarpPlayback>> {
	throwIfAborted(signal);
	const rendered = await engine.renderMix({
		startFrame: range.startFrame,
		endFrame: range.endFrame,
		includeTail: false,
		outputFrames: range.frameCount,
		signal,
	});
	throwIfAborted(signal);
	assertProjectAuthority(engine, project, authorityFingerprint);
	const channels = audioBufferChannels(rendered);
	const channelCount = clamp(Number(project.masterChannels) || 2, 1, 32);
	assertPlanarGeometry(channels, channelCount, range.frameCount);
	const prepared = {
		project,
		authorityFingerprint,
		startFrame: range.startFrame,
		endFrame: range.endFrame,
		channels: Object.freeze(channels.slice()),
		frameCount: range.frameCount,
		sampleRate: engine.sampleRate,
		audioBuffer: isAudioBuffer(rendered) ? rendered : null,
	} satisfies PreparedAudioWarpPlayback;
	engine.preparedAudioWarpPlayback = prepared;
	return prepared;
}

function exactTailFrames(
	engine: EngineRuntimeHost,
	includeTail: unknown,
	trackId: unknown,
	includeMaster: unknown,
): number {
	if (!engine.project || !includeTail) return 0;
	if (typeof includeTail === 'number' && Number.isFinite(includeTail)) {
		return Math.round(clamp(includeTail, 0, MAX_EFFECT_TAIL_SECONDS) * engine.sampleRate);
	}
	return typedProjectEffectTailFrames(engine.project, {
		trackId: trackId == null ? null : String(trackId),
		includeMaster: includeMaster !== false,
		maximumSeconds: MAX_EFFECT_TAIL_SECONDS,
	});
}

function exactGraphLatencyFrames(
	engine: EngineRuntimeHost,
	trackId: unknown,
	includeMaster: boolean,
): number {
	return projectGraphLatencyFrames(engine.project, {
		trackId,
		includeMaster,
		sampleRate: engine.sampleRate,
	});
}

function matchesWindow(
	value: Readonly<{
		project: EngineProject;
		authorityFingerprint: string;
		startFrame: number;
		endFrame: number;
	}> | null,
	project: EngineProject,
	authorityFingerprint: string,
	range: Readonly<ExactWindowGeometry>,
): boolean {
	return value?.project === project
		&& value.authorityFingerprint === authorityFingerprint
		&& value.startFrame === range.startFrame
		&& value.endFrame === range.endFrame;
}

function assertProjectAuthority(
	engine: EngineRuntimeHost,
	project: EngineProject,
	authorityFingerprint: string,
): void {
	if (engine.project !== project
		|| audioWarpPlaybackAuthorityFingerprint(engine.project) !== authorityFingerprint) {
		throw new Error('The audio warp project changed during exact PCM rendering.');
	}
}

function assertPlanarGeometry(
	channels: readonly Float32Array[],
	channelCount: number,
	frameCount: number,
): void {
	if (channels.length !== channelCount || frameCount < 1
		|| channels.some((channel) => !(channel instanceof Float32Array)
			|| channel.length !== frameCount)) {
		throw new Error(`Exact audio warp returned invalid PCM geometry (${String(channels.length)} channels, expected ${String(channelCount)}; ${String(channels[0]?.length ?? 0)} frames, expected ${String(frameCount)}).`);
	}
}

function isAudioBuffer(value: unknown): value is AudioBuffer {
	const candidate = value as Partial<AudioBuffer> | null;
	return Boolean(candidate && typeof candidate.getChannelData === 'function'
		&& Number.isSafeInteger(candidate.numberOfChannels)
		&& Number.isSafeInteger(candidate.length)
		&& Number.isSafeInteger(candidate.sampleRate));
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Audio warp playback authority requires finite numbers.');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (!value || typeof value !== 'object') throw new TypeError('Audio warp playback authority is not serializable.');
	const record = value as Readonly<Record<string, unknown>>;
	const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function numberOption(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

function nullableNumberOption(value: unknown): number | null | undefined {
	return value === null || typeof value === 'number' ? value : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function boundedChunkFrames(value: unknown): number {
	const frames = positiveSafeInteger(value, 'Exact audio warp chunk size');
	if (frames < AUDIO_WARP_EXACT_MIN_CHUNK_FRAMES || frames > AUDIO_WARP_EXACT_MAX_CHUNK_FRAMES) {
		throw new RangeError(`Exact audio warp chunk size must be between ${String(AUDIO_WARP_EXACT_MIN_CHUNK_FRAMES)} and ${String(AUDIO_WARP_EXACT_MAX_CHUNK_FRAMES)} frames.`);
	}
	return frames;
}

function abortSignalOption(value: unknown): AbortSignal | null {
	return value && typeof value === 'object' && 'aborted' in value
		&& typeof (value as AbortSignal).addEventListener === 'function'
		? value as AbortSignal
		: null;
}
