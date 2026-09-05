/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectHasAuthoredAudioWarp, renderExactAudioWarpToSink } from './audio-warp-fallback.ts';
import {
	createAsyncPlanarPcmSinkQueue,
} from '../pcm-sink.js';
import {
	createAbortError,
	parametricEqProcessingError,
} from './async-utils.ts';
import {
	clamp,
	clampFrame,
	positiveInteger,
} from './buffer-math.ts';
import {
	AUDIO_EDITOR_RENDER_STREAM_PREBUFFER_PACKETS,
	AUDIO_EDITOR_RENDER_STREAM_QUEUE_PACKETS,
} from '../chunk-stream.js';
import { scaleSampleFrame } from '../timeline-time.ts';
import {
	scheduleProjectClips,
	type ScheduledChunkStreamUnderrun,
} from './clip-scheduler.ts';
import {
	ensureProjectWorklets,
	getParametricEqWasmModule,
} from './effect-worklets.ts';
import {
	buildProjectGraph,
	projectGraphLatencyFrames,
} from './project-graph.ts';
import type { ProjectGraph } from './project-graph.ts';
import {
	disposeGraph,
} from './transport-scheduler.ts';
import {
	createRealtimeContext,
	getAudioContextConstructor,
} from './lifecycle.ts';
import { planRealtimePcmSinkQueueAdmission } from '../pcm-sink-admission.ts';
import { validateRealtimeCaptureMessage } from './realtime-render-capture.ts';
import {
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
	ENGINE_GET_CHUNK_STREAM_CLIENT,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeMethodMap,
	EngineRuntimeHost,
} from './runtime-types.ts';
import {
	admitNativePluginRealtimeRender,
	prepareNativePluginOfflineRuntimes,
} from './native-plugin-realtime-render.ts';
import { realtimeRenderUnderrunError, resolveRenderTailSeconds } from './rendering-range.ts';
import { renderMix } from './rendering-offline-mix.ts';

