/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	abortable,
	parametricEqProcessingError,
	throwIfAborted,
} from './async-utils.ts';
import {
	clamp,
	clampFrame,
	positiveInteger,
	sliceAudioBuffer,
} from './buffer-math.ts';
import {
	scheduleProjectClips,
} from './clip-scheduler.ts';
import {
	ensureProjectWorklets,
	getParametricEqWasmModule,
} from './effect-worklets.ts';
import {
	buildProjectGraph,
	projectGraphLatencyFrames,
} from './project-graph.ts';
import {
	disposeGraph,
} from './transport-scheduler.ts';
import {
	createOfflineContext,
} from './lifecycle.ts';
import {
	assertOfflineRenderOutputBufferGeometry,
	assertOfflineRenderOutputContextGeometry,
	planOfflineRenderOutputAdmission,
} from './offline-render-admission.ts';
import {
	ENGINE_EMIT_PARAMETRIC_EQ_ERROR,
} from './runtime-symbols.ts';
import type {
	EngineRuntimeHost,
} from './runtime-types.ts';
import {
	renderNativePluginRealtimePcmIfRequired,
} from './native-plugin-realtime-render.ts';
import { resolveRenderTailSeconds } from './rendering-range.ts';
import type { EngineRenderMixOptions } from './public-api.ts';

/**
 * Render a mix offline, as fast as the machine allows.
 *
 * Offline is the authoritative path: it renders into an OfflineAudioContext with no
 * deadline, so the result depends only on the graph and never on whether the machine kept
 * up. Its realtime sibling exists for the cases that must hear the render as it happens
 * and accepts an underrun as a failure; keeping the two apart is what stops a change made
 * for one silently altering the other.
 */
export async function renderMix(this: EngineRuntimeHost, {
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
	}: EngineRenderMixOptions = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		const native = await renderNativePluginRealtimePcmIfRequired(this, {
			startFrame, endFrame, includeTail, trackId, includeMaster, includeTrackPan,
			respectMuteSolo, outputFrames: requestedOutputFrames, preRollFrames, signal, onProgress,
		});
		if (native) return native;
		throwIfAborted(signal);
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveRenderTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
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
				parameterRegistry: graph.parameterRegistry,
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
	}
