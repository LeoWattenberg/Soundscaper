/* SPDX-License-Identifier: AGPL-3.0-only */

import { createChunkStreamAudioNode } from '../chunk-stream-worklet-node.js';
import {
	addNode,
	connect,
	getTransientNodes,
	releaseTransientNodes,
	setParam,
	type AudioNodeArray,
} from './audio-node-utils.ts';
import { longSourceError, throwIfAborted } from './async-utils.ts';
import {
	chunkChannels,
	createClipGainChain,
	createReversedChunkSource,
	type ClipGainChain,
} from './clip-scheduler-chunk-sources.ts';
import {
	clipStart,
	getReversedBuffer,
} from './buffer-math.ts';
import { scheduleClipGain, scheduleProjectGains } from './clip-gain.ts';
import {
	buildClipSchedulePlans,
	type ClipSchedulePlan,
} from './clip-schedule-plan.ts';
import type {
	AudioScheduledSourceNode,
	ProjectGainParams,
	ScheduledGainParam,
} from './project-graph.ts';
import type {
	EngineChunkSource,
	EngineProject,
	EngineSourceResolver,
	UnknownRecord,
} from './types.ts';

const STREAM_RESAMPLE_RADIUS = 24;

export interface ChunkStreamHandle {
	readonly ready: Promise<unknown>;
	readonly primed: Promise<unknown>;
	readonly done: Promise<unknown>;
	play(options: Readonly<{ contextStartFrame: number }>): Promise<unknown> | unknown;
	cancel(): void;
}

export interface ChunkStreamUnderrunDetails {
	readonly frame: number;
	readonly frames: number;
	readonly sourceEnded: boolean;
}

export interface ScheduledChunkStreamUnderrun extends ChunkStreamUnderrunDetails {
	readonly clipId: string;
	readonly sourceId: string;
}

export interface ChunkStreamClientLike {
	open(options: Readonly<{
		source: EngineChunkSource;
		outputPort: MessagePort;
		signal: AbortSignal | null;
		startFrame?: number;
		endFrame?: number;
		sourceStartFrame?: number;
		sourceEndFrame?: number;
		outputFrameCount?: number;
		resampleInputFrames?: number;
		resampleInputOffset?: number;
		highWaterMark?: number;
		onUnderrun?: ((details: ChunkStreamUnderrunDetails) => void) | null;
	}>): ChunkStreamHandle;
}

export type ChunkAudioNodeFactory = (
	context: BaseAudioContext,
	options: Readonly<{
		channelCount: number;
		maxQueuePackets?: number;
		prebufferPackets?: number;
	}>,
) => Promise<AudioWorkletNode>;

export interface ScheduleProgress {
	readonly frames: number;
	readonly totalFrames: number;
	readonly progress: number;
}

export interface ScheduleProjectClipsOptions {
	readonly context: BaseAudioContext;
	readonly project: EngineProject;
	readonly sources: ReadonlyMap<unknown, AudioBuffer>;
	readonly chunkSources?: ReadonlyMap<unknown, EngineChunkSource>;
	readonly trackInputs: ReadonlyMap<string, AudioNode>;
	readonly trackGainParams?: ReadonlyMap<string, ScheduledGainParam>;
	readonly projectGainParams?: ProjectGainParams | null;
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly transportRate?: number;
	readonly reversedBuffers: WeakMap<AudioBuffer, AudioBuffer>;
	readonly sourceResolver: EngineSourceResolver | null;
	readonly activeSources: Set<AudioScheduledSourceNode>;
	readonly allNodes: AudioNodeArray;
	readonly mode?: 'live' | 'offline';
	readonly chunkStreamClient?: ChunkStreamClientLike | null;
	readonly chunkAudioNodeFactory?: ChunkAudioNodeFactory;
	readonly signal?: AbortSignal | null;
	readonly onProgress?: ((progress: ScheduleProgress) => void) | null;
	readonly onStreamUnderrun?: ((details: ScheduledChunkStreamUnderrun) => void) | null;
	readonly deferStartUntilPrimed?: boolean;
	/**
	 * How deep each streamed clip queues, and how much it banks before it starts.
	 * Monitoring wants the shallow defaults so the transport responds; a render that
	 * only happens to run in realtime wants depth, because one starved quantum voids
	 * the whole result rather than clicking once.
	 */
	readonly streamQueuePackets?: number | null;
	readonly streamPrebufferPackets?: number | null;
}