export const engineRenderingMethods = {
	renderMix,

async renderMixRealtime(this: EngineRuntimeHost, {
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		includeTrackPan = true,
		respectMuteSolo = true,
		sampleRate = this.sampleRate,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
		chunkFrames = 4096,
		maximumPendingChunks = undefined,
		backpressureHighWaterChunks = undefined,
		onChunk,
		onProgress = null,
		signal,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		admitNativePluginRealtimeRender(this.project, { trackId, includeMaster });
		if (typeof onChunk !== 'function') throw new TypeError('Realtime rendering requires an onChunk callback.');
		if (signal?.aborted) throw createAbortError();
		if (projectHasAuthoredAudioWarp(this.project)
			&& this.getAudioWarpRenderStatus().path === 'exact-offline') {
			return renderExactAudioWarpToSink(this, {
				startFrame, endFrame, includeTail, trackId, includeMaster, includeTrackPan,
				respectMuteSolo, sampleRate, outputFrames: requestedOutputFrames, preRollFrames,
				chunkFrames, onChunk, onProgress, signal,
			});
		}
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupProjectFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveRenderTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const outputChannelCount = clamp(positiveInteger(this.project.masterChannels, 2), 1, 32);
		const sinkAdmission = planRealtimePcmSinkQueueAdmission({
			channelCount: outputChannelCount,
			chunkFrames,
			maximumPendingChunks,
			backpressureHighWaterChunks,
		});
		const Context = getAudioContextConstructor();
		if (!Context || typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		const context = createRealtimeContext(Context, positiveInteger(sampleRate, this.sampleRate));
		if (!context.audioWorklet?.addModule) {
			await context.close?.();
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		let parametricEqFailure = null;
		let failParametricEqRender: ((error: unknown) => void) | null = null;
		let streamUnderrunFailure: Error | null = null;
		let failStreamedRender: ((error: unknown) => void) | null = null;
		let waitForStreamedClips = async (): Promise<void> => undefined;
		let streamedClips = 0;
		let outputFrames = 0;
		let startTime = 0;
		let captureLeadFrames = 0;
		let capture = null;
		let silent = null;
		let graph: ProjectGraph | null = null;
		let nativeRuntimes: Awaited<ReturnType<typeof prepareNativePluginOfflineRuntimes>> | null = null;
		try {
			if (context.state === 'running') await context.suspend();
			await context.audioWorklet.addModule(new URL('../render-capture-worklet.js', import.meta.url));
			await ensureProjectWorklets(context, this.project);
			nativeRuntimes = await prepareNativePluginOfflineRuntimes(context, this.project, { trackId, includeMaster });
			outputFrames = requestedOutputFrames == null
				? Math.max(1, scaleSampleFrame(
						toFrame - fromFrame + tailFrames, this.sampleRate, context.sampleRate, 'point',
					))
				: positiveInteger(requestedOutputFrames, 1);
			captureLeadFrames = scaleSampleFrame(
				warmupProjectFrames, this.sampleRate, context.sampleRate, 'point',
			) + projectGraphLatencyFrames(this.project, {
				trackId,
				includeMaster,
				sampleRate: context.sampleRate,
				graph: this.projectGraphSelection ?? undefined,
			});
			capture = new globalThis.AudioWorkletNode(context, 'kw-audio-render-capture', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [outputChannelCount],
				channelCount: outputChannelCount,
				channelCountMode: 'explicit',
				channelInterpretation: 'speakers',
				processorOptions: {
					totalFrames: outputFrames,
					chunkFrames: sinkAdmission.chunkFrames,
					channelCount: outputChannelCount,
					maximumInFlightChunks: sinkAdmission.maximumPendingChunks,
				},
			});
			silent = context.createGain();
			silent.gain.value = 0;
			capture.connect(silent);
			silent.connect(context.destination);
			graph = buildProjectGraph(context, capture, this.project, {
				metering: false,
				respectMuteSolo,
				trackId,
				includeMaster,
				includeTrackPan,
				graph: this.projectGraphSelection ?? undefined,
				parametricEqWasmModule: getParametricEqWasmModule(context),
				onParametricEqError: (error) => {
					this[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error);
					parametricEqFailure ||= parametricEqProcessingError(error);
					graph?.abortController?.abort?.(parametricEqFailure);
					failParametricEqRender?.(parametricEqFailure);
				},
			});
			await nativeRuntimes.activate();
		} catch (error) {
			if (graph) disposeGraph(graph, true);
			try { capture?.disconnect(); } catch { /* The capture node may not have connected. */ }
			try { silent?.disconnect(); } catch { /* The silent node may not have connected. */ }
			if (context.state !== 'closed') await context.close?.();
			await nativeRuntimes?.dispose();
			throw parametricEqFailure || error;
		}
		const abortGraph = () => graph.abortController.abort();
		signal?.addEventListener('abort', abortGraph, { once: true });
		const onStreamUnderrun = (details: ScheduledChunkStreamUnderrun): void => {
			streamUnderrunFailure ||= realtimeRenderUnderrunError(details);
			graph.abortController.abort(streamUnderrunFailure);
			failStreamedRender?.(streamUnderrunFailure);
		};
		try {
			startTime = context.currentTime + 0.08;
			const scheduled = await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
				projectGainParams: graph.projectGainParams,
				parameterRegistry: graph.parameterRegistry,
				fromFrame: renderFromFrame,
				toFrame,
				contextStartTime: startTime,
				sampleRate: this.sampleRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: graph.sources,
				allNodes: graph.nodes,
				mode: 'live',
				chunkStreamClient: this[ENGINE_GET_CHUNK_STREAM_CLIENT](),
				chunkAudioNodeFactory: this.chunkAudioNodeFactory,
				signal: graph.abortController.signal,
				onStreamUnderrun,
				streamQueuePackets: AUDIO_EDITOR_RENDER_STREAM_QUEUE_PACKETS,
				streamPrebufferPackets: AUDIO_EDITOR_RENDER_STREAM_PREBUFFER_PACKETS,
				deferStartUntilPrimed: true,
			});
			startTime = scheduled.contextStartTime;
			capture.port.postMessage({
				type: 'start-capture',
				startFrame: Math.ceil(startTime * context.sampleRate) + captureLeadFrames,
			});
			waitForStreamedClips = scheduled.waitForStreamedClips;
			streamedClips = scheduled.streamedClips;
		} catch (error) {
			signal?.removeEventListener('abort', abortGraph);
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			if (context.state !== 'closed') await context.close?.();
			await nativeRuntimes?.dispose();
			throw streamUnderrunFailure || parametricEqFailure || error;
		}

		let renderedFrames = 0;
		let resolveDone!: () => void;
		let rejectDone!: (reason?: unknown) => void;
		const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
		// Cancellation can reject completion while a delayed AudioContext resume is
		// still pending. Observe it immediately; awaiting `done` below still reports
		// the original failure to the render caller.
		void done.catch(() => undefined);
		let doneReceived = false;
		let terminating = false;
		interface SinkQueue {
			readonly failure: unknown;
			readonly maximumPendingChunks: number;
			readonly pendingChunks: number;
			readonly state: string;
			readonly writtenFrames: number;
			readonly writtenChunks: number;
			enqueue(channels: readonly Float32Array[], metadata: Readonly<Record<string, unknown>>): boolean;
			finish(): Promise<unknown>;
			abort(error: unknown): boolean;
			settled(): Promise<void>;
		}
		let sinkQueue: SinkQueue | null = null;
		const failRender = (error: unknown) => {
			const failure = error instanceof Error ? error : new Error('The realtime render failed.');
			sinkQueue?.abort(failure);
			graph.abortController.abort(failure);
			rejectDone(failure);
		};
		failParametricEqRender = failRender;
		failStreamedRender = failRender;
		if (parametricEqFailure) failRender(parametricEqFailure);
		if (streamUnderrunFailure) failRender(streamUnderrunFailure);
		sinkQueue = createAsyncPlanarPcmSinkQueue(onChunk, {
			maximumPendingChunks: sinkAdmission.maximumPendingChunks,
			maximumPendingFrames: sinkAdmission.maximumPendingFrames,
			maximumPendingBytes: sinkAdmission.maximumPendingBytes,
			onWriteSettled: () => {
				if (!terminating && !graph.abortController.signal.aborted) {
					capture.port.postMessage({ type: 'release-chunk' });
				}
			},
			onError: failRender,
		}) as SinkQueue;
		const queue = sinkQueue;
		const sinkBackpressureHighWaterChunks = sinkAdmission.backpressureHighWaterChunks;
		let flowControl: Promise<void> | null = null;
		const requestSinkDrain = () => {
			if (
				terminating
				|| flowControl
				|| doneReceived
				|| queue.failure
				|| graph.abortController.signal.aborted
				|| queue.pendingChunks < sinkBackpressureHighWaterChunks
			) return;
			const cycle = (async () => {
				let suspendedForBackpressure = false;
				if (context.state === 'running') {
					await context.suspend();
					suspendedForBackpressure = true;
				}
				await queue.settled();
				if (
					terminating
					|| doneReceived
					|| queue.failure
					|| graph.abortController.signal.aborted
				) return;
				if (suspendedForBackpressure && context.state === 'suspended') await context.resume();
			})();
			flowControl = cycle.catch((error: unknown) => {
				if (
					!terminating
					&& !doneReceived
					&& !queue.failure
					&& !graph.abortController.signal.aborted
				) failRender(error);
			}).finally(() => {
				flowControl = null;
				requestSinkDrain();
			});
		};
		const finishCapture = async (): Promise<void> => {
			await queue.finish();
			await flowControl;
			if (
				streamedClips > 0
				&& context.state === 'suspended'
				&& !queue.failure
				&& !graph.abortController.signal.aborted
			) await context.resume();
			await waitForStreamedClips();
		};
		const abort = () => failRender(createAbortError());
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort();
		capture.onprocessorerror = () => failRender(new Error('The realtime render worklet failed.'));
		capture.port.onmessage = ({ data = {} }) => {
			if (doneReceived || queue.failure) return;
			try {
				const message = validateRealtimeCaptureMessage(data, {
					channelCount: outputChannelCount,
					chunkFrames: sinkAdmission.chunkFrames,
					outputFrames,
					renderedFrames,
				});
				if (!message) return;
				if (message.type === 'done') {
					doneReceived = true;
					void finishCapture().then(() => resolveDone(), rejectDone);
					return;
				}
				const accepted = queue.enqueue(message.channels, {
					frameOffset: message.frameOffset,
					sampleRate: context.sampleRate,
				});
				if (!accepted) return;
				renderedFrames += message.frames;
				requestSinkDrain();
				onProgress?.({
					frames: renderedFrames,
					totalFrames: outputFrames,
					progress: Math.min(1, renderedFrames / outputFrames),
				});
			} catch (error) {
				failRender(error);
			}
		};

		let renderFailed = false;
		let renderFailure: unknown;
		try {
			capture.port.start?.();
			if (!graph.abortController.signal.aborted) await context.resume();
			await done;
			return {
				sampleRate: context.sampleRate,
				channelCount: outputChannelCount,
				frameCount: queue.writtenFrames,
				chunkCount: queue.writtenChunks,
			};
		} catch (error) {
			renderFailed = true;
			renderFailure = error;
			throw error;
		} finally {
			terminating = true;
			failStreamedRender = null;
			const pendingFlowControl = flowControl;
			signal?.removeEventListener('abort', abort);
			signal?.removeEventListener('abort', abortGraph);
			capture.port.onmessage = null;
			capture.onprocessorerror = null;
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			let closeFailed = false;
			let closeFailure: unknown;
			try {
				if (context.state !== 'closed') await context.close?.();
			} catch (error) {
				closeFailed = true;
				closeFailure = error;
			}
			await nativeRuntimes?.dispose();
			if (queue.state !== 'finished') {
				queue.abort(renderFailed ? renderFailure : closeFailed ? closeFailure : createAbortError());
			}
			try { await queue.settled(); } catch { /* The primary render error is reported above. */ }
			try { await pendingFlowControl; } catch { /* Flow control never replaces the primary render result. */ }
			if (!renderFailed && closeFailed) throw closeFailure;
		}
	},

renderMixToSink({ sink, ...options } = {}) {
		if (typeof sink !== 'function' && typeof sink?.write !== 'function') {
			return Promise.reject(new TypeError('A planar PCM sink function or object with write() is required.'));
		}
		const write = typeof sink === 'function' ? sink : sink.write.bind(sink);
		return this.renderMixRealtime({ ...options, onChunk: write });
	},

renderTrack(trackId, options = {}) {
		if (!this.project?.tracks?.some((track) => track.id === trackId)) {
			return Promise.reject(new Error('The requested track could not be found.'));
		}
		return this.renderMix({
			...options,
			trackId,
			includeMaster: false,
			respectMuteSolo: false,
		});
	},

renderTrackToSink(trackId, options = {}) {
		if (!this.project?.tracks?.some((track) => track.id === trackId)) {
			return Promise.reject(new Error('The requested track could not be found.'));
		}
		return this.renderMixToSink({
			...options,
			trackId,
			includeMaster: false,
			respectMuteSolo: false,
		});
	}
} satisfies EngineRuntimeMethodMap<
	| 'renderMix'
	| 'renderMixRealtime'
	| 'renderMixToSink'
	| 'renderTrack'
	| 'renderTrackToSink'
>;
