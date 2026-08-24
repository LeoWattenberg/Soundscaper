/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The renderer-side port for the desktop native probe helper. Media is
 * addressed only by its opaque read-capability id; the returned timing
 * asset and characteristics are re-validated by the shared probe resolver
 * exactly as any other backend's output would be. When the helper surface
 * is disabled, quarantined, or fails, this port's rejection is recorded by
 * the resolver and the wasm probe takes over — visibly, never silently.
 */

import { desktopReadCapabilityIdFor } from './desktop-read-capability-registry.ts';
import type { VideoTimingProbePort } from './video-timing-probe.ts';
import { decodeVideoTimingAsset } from './video-timing-asset.ts';

interface DesktopHelperProbeBridge {
	beginVideoSourceProbe(request: Readonly<{ capabilityId: string }>): Promise<Readonly<{ probeId: string }>>;
	awaitVideoSourceProbe(request: Readonly<{ probeId: string }>): Promise<DesktopHelperProbeCompletion>;
	cancelVideoSourceProbe(request: Readonly<{ probeId: string }>): Promise<Readonly<{ cancelled: boolean }>>;
}

type DesktopHelperProbeCompletion =
	| Readonly<{
		status: 'probed';
		timingAsset: Uint8Array;
		nominalRate: Readonly<{ num: number; den: number }>;
		characteristics: unknown;
	}>
	| Readonly<{ status: 'failed'; code: string; message: string }>;

export interface DesktopHelperVideoTimingProbeOptions {
	readonly bridge: unknown;
	readonly capabilityIdFor?: (input: Blob) => string | null;
}

export function createDesktopHelperVideoTimingProbe(
	options: DesktopHelperVideoTimingProbeOptions,
): VideoTimingProbePort | null {
	const bridge = options.bridge as Partial<DesktopHelperProbeBridge> | null | undefined;
	if (typeof bridge?.beginVideoSourceProbe !== 'function'
		|| typeof bridge.awaitVideoSourceProbe !== 'function'
		|| typeof bridge.cancelVideoSourceProbe !== 'function') {
		return null;
	}
	const helperBridge = bridge as DesktopHelperProbeBridge;
	const capabilityIdFor = options.capabilityIdFor ?? desktopReadCapabilityIdFor;
	return Object.freeze({
		id: 'native-helper',
		probe: async (input: Blob, probeOptions: Readonly<{ signal?: AbortSignal }> = {}) => {
			const capabilityId = capabilityIdFor(input);
			if (!capabilityId) throw new Error('No desktop read capability backs this media.');
			probeOptions.signal?.throwIfAborted();
			const { probeId } = await helperBridge.beginVideoSourceProbe({ capabilityId });
			const signal = probeOptions.signal;
			const cancel = () => {
				void helperBridge.cancelVideoSourceProbe({ probeId }).catch(() => undefined);
			};
			// An abort that landed during the begin round-trip has already
			// dispatched its event, so the listener alone would leave the helper
			// job running to natural completion while the caller has moved on.
			if (signal?.aborted) {
				cancel();
				throw (signal.reason as Error | undefined)
					?? new DOMException('The native probe was cancelled.', 'AbortError');
			}
			signal?.addEventListener('abort', cancel, { once: true });
			try {
				const completion = await helperBridge.awaitVideoSourceProbe({ probeId });
				if (signal?.aborted) {
					throw (signal.reason as Error | undefined)
						?? new DOMException('The native probe was cancelled.', 'AbortError');
				}
				if (completion.status !== 'probed') {
					throw new Error(completion.message || 'The native probe helper failed.');
				}
				const index = decodeVideoTimingAsset(completion.timingAsset);
				return Object.freeze({
					timescale: index.timescale,
					presentationTicks: index.presentationTicks,
					finalFrameDurationTicks: index.finalFrameDurationTicks,
					nominalRate: completion.nominalRate,
					characteristics: completion.characteristics,
				});
			} finally {
				signal?.removeEventListener('abort', cancel);
			}
		},
	});
}