export async function scheduleProjectClips({
	context,
	project,
	sources,
	chunkSources = new Map(),
	trackInputs,
	trackGainParams = new Map(),
	projectGainParams = null,
	fromFrame,
	toFrame,
	contextStartTime,
	sampleRate,
	transportRate = 1,
	reversedBuffers,
	sourceResolver,
	activeSources,
	allNodes,
	mode = 'live',
	chunkStreamClient = null,
	chunkAudioNodeFactory = createChunkStreamAudioNode,
	signal = null,
	onProgress = null,
	onStreamUnderrun = null,
	deferStartUntilPrimed = false,
	streamQueuePackets = null,
	streamPrebufferPackets = null,
}: ScheduleProjectClipsOptions): Promise<Readonly<{
	contextStartTime: number;
	streamedClips: number;
	waitForStreamedClips(): Promise<void>;
}>> {
	throwIfAborted(signal);
	const plans = buildClipSchedulePlans({
		project,
		sources,
		chunkSources,
		trackInputs,
		fromFrame,
		toFrame,
		sampleRate,
		sourceResolver,
	});
	const streamed: PreparedLiveChunkPlan[] = [];
	let loadedChunkFrames = 0;
	const totalChunkFrames = plans.reduce((total, plan) => (
		total + (plan.originalBuffer
			? 0
			: Math.ceil(plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate))
	), 0);
	const chunkPlans = plans.filter((plan) => !plan.originalBuffer);
	if (mode === 'offline') {
		for (const plan of chunkPlans) {
			throwIfAborted(signal);
			await scheduleOfflineChunkPlan({
				plan,
				context,
				contextStartTime,
				fromFrame,
				sampleRate,
				activeSources,
				allNodes,
				signal,
				onChunkLoaded: (frames) => {
					loadedChunkFrames += frames;
					onProgress?.({
						frames: loadedChunkFrames,
						totalFrames: totalChunkFrames,
						progress: totalChunkFrames ? Math.min(1, loadedChunkFrames / totalChunkFrames) : 1,
					});
				},
			});
		}
	} else if (chunkPlans.length) {
		if (!chunkStreamClient) throw longSourceError('The long-source playback worker is unavailable.');
		streamed.push(...await Promise.all(chunkPlans.map((plan) => {
			throwIfAborted(signal);
			return prepareLiveChunkPlan({
				plan,
				context,
				chunkStreamClient,
				chunkAudioNodeFactory,
				transportRate,
				activeSources,
				allNodes,
				signal,
				onStreamUnderrun,
				streamQueuePackets,
				streamPrebufferPackets,
			});
		})));
	}

	const actualContextStartTime = streamed.length && deferStartUntilPrimed
		? Math.max(contextStartTime, (context.currentTime || 0) + 0.02)
		: contextStartTime;
	scheduleProjectGains({
		context,
		project,
		gainParams: projectGainParams || { tracks: trackGainParams },
		fromFrame,
		toFrame,
		contextStartTime: actualContextStartTime,
		sampleRate,
		transportRate,
	});
	for (const plan of plans) {
		if (!plan.originalBuffer) continue;
		scheduleBufferPlan({
			plan,
			context,
			contextStartTime: actualContextStartTime,
			fromFrame,
			sampleRate,
			transportRate,
			reversedBuffers,
			activeSources,
			allNodes,
		});
	}
	for (const prepared of streamed) {
		prepared.start(actualContextStartTime, fromFrame, sampleRate, transportRate);
	}
	if (totalChunkFrames && mode === 'offline') {
		onProgress?.({ frames: totalChunkFrames, totalFrames: totalChunkFrames, progress: 1 });
	}
	return {
		contextStartTime: actualContextStartTime,
		streamedClips: streamed.length,
		async waitForStreamedClips(): Promise<void> {
			await Promise.all(streamed.map((prepared) => prepared.done));
		},
	};
}

