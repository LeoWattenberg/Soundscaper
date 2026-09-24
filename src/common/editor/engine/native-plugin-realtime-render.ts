/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlanarPcm } from './buffer-math.ts';
import type { EngineRealtimeRenderOptions } from './public-api.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';
import { clamp, clampFrame, positiveInteger } from './buffer-math.ts';
import {
	MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	planOfflineRenderOutputAdmission,
} from './offline-render-admission.ts';
import { resolveRenderTailSeconds } from './rendering-range.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import {
	assertNativePluginOfflineRenderAdmission,
	nativePluginOfflineInstanceIds,
} from './native-plugin-offline-admission.ts';
import {
	nativePluginOfflineRuntimeProviderAvailable,
	prepareNativePluginOfflineRuntimes,
} from '../native-plugin-realtime-node.js';

export { prepareNativePluginOfflineRuntimes };

export function admitNativePluginRealtimeRender(
	project: unknown,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }>,
): void {
	assertNativePluginOfflineRenderAdmission(
		project, options, nativePluginOfflineRuntimeProviderAvailable(),
	);
}

export async function renderNativePluginRealtimePcmIfRequired(
	host: EngineRuntimeHost,
	options: EngineRealtimeRenderOptions,
): Promise<PlanarPcm | null> {
	const project = host.project;
	if (!nativePluginOfflineInstanceIds(project, options).length) return null;
	if (!project) throw new Error('Load an audio editor project before rendering.');
	admitNativePluginRealtimeRender(project, options);
	const fromFrame = clampFrame(options.startFrame ?? 0, 0, host.durationFrames);
	const toFrame = clampFrame(options.endFrame ?? host.durationFrames, fromFrame, host.durationFrames);
	const tailFrames = Math.round(resolveRenderTailSeconds(project, options.includeTail ?? false, {
		trackId: options.trackId, includeMaster: options.includeMaster,
	}) * host.sampleRate);
	const outputSampleRate = positiveInteger(options.sampleRate, host.sampleRate);
	const outputFrames = options.outputFrames == null
		? Math.max(1, scaleSampleFrame(
			toFrame - fromFrame + tailFrames, host.sampleRate, outputSampleRate, 'point',
		))
		: positiveInteger(options.outputFrames, 1);
	// Freeze copies the returned PCM once before staging. Admit both complete
	// bodies before starting the realtime graph; the sink queue is bounded too.
	const admission = planOfflineRenderOutputAdmission({
		channelCount: clamp(positiveInteger(project.masterChannels, 2), 1, 32),
		sampleRate: outputSampleRate,
		contextFrames: outputFrames,
		captureOffsetFrames: 0,
		requestedFrames: outputFrames,
	}, { maximumUsefulBinaryBytes: MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES / 2 });
	const channels = Object.freeze(Array.from({ length: admission.channelCount },
		() => new Float32Array(admission.requestedFrames)));
	let frameCount = 0;
	let chunkCount = 0;
	const capture = await host.renderMixRealtime({
		...options,
		onChunk: (chunk, metadata) => {
			const frames = chunk[0]?.length ?? 0;
			const chunkSampleRate = Number(metadata.sampleRate);
			if (!frames || chunk.length !== admission.channelCount
				|| chunk.some((channel) => !(channel instanceof Float32Array)
				|| channel.length !== frames)
				|| (metadata.frameOffset ?? frameCount) !== frameCount
				|| (metadata.frames !== undefined && metadata.frames !== frames)
				|| chunkSampleRate !== admission.sampleRate
				|| frames > admission.requestedFrames - frameCount) {
				throw new Error('Native plug-in realtime render returned non-contiguous PCM.');
			}
			for (let channel = 0; channel < chunk.length; channel += 1) {
				channels[channel].set(chunk[channel], frameCount);
			}
			frameCount += frames;
			chunkCount += 1;
		},
	});
	if (capture.sampleRate !== admission.sampleRate || capture.channelCount !== admission.channelCount
		|| capture.frameCount !== admission.requestedFrames || frameCount !== admission.requestedFrames
		|| capture.chunkCount !== chunkCount) {
		throw new Error('Native plug-in realtime render result does not match its captured PCM.');
	}
	return Object.freeze({
		channels,
		length: admission.requestedFrames,
		numberOfChannels: channels.length,
		sampleRate: admission.sampleRate,
		getChannelData(channel: number): Float32Array {
			const output = channels[channel];
			if (!output) throw new RangeError(`The native plug-in render has no channel ${String(channel)}.`);
			return output;
		},
	});
}
