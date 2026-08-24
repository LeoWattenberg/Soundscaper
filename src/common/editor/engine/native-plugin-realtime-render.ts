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
	await host.renderMixRealtime({
		...options,
		onChunk: (channels, metadata) => {
			const frames = channels[0]?.length ?? 0;
			if (!frames || channels.some((channel) => channel.length !== frames)
				|| (metadata.frameOffset ?? frameCount) !== frameCount) {
				throw new Error('Native plug-in realtime render returned non-contiguous PCM.');
			}
			while (chunks.length < channels.length) chunks.push([]);
			for (let channel = 0; channel < channels.length; channel += 1) {
				chunks[channel].push(Float32Array.from(channels[channel]));
			}
			frameCount += frames;
		},
	});
	return Object.freeze({
		channels: Object.freeze(chunks.map((parts) => {
			const output = new Float32Array(frameCount);
			let offset = 0;
			for (const part of parts) { output.set(part, offset); offset += part.length; }
			return output;
		})),
	});
}
