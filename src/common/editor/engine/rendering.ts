/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	projectEffectTailFrames,
} from '../effects.js';
import {
	createAsyncPlanarPcmSinkQueue,
} from '../pcm-sink.js';
import {
	abortable,
	createAbortError,
	parametricEqProcessingError,
	throwIfAborted,
} from './async-utils.ts';
import {
	clamp,
	clampFrame,
	DEFAULT_SAMPLE_RATE,
	MAX_EFFECT_TAIL_SECONDS,
	positiveInteger,
	sliceAudioBuffer,
} from './buffer-math.ts';
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
	createOfflineContext,
	createRealtimeContext,
	getAudioContextConstructor,
} from './lifecycle.ts';
import {
	assertOfflineRenderOutputBufferGeometry,
	assertOfflineRenderOutputContextGeometry,
	planOfflineRenderOutputAdmission,
} from './offline-render-admission.ts';
import {
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
	ENGINE_GET_CHUNK_STREAM_CLIENT,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeMethodMap,
	EngineRuntimeHost,
} from './runtime-types.ts';
import type { EngineProject } from './types.ts';

const typedProjectEffectTailFrames = projectEffectTailFrames as (
	project: EngineProject,
	options?: Readonly<{
		trackId?: unknown;
		includeMaster?: boolean;
		maximumSeconds?: number;
	}>,
) => number;

function resolveTailSeconds(
	project: EngineProject,
	includeTail: boolean | number,
	{ trackId = null, includeMaster = true }: Readonly<{
		trackId?: unknown;
		includeMaster?: boolean;
	}> = {},
): number {
	if (!includeTail) return 0;
	if (typeof includeTail === 'number' && Number.isFinite(includeTail)) {
		return clamp(includeTail, 0, MAX_EFFECT_TAIL_SECONDS);
	}
	const sampleRate = project?.sampleRate || DEFAULT_SAMPLE_RATE;
	return typedProjectEffectTailFrames(project, {
		trackId: trackId == null ? null : String(trackId),
		includeMaster,
		maximumSeconds: MAX_EFFECT_TAIL_SECONDS,
	}) / sampleRate;
}

function realtimeRenderUnderrunError(details: ScheduledChunkStreamUnderrun): Error {
	const error = Object.assign(new Error('A streamed source underrun made the realtime render incomplete.'), {
		code: 'REALTIME_RENDER_UNDERRUN',
		details: Object.freeze({ ...details }),
	});
	error.name = 'RealtimeRenderUnderrunError';
	return error;
}

