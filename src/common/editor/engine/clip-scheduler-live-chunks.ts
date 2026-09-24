/* SPDX-License-Identifier: AGPL-3.0-only */

import { addNode, connect, getTransientNodes, releaseTransientNodes, type AudioNodeArray } from './audio-node-utils.ts';
import { longSourceError, throwIfAborted } from './async-utils.ts';
import { createClipGainChain, createReversedChunkSource, type ClipGainChain } from './clip-scheduler-chunk-sources.ts';
import { clipStart } from './buffer-math.ts';
import { scheduleClipGain } from './clip-gain.ts';
import type { ClipSchedulePlan } from './clip-schedule-plan.ts';
import type { AudioScheduledSourceNode } from './project-graph.ts';
import type { UnknownRecord } from './types.ts';
import type { ChunkAudioNodeFactory, ChunkStreamClientLike, ChunkStreamHandle, ScheduledChunkStreamUnderrun } from './clip-scheduler.ts';

const STREAM_RESAMPLE_RADIUS = 24;
export const LIVE_STREAM_PREPARE_AHEAD_SECONDS = 5;
export const MAX_LIVE_STREAM_PREPARATIONS = 8;

export async function prepareLiveChunkPlans(
	plans: readonly ClipSchedulePlan[],
	prepare: (plan: ClipSchedulePlan) => Promise<PreparedLiveChunkPlan>,
	signal: AbortSignal | null,
): Promise<PreparedLiveChunkPlan[]> {
	const prepared = new Array<PreparedLiveChunkPlan>(plans.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < plans.length) {
			throwIfAborted(signal);
			const index = next++;
			const plan = plans[index];
			if (plan) prepared[index] = await prepare(plan);
		}
	};
	await Promise.all(Array.from({ length: Math.min(plans.length, MAX_LIVE_STREAM_PREPARATIONS) }, worker));
	return prepared;
}

export interface LiveChunkWindowOptions {
	readonly plans: readonly ClipSchedulePlan[];
	readonly context: BaseAudioContext;
	readonly contextStartTime: number;
	readonly fromFrame: number;
	readonly sampleRate: number;
	readonly transportRate: number;
	readonly signal: AbortSignal | null;
	readonly prepare: (plan: ClipSchedulePlan) => Promise<PreparedLiveChunkPlan>;
}

/** Prepare each later clip shortly before it reaches the playhead. */
export function startLiveChunkWindow({
	plans, context, contextStartTime, fromFrame, sampleRate, transportRate, signal, prepare,
}: LiveChunkWindowOptions): Promise<void> {
	if (!plans.length) return Promise.resolve();
	const upcoming = [...plans].sort((left, right) => left.segmentStart - right.segmentStart);
	let next = 0;
	let completed = 0;
	let preparing = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let settled = false;
	const active = new Set<PreparedLiveChunkPlan>();
	let resolveDone!: () => void;
	let rejectDone!: (error: unknown) => void;
	const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
	const cleanup = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		signal?.removeEventListener('abort', onAbort);
	};
	const fail = (error: unknown): void => {
		if (settled) return;
		settled = true;
		cleanup();
		for (const prepared of active) {
			try { prepared.cancel(); } catch { /* Preserve the source failure. */ }
		}
		active.clear();
		rejectDone(error);
	};
	const onAbort = (): void => fail(signal?.reason ?? new DOMException('Audio scheduling was aborted.', 'AbortError'));
	const finishOne = (failed: boolean, error?: unknown): void => {
		if (settled) return;
		if (failed) { fail(error); return; }
		completed += 1;
		if (completed !== upcoming.length) return;
		settled = true;
		cleanup();
		resolveDone();
	};
	const pump = (): void => {
		if (settled) return;
		if (signal?.aborted) { onAbort(); return; }
		if (timer !== null) clearTimeout(timer);
		timer = null;
		while (next < upcoming.length && preparing < MAX_LIVE_STREAM_PREPARATIONS) {
			const plan = upcoming[next];
			if (!plan) break;
			const startTime = contextStartTime + (plan.segmentStart - fromFrame) / (sampleRate * transportRate);
			const prepareTime = startTime - LIVE_STREAM_PREPARE_AHEAD_SECONDS;
			if (prepareTime > context.currentTime) {
				const waitMs = (prepareTime - context.currentTime) * 1_000;
				timer = setTimeout(pump, Math.max(20, Math.min(60_000, waitMs)));
				return;
			}
			next += 1;
			preparing += 1;
			void Promise.resolve().then(() => prepare(plan)).then((prepared) => {
				preparing -= 1;
				if (settled || signal?.aborted) {
					try { prepared.cancel(); } catch { /* The window has already failed. */ }
					return;
				}
				try {
					prepared.start(contextStartTime, fromFrame, sampleRate, transportRate);
					active.add(prepared);
					void prepared.done.then(() => {
						active.delete(prepared);
						finishOne(false);
					}, (error: unknown) => {
						active.delete(prepared);
						finishOne(true, error);
					});
				} catch (error) {
					try { prepared.cancel(); } catch { /* Preserve the scheduling failure. */ }
					finishOne(true, error);
				}
				pump();
			}, (error: unknown) => {
				preparing -= 1;
				finishOne(true, error);
				pump();
			});
		}
	};
	signal?.addEventListener('abort', onAbort, { once: true });
	pump();
	// Live transport does not await its final clip; keep rejection observed until
	// callers such as realtime rendering explicitly await the completion barrier.
	void done.catch(() => undefined);
	return done;
}

export interface LiveChunkPlanOptions {
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

export interface PreparedLiveChunkPlan {
	readonly done: Promise<unknown>;
	start(contextStartTime: number, fromFrame: number, sampleRate: number, transportRate: number): void;
	cancel(): void;
}

export async function prepareLiveChunkPlan({
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
			cancel(): void { activeHandle.cancel(); },
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