interface BufferPlanOptions {
	readonly plan: ClipSchedulePlan;
	readonly context: BaseAudioContext;
	readonly contextStartTime: number;
	readonly fromFrame: number;
	readonly sampleRate: number;
	readonly transportRate: number;
	readonly reversedBuffers: WeakMap<AudioBuffer, AudioBuffer>;
	readonly activeSources: Set<AudioScheduledSourceNode>;
	readonly allNodes: AudioNodeArray;
}

function scheduleBufferPlan({
	plan,
	context,
	contextStartTime,
	fromFrame,
	sampleRate,
	transportRate,
	reversedBuffers,
	activeSources,
	allNodes,
}: BufferPlanOptions): void {
	if (!plan.originalBuffer) return;
	const transientNodes = getTransientNodes(allNodes);
	const source = addNode(transientNodes, context.createBufferSource());
	const chain = createClipGainChain(context, plan.trackInput, transientNodes);
	const scheduledNodes = [source, chain.fadeInGain, chain.fadeOutGain, chain.clipGain];
	const buffer = plan.reversed
		? getReversedBuffer(context, plan.originalBuffer, reversedBuffers)
		: plan.originalBuffer;
	source.buffer = buffer;
	connect(source, chain.input);
	const timelineRate = sampleRate * transportRate;
	const startTime = contextStartTime + (plan.segmentStart - fromFrame) / timelineRate;
	setParam(source.playbackRate, plan.playbackRate * transportRate, startTime);
	scheduleClipGain(
		chain.fadeInGain.gain,
		chain.fadeOutGain.gain,
		chain.clipGain.gain,
		plan.clip,
		plan.relativeStart,
		plan.segmentEnd - clipStart(plan.clip),
		plan.duration,
		startTime,
		timelineRate,
		plan,
	);
	try {
		source.start(startTime, plan.offsetFrame / buffer.sampleRate, plan.segmentDuration * plan.playbackRate);
		activeSources.add(source);
		source.onended = (): void => {
			activeSources.delete(source);
			releaseTransientNodes(transientNodes, scheduledNodes);
		};
	} catch {
		// A malformed or out-of-range clip is skipped without stopping the mix.
		releaseTransientNodes(transientNodes, scheduledNodes);
	}
}

interface LiveChunkPlanOptions {
	readonly plan: ClipSchedulePlan;
	readonly context: BaseAudioContext;
	readonly chunkStreamClient: ChunkStreamClientLike;
	readonly chunkAudioNodeFactory: ChunkAudioNodeFactory;
	readonly activeSources: Set<AudioScheduledSourceNode>;
	readonly allNodes: AudioNodeArray;
	readonly signal: AbortSignal | null;
	readonly transportRate: number;
	readonly onStreamUnderrun: ((details: ScheduledChunkStreamUnderrun) => void) | null;
	readonly streamQueuePackets: number | null;
	readonly streamPrebufferPackets: number | null;
}

interface PreparedLiveChunkPlan {
	readonly done: Promise<unknown>;
	start(contextStartTime: number, fromFrame: number, sampleRate: number, transportRate: number): void;
}

