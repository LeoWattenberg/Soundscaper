/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one composition that makes a proxy candidate out of the shipped runtime.
 *
 * `createVideoProxyCandidateObserver` asks for a generator, a recipe, and the
 * timing probes to read the result with, and until now every one of those was
 * supplied only by a test fixture. This binds all three to what the editor
 * actually ships: the FFmpeg proxy generator, the single maintained recipe, and
 * the same timing probes ingest uses — the desktop helper first where a build
 * has one, then the WebAssembly probe.
 *
 * Probe order matters and is deliberately the ingest order. A proxy's boundaries
 * are compared against an original whose own timing was probed at import, so
 * reading the two with different backends is how a pair that agrees in fact
 * comes to disagree on paper.
 */

import type {
	VideoProxyCandidateObserver,
} from '../video-proxy-candidate-observation.ts';
import { createVideoProxyCandidateObserver } from '../video-proxy-candidate-observation.ts';
import { createFfmpegVideoProxyGenerator } from '../video-proxy-ffmpeg-generator.ts';
import { VIDEO_PROXY_GENERATION_RECIPE } from '../video-proxy-generation.ts';
import { createFfmpegVideoTimingProbe } from '../video-timing-probe.ts';
import type { VideoTimingProbePort } from '../video-timing-probe.ts';
import type { FfmpegMediaFileLease } from '../ffmpeg-media-file-operation.ts';

export interface VideoProxyCandidateRuntime {
	runProxyMediaOperation?<Output>(
		operation: (lease: FfmpegMediaFileLease) => Promise<Output>,
		settings?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Output>;
	probeVideoTiming?: VideoTimingProbePort['probe'];
}

export interface VideoProxyCandidateCompositionOptions {
	/** A native timing probe, where the running build has one. */
	readonly helperTimingProbe?: VideoTimingProbePort | null;
	/** Refuse a candidate larger than this, as the observer's own bound. */
	readonly maximumBytes?: number;
}

/**
 * Build the candidate observer, or answer null when this build cannot generate.
 *
 * A runtime without the FFmpeg operation runner cannot encode a proxy and a
 * runtime without any timing probe cannot prove one conforms; either way the
 * honest answer is that generation is unavailable here, rather than an observer
 * that fails at the moment a user asks for a proxy.
 */
export function createVideoProxyCandidateObserverForRuntime(
	runtime: VideoProxyCandidateRuntime | null | undefined,
	options: VideoProxyCandidateCompositionOptions = {},
): VideoProxyCandidateObserver | null {
	if (typeof runtime?.runProxyMediaOperation !== 'function') return null;
	const runProxyMediaOperation = runtime.runProxyMediaOperation.bind(runtime);
	const probes = [options.helperTimingProbe ?? null, createFfmpegVideoTimingProbe(runtime)]
		.filter((probe): probe is VideoTimingProbePort => Boolean(probe));
	if (!probes.length) return null;
	return createVideoProxyCandidateObserver({
		generator: createFfmpegVideoProxyGenerator({ runOperation: runProxyMediaOperation }),
		recipe: VIDEO_PROXY_GENERATION_RECIPE,
		probes,
		...(options.maximumBytes === undefined ? {} : { maximumBytes: options.maximumBytes }),
	});
}
