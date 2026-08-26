/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The one composition that makes a proxy candidate out of the shipped runtime.
 *
 * `createVideoProxyCandidateObserver` asks for a generator, a recipe, and the
 * timing probes to read the result with, and until now every one of those was
 * supplied only by a test fixture. This binds all three to what the editor
 * actually ships: the FFmpeg proxy generator, the single maintained recipe, and
 * the same timing probes ingest uses — the desktop helper first where a build
 * has one, then the WebAssembly probe, then the container demuxer.
 *
 * Probe order matters and is deliberately the ingest order. A proxy's boundaries
 * are compared against an original whose own timing was probed at import, so
 * reading the two with different backends is how a pair that agrees in fact
 * comes to disagree on paper.
 */

import type {
	VideoProxyCandidateGeneratorPort,
	VideoProxyCandidateObserver,
} from '../video-proxy-candidate-observation.ts';
import { canonicalMediaContentBlob } from '../storage/media-content-digest.ts';
import { createVideoProxyCandidateObserver } from '../video-proxy-candidate-observation.ts';
import { createFfmpegVideoProxyGenerator } from '../video-proxy-ffmpeg-generator.ts';
import { createContainerVideoTimingProbe } from '../video-timing-demux.ts';
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

const EXISTING_PROXY_GENERATOR = Object.freeze({
	id: 'framescaper-pathless-existing-proxy',
	version: 1,
});
const EXISTING_PROXY_RECIPE = Object.freeze({
	id: 'framescaper-existing-video-proxy-v1',
	version: 1,
});

/**
 * Build the candidate observer, or answer null when this build cannot generate.
 *
 * A runtime without the FFmpeg operation runner cannot encode a proxy at all, so
 * the honest answer is that generation is unavailable here rather than an
 * observer that fails at the moment a user asks for a proxy. Proving that a
 * proxy conforms is never the missing half: the container demuxer reads the
 * timing of the body the generator just wrote without any decoder.
 */
export function createVideoProxyCandidateObserverForRuntime(
	runtime: VideoProxyCandidateRuntime | null | undefined,
	options: VideoProxyCandidateCompositionOptions = {},
): VideoProxyCandidateObserver | null {
	if (typeof runtime?.runProxyMediaOperation !== 'function') return null;
	const runProxyMediaOperation = runtime.runProxyMediaOperation.bind(runtime);
	const probes = timingProbes(runtime, options);
	return createVideoProxyCandidateObserver({
		generator: createFfmpegVideoProxyGenerator({ runOperation: runProxyMediaOperation }),
		recipe: VIDEO_PROXY_GENERATION_RECIPE,
		probes,
		...(options.maximumBytes === undefined ? {} : { maximumBytes: options.maximumBytes }),
	});
}

/**
 * Observe one operator-selected proxy Blob without retaining its File name or
 * any desktop descriptor. Exact timing conformance and durable publication are
 * still owned by the same relationship/scheduler authority as generated work.
 */
export function createVideoProxyExistingCandidateObserverForRuntime(
	candidateValue: unknown,
	runtime: VideoProxyCandidateRuntime | null | undefined,
	options: VideoProxyCandidateCompositionOptions = {},
): VideoProxyCandidateObserver | null {
	const candidate = canonicalMediaContentBlob(candidateValue);
	if (candidate.size < 1) throw new RangeError('An existing video proxy cannot be empty.');
	if (!/^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u.test(candidate.type)) {
		throw new TypeError('An existing video proxy requires a canonical video MIME type.');
	}
	const probes = timingProbes(runtime ?? {}, options);
	const generator: VideoProxyCandidateGeneratorPort = Object.freeze({
		...EXISTING_PROXY_GENERATOR,
		generate(
			_original: Parameters<VideoProxyCandidateGeneratorPort['generate']>[0],
			_identity: Parameters<VideoProxyCandidateGeneratorPort['generate']>[1],
			_recipe: Parameters<VideoProxyCandidateGeneratorPort['generate']>[2],
			generation: Parameters<VideoProxyCandidateGeneratorPort['generate']>[3],
		): Blob {
			throwIfAborted(generation.signal);
			generation.assertCurrent();
			return candidate;
		},
	});
	return createVideoProxyCandidateObserver({
		generator,
		recipe: EXISTING_PROXY_RECIPE,
		probes,
		...(options.maximumBytes === undefined ? {} : { maximumBytes: options.maximumBytes }),
	});
}

function timingProbes(
	runtime: VideoProxyCandidateRuntime,
	options: VideoProxyCandidateCompositionOptions,
): readonly VideoTimingProbePort[] {
	return [
		options.helperTimingProbe ?? null,
		createFfmpegVideoTimingProbe(runtime),
		createContainerVideoTimingProbe(),
	].filter((probe): probe is VideoTimingProbePort => Boolean(probe));
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw signal.reason ?? new DOMException('Existing video proxy validation was cancelled.', 'AbortError');
	}
}