async function prepareLiveChunkPlan({
	plan,
	context,
	chunkStreamClient,
	chunkAudioNodeFactory,
	activeSources,
	allNodes,
	signal,
	transportRate,
	onStreamUnderrun,
	streamQueuePackets,
	streamPrebufferPackets,
}: LiveChunkPlanOptions): Promise<PreparedLiveChunkPlan> {
	if (!plan.chunkSource) throw longSourceError('The long-source clip provider is unavailable.');
	const transientNodes = getTransientNodes(allNodes);
	const requestedInputFrames = plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate;
	const outputFrameCount = Math.round(plan.segmentDuration / transportRate * context.sampleRate);
	if (!Number.isFinite(plan.offsetFrame) || plan.offsetFrame < 0 || !Number.isFinite(requestedInputFrames)
		|| requestedInputFrames <= 0 || outputFrameCount <= 0) {
		throw longSourceError('The long-source clip range is invalid.');
	}
	const provider = plan.reversed ? createReversedChunkSource(plan.chunkSource) : plan.chunkSource;
	if (plan.offsetFrame >= provider.frameCount) throw longSourceError('The long-source clip range is empty.');
	const roundedStart = Math.round(plan.offsetFrame);
	const roundedInputFrames = Math.round(requestedInputFrames);
	const direct = Math.abs(roundedStart - plan.offsetFrame) <= 1e-9
		&& Math.abs(roundedInputFrames - requestedInputFrames) <= 1e-9
		&& roundedInputFrames === outputFrameCount;
	let streamRange: UnknownRecord;
	if (direct) {
		const endFrame = Math.min(provider.frameCount, roundedStart + roundedInputFrames);
		if (endFrame <= roundedStart) throw longSourceError('The long-source clip range is empty.');
		streamRange = { startFrame: roundedStart, endFrame };
	} else {
		const sourceStartFrame = Math.max(0, Math.floor(plan.offsetFrame) - STREAM_RESAMPLE_RADIUS);
		const sourceEndFrame = Math.min(
			provider.frameCount,
			Math.ceil(plan.offsetFrame + requestedInputFrames) + STREAM_RESAMPLE_RADIUS,
		);
		if (sourceEndFrame <= sourceStartFrame) throw longSourceError('The long-source clip range is empty.');
		streamRange = {
			sourceStartFrame,
			sourceEndFrame,
			outputFrameCount,
			resampleInputFrames: requestedInputFrames,
			resampleInputOffset: plan.offsetFrame - sourceStartFrame,
		};
	}
	let node: AudioWorkletNode | null = null;
	let chain: ClipGainChain | null = null;
	let handle: ChunkStreamHandle | null = null;
	let sourceControl: AudioScheduledSourceNode | null = null;
	try {
		throwIfAborted(signal);
		node = await chunkAudioNodeFactory(context, {
			channelCount: provider.channelCount,
			...(streamQueuePackets === null ? {} : { maxQueuePackets: streamQueuePackets }),
			...(streamPrebufferPackets === null ? {} : { prebufferPackets: streamPrebufferPackets }),
		});
		throwIfAborted(signal);
		addNode(transientNodes, node);
		chain = createClipGainChain(context, plan.trackInput, transientNodes);
		connect(node, chain.input);
		handle = chunkStreamClient.open({
			source: provider,
			...streamRange,
			outputPort: node.port,
			signal,
			...(streamQueuePackets === null ? {} : { highWaterMark: streamQueuePackets }),
			onUnderrun: onStreamUnderrun ? (details) => onStreamUnderrun({
				clipId: String(plan.clip.id),
				sourceId: String(plan.clip.sourceId),
				...details,
			}) : null,
		});
		void handle.ready.catch(() => undefined);
		void handle.primed.catch(() => undefined);
		void handle.done.catch(() => undefined);
		await handle.primed;
		throwIfAborted(signal);
		const activeHandle = handle;
		const activeNode = node;
		const activeChain = chain;
		sourceControl = {
			stop(): void { activeHandle.cancel(); },
			disconnect(): void { activeNode.disconnect(); },
		};
		activeSources.add(sourceControl);
		const scheduledNodes = [node, chain.fadeInGain, chain.fadeOutGain, chain.clipGain];
		const release = (): void => {
			if (sourceControl) activeSources.delete(sourceControl);
			releaseTransientNodes(transientNodes, scheduledNodes);
		};
		handle.done.then(release, release);
		return {
			done: activeHandle.done,
			start(contextStartTime, fromFrame, sampleRate, activeTransportRate): void {
				const timelineRate = sampleRate * activeTransportRate;
				const startTime = contextStartTime + (plan.segmentStart - fromFrame) / timelineRate;
				scheduleClipGain(
					activeChain.fadeInGain.gain,
					activeChain.fadeOutGain.gain,
					activeChain.clipGain.gain,
					plan.clip,
					plan.relativeStart,
					plan.segmentEnd - clipStart(plan.clip),
					plan.duration,
					startTime,
					timelineRate,
					plan,
				);
				void activeHandle.play({ contextStartFrame: Math.max(0, Math.round(startTime * context.sampleRate)) });
			},
		};
	} catch (error) {
		if (sourceControl) activeSources.delete(sourceControl);
		try { handle?.cancel(); } catch { /* The stream may already be cancelled. */ }
		releaseTransientNodes(transientNodes, [
			node,
			chain?.fadeInGain,
			chain?.fadeOutGain,
			chain?.clipGain,
		]);
		throw error;
	}
}

