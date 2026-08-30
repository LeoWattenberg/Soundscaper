/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlanarPcm } from './buffer-math.ts';
import type { EngineRealtimeRenderOptions } from './public-api.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';
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
	if (!nativePluginOfflineInstanceIds(host.project, options).length) return null;
	admitNativePluginRealtimeRender(host.project, options);
	const chunks: Float32Array[][] = [];
	let frameCount = 0;
	let chunkCount = 0;
	let channelCount: number | null = null;
	let sampleRate: number | null = null;
	const capture = await host.renderMixRealtime({
		...options,
		onChunk: (channels, metadata) => {
			const frames = channels[0]?.length ?? 0;
			const chunkSampleRate = Number(metadata.sampleRate);
			if (!frames || channels.some((channel) => !(channel instanceof Float32Array)
				|| channel.length !== frames)
				|| (channelCount !== null && channels.length !== channelCount)
				|| (metadata.frameOffset ?? frameCount) !== frameCount
				|| (metadata.frames !== undefined && metadata.frames !== frames)
				|| !Number.isSafeInteger(chunkSampleRate) || chunkSampleRate < 1
				|| (sampleRate !== null && chunkSampleRate !== sampleRate)) {
				throw new Error('Native plug-in realtime render returned non-contiguous PCM.');
			}
			channelCount ??= channels.length;
			sampleRate ??= chunkSampleRate;
			while (chunks.length < channels.length) chunks.push([]);
			for (let channel = 0; channel < channels.length; channel += 1) {
				chunks[channel].push(Float32Array.from(channels[channel]));
			}
			frameCount += frames;
			chunkCount += 1;
		},
	});
	if (capture.sampleRate !== sampleRate || capture.channelCount !== channelCount
		|| capture.frameCount !== frameCount || capture.chunkCount !== chunkCount) {
		throw new Error('Native plug-in realtime render result does not match its captured PCM.');
	}
	const channels = Object.freeze(chunks.map((parts) => {
		const output = new Float32Array(frameCount);
		let offset = 0;
		for (const part of parts) { output.set(part, offset); offset += part.length; }
		return output;
	}));
	return Object.freeze({
		channels,
		length: frameCount,
		numberOfChannels: channels.length,
		sampleRate: capture.sampleRate,
		getChannelData(channel: number): Float32Array {
			const output = channels[channel];
			if (!output) throw new RangeError(`The native plug-in render has no channel ${String(channel)}.`);
			return output;
		},
	});
}