export const engineRenderingMethods = {
async renderMix(this: EngineRuntimeHost, {
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		includeTrackPan = true,
		respectMuteSolo = true,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
		signal = null,
		onProgress = null,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		throwIfAborted(signal);
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const processingLatencyFrames = projectGraphLatencyFrames(this.project, {
			trackId,
			includeMaster,
			sampleRate: this.sampleRate,
		});
		const requestedLength = requestedOutputFrames == null
			? Math.max(1, toFrame - fromFrame + tailFrames)
			: positiveInteger(requestedOutputFrames, 1);
		const captureOffset = warmupFrames + processingLatencyFrames;
		const outputLength = captureOffset + requestedLength;
		const outputChannelCount = clamp(positiveInteger(this.project.masterChannels, 2), 1, 32);

		if (!this.offlineAudioContextFactory) {
			if (typeof this.softwareRenderer === 'function') {
				return this.softwareRenderer({
					project: this.project,
					sources: this.sources,
					sourceResolver: this.sourceResolver,
					startFrame: renderFromFrame,
					endFrame: toFrame,
					captureStartFrame: fromFrame,
					tailFrames,
					sampleRate: this.sampleRate,
					trackId,
					includeMaster,
					includeTrackPan,
					respectMuteSolo,
				});
			}
			throw new Error('OfflineAudioContext is not available in this browser.');
		}

		const admission = planOfflineRenderOutputAdmission({
			channelCount: outputChannelCount,
			sampleRate: this.sampleRate,
			contextFrames: outputLength,
			captureOffsetFrames: captureOffset,
			requestedFrames: requestedLength,
		});
		const context = createOfflineContext(
			this.offlineAudioContextFactory,
			admission.channelCount,
			admission.contextFrames,
			admission.sampleRate,
		);
		assertOfflineRenderOutputContextGeometry(context, admission);
		let parametricEqFailure = null;
		let graph = null;
		try {
			await ensureProjectWorklets(context, this.project);
			graph = buildProjectGraph(context, context.destination, this.project, {
				metering: false,
				respectMuteSolo,
				trackId,
				includeMaster,
				includeTrackPan,
				parametricEqWasmModule: getParametricEqWasmModule(context),
				onParametricEqError: (error) => {
					this[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error);
					parametricEqFailure ||= parametricEqProcessingError(error);
				},
			});
			await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
				projectGainParams: graph.projectGainParams,
				fromFrame: renderFromFrame,
				toFrame,
				contextStartTime: 0,
				sampleRate: this.sampleRate,
				reversedBuffers: this.reversedBuffers,
				sourceResolver: this.sourceResolver,
				chunkSources: this.chunkSources,
				activeSources: graph.sources,
				allNodes: graph.nodes,
				mode: 'offline',
				signal,
				onProgress,
			});
			throwIfAborted(signal);
			const rendered = await abortable(context.startRendering(), signal);
			assertOfflineRenderOutputBufferGeometry(rendered, admission);
			// OfflineAudioWorklet failures are delivered as queued events in some
			// engines after the render promise settles.
			await new Promise((resolve) => setTimeout(resolve, 0));
			throwIfAborted(signal);
			if (parametricEqFailure) throw parametricEqFailure;
			return admission.captureOffsetFrames
				? sliceAudioBuffer(
					context,
					rendered,
					admission.captureOffsetFrames,
					admission.requestedFrames,
				)
				: rendered;
		} finally {
			if (graph) disposeGraph(graph, false);
		}
	},

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
		if (typeof onChunk !== 'function') throw new TypeError('Realtime rendering requires an onChunk callback.');
		if (signal?.aborted) throw createAbortError();
		const Context = getAudioContextConstructor();
		if (!Context || typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupProjectFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const outputChannelCount = clamp(positiveInteger(this.project.masterChannels, 2), 1, 32);
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
		let capture = null;
		let silent = null;
		let graph: ProjectGraph | null = null;
		try {
			await context.audioWorklet.addModule(new URL('../render-capture-worklet.js', import.meta.url));
			await ensureProjectWorklets(context, this.project);
			outputFrames = requestedOutputFrames == null
				? Math.max(1, Math.round((toFrame - fromFrame + tailFrames) / this.sampleRate * context.sampleRate))
				: positiveInteger(requestedOutputFrames, 1);
			startTime = context.currentTime + 0.08;
			const warmupContextFrames = Math.round(warmupProjectFrames / this.sampleRate * context.sampleRate);
			const processingLatencyFrames = projectGraphLatencyFrames(this.project, {
				trackId,
				includeMaster,
				sampleRate: context.sampleRate,
			});
			capture = new globalThis.AudioWorkletNode(context, 'kw-audio-render-capture', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [outputChannelCount],
				processorOptions: {
					startFrame: Math.ceil(startTime * context.sampleRate) + warmupContextFrames + processingLatencyFrames,
					totalFrames: outputFrames,
					chunkFrames: Math.max(128, Math.min(16_384, Math.floor(chunkFrames))),
					channelCount: outputChannelCount,
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
				parametricEqWasmModule: getParametricEqWasmModule(context),
				onParametricEqError: (error) => {
					this[ENGINE_EMIT_PARAMETRIC_EQ_ERROR](error);
					parametricEqFailure ||= parametricEqProcessingError(error);
					graph?.abortController?.abort?.(parametricEqFailure);
					failParametricEqRender?.(parametricEqFailure);
				},
			});
		} catch (error) {
			if (graph) disposeGraph(graph, true);
			try { capture?.disconnect(); } catch { /* The capture node may not have connected. */ }
			try { silent?.disconnect(); } catch { /* The silent node may not have connected. */ }
			if (context.state !== 'closed') await context.close?.();
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
			const scheduled = await scheduleProjectClips({
				context,
				project: this.project,
				sources: this.sources,
				trackInputs: graph.trackInputs,
				trackGainParams: graph.trackGainParams,
				projectGainParams: graph.projectGainParams,
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
			});
			waitForStreamedClips = scheduled.waitForStreamedClips;
			streamedClips = scheduled.streamedClips;
		} catch (error) {
			signal?.removeEventListener('abort', abortGraph);
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			if (context.state !== 'closed') await context.close?.();
			throw streamUnderrunFailure || parametricEqFailure || error;
		}

		let renderedFrames = 0;
		let resolveDone!: () => void;
		let rejectDone!: (reason?: unknown) => void;
		const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
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
		sinkQueue = createAsyncPlanarPcmSinkQueue(onChunk, { maximumPendingChunks, onError: failRender }) as SinkQueue;
		const queue = sinkQueue;
		// The default leaves half the hard queue bound for packets already posted
		// while suspension crosses threads. Direct encoders request an earlier
		// soft threshold without shrinking that hard crossover reserve.
		const sinkBackpressureHighWaterChunks = clamp(
			positiveInteger(
				backpressureHighWaterChunks,
				Math.max(1, Math.floor(queue.maximumPendingChunks / 2)),
			),
			1,
			queue.maximumPendingChunks,
		);
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
			const message = data && typeof data === 'object'
				? data as Readonly<Record<string, unknown>>
				: {};
			if (doneReceived || queue.failure) return;
			if (message.type === 'audio-chunk') {
				const channelValues = Array.isArray(message.channels) ? message.channels : [];
				const channels = channelValues.map((channel: unknown) => (
					channel instanceof Float32Array
						? channel
						: new Float32Array(channel as ArrayLike<number>)
				));
				const frames = channels[0]?.length || 0;
				const accepted = queue.enqueue(channels, {
					frameOffset: message.frameOffset,
					sampleRate: context.sampleRate,
				});
				if (!accepted) return;
				renderedFrames += frames;
				requestSinkDrain();
				try {
					onProgress?.({
						frames: renderedFrames,
						totalFrames: outputFrames,
						progress: Math.min(1, renderedFrames / outputFrames),
					});
				} catch (error) {
					failRender(error);
				}
			} else if (message.type === 'done') {
				doneReceived = true;
				void finishCapture().then(() => resolveDone(), rejectDone);
			}
		};
		capture.port.start?.();

		let renderFailed = false;
		let renderFailure: unknown;
		try {
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