interface OfflineChunkPlanOptions {
	readonly plan: ClipSchedulePlan;
	readonly context: BaseAudioContext;
	readonly contextStartTime: number;
	readonly fromFrame: number;
	readonly sampleRate: number;
	readonly activeSources: Set<AudioScheduledSourceNode>;
	readonly allNodes: AudioNodeArray;
	readonly signal: AbortSignal | null;
	readonly onChunkLoaded?: (frames: number) => void;
}

async function scheduleOfflineChunkPlan({
	plan,
	context,
	contextStartTime,
	fromFrame,
	sampleRate,
	activeSources,
	allNodes,
	signal,
	onChunkLoaded,
}: OfflineChunkPlanOptions): Promise<void> {
	if (!plan.chunkSource) throw longSourceError('The long-source clip provider is unavailable.');
	const provider = plan.reversed ? createReversedChunkSource(plan.chunkSource) : plan.chunkSource;
	const sourceEndFrame = Math.min(
		provider.frameCount,
		plan.offsetFrame + plan.segmentDuration * plan.playbackRate * plan.sourceSampleRate,
	);
	const firstChunk = Math.floor(plan.offsetFrame / provider.chunkFrames);
	const lastChunk = Math.max(firstChunk, Math.ceil(sourceEndFrame / provider.chunkFrames) - 1);
	const chain = createClipGainChain(context, plan.trackInput, allNodes);
	const clipStartTime = contextStartTime + (plan.segmentStart - fromFrame) / sampleRate;
	scheduleClipGain(
		chain.fadeInGain.gain,
		chain.fadeOutGain.gain,
		chain.clipGain.gain,
		plan.clip,
		plan.relativeStart,
		plan.segmentEnd - clipStart(plan.clip),
		plan.duration,
		clipStartTime,
		sampleRate,
		plan,
	);
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
		throwIfAborted(signal);
		const value = await provider.readStorageChunk(chunkIndex, { signal });
		const channels = chunkChannels(value);
		const chunkStart = chunkIndex * provider.chunkFrames;
		const chunkFrames = channels[0]?.length || 0;
		const rangeStart = Math.max(plan.offsetFrame, chunkStart);
		const rangeEnd = Math.min(sourceEndFrame, chunkStart + chunkFrames);
		if (rangeEnd <= rangeStart) continue;
		const buffer = context.createBuffer(provider.channelCount, chunkFrames, provider.sampleRate);
		for (let channel = 0; channel < provider.channelCount; channel += 1) {
			const values = channels[channel];
			if (!values) throw new Error('A long-source storage chunk has missing channels.');
			if (typeof buffer.copyToChannel === 'function') {
				const copyValues = values.buffer instanceof ArrayBuffer
					? values as Float32Array<ArrayBuffer>
					: new Float32Array(values);
				buffer.copyToChannel(copyValues, channel);
			}
			else buffer.getChannelData(channel).set(values);
		}
		const source = addNode(allNodes, context.createBufferSource());
		source.buffer = buffer;
		connect(source, chain.input);
		const when = clipStartTime + (rangeStart - plan.offsetFrame) / (provider.sampleRate * plan.playbackRate);
		setParam(source.playbackRate, plan.playbackRate, when);
		try {
			source.start(
				when,
				(rangeStart - chunkStart) / provider.sampleRate,
				(rangeEnd - rangeStart) / provider.sampleRate,
			);
			activeSources.add(source);
		} catch {
			// Provider errors report corrupt chunks; Web Audio range errors skip only this segment.
		}
			onChunkLoaded?.(rangeEnd - rangeStart);
		}
	}
