/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The generator port that turns one original into one proxy body.
 *
 * `createVideoProxyCandidateObserver` has always taken a
 * `VideoProxyCandidateGeneratorPort` and nothing in the tree implemented one:
 * the observer knew how to hash, probe, and time a candidate, but no candidate
 * was ever produced. This is that port, and it is deliberately the thinnest
 * thing that can be: it lends the original to the FFmpeg runtime, runs the one
 * maintained recipe over it, and answers the bytes that came back.
 *
 * It builds no arguments of its own. `buildVideoProxyGenerationArgs` is the
 * single command that was measured against the pinned core, and a generator
 * assembling a second one would be an unmeasured recipe wearing a measured
 * recipe's name — which is also why a recipe this port does not recognise is
 * refused before FFmpeg is reached at all.
 *
 * The original's timescale is not pinned here. The port is handed a `Blob` and
 * an identity, never a timing view, so it cannot know one; a caller that holds
 * the original's timing may pass it to `buildVideoProxyGenerationArgs` directly.
 * What protects the promise either way is that the observer probes the body this
 * returns and conformance refuses a proxy whose boundaries drifted.
 */

import type { FfmpegMediaFileLease } from './ffmpeg-media-file-operation.ts';
import type {
	VideoProxyCandidateGeneratorPort,
	VideoProxyCandidateOriginalIdentity,
	VideoProxyCandidateRecipe,
} from './video-proxy-candidate-observation.ts';
import {
	buildVideoProxyGenerationArgs,
	VIDEO_PROXY_GENERATION_RECIPE,
} from './video-proxy-generation.ts';

const GENERATOR_ID = 'framescaper-video-proxy-ffmpeg-v1';
const GENERATOR_VERSION = 1;
/** Enough of the log to say why, without carrying a whole encode into an error. */
const REPORTED_LOG_LINES = 6;

export class VideoProxyGenerationError extends Error {
	readonly code = 'VIDEO_PROXY_GENERATION_FAILED';
	readonly exitCode: number;

	constructor(exitCode: number, logs: readonly string[]) {
		const reported = logs.slice(-REPORTED_LOG_LINES).join('\n');
		super(`Generating a video proxy failed with exit code ${String(exitCode)}.${
			reported ? `\n${reported}` : ''
		}`);
		this.name = 'VideoProxyGenerationError';
		this.exitCode = exitCode;
	}
}

export interface VideoProxyGeneratorDependencies {
	/** The same leased runtime the trim rewriter and timing probe are lent. */
	runOperation<Output>(
		operation: (lease: FfmpegMediaFileLease) => Promise<Output>,
		settings?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Output>;
}

/** One generator bound to one FFmpeg runtime, ready for the candidate observer. */
export function createFfmpegVideoProxyGenerator(
	dependencies: VideoProxyGeneratorDependencies,
): VideoProxyCandidateGeneratorPort {
	if (typeof dependencies?.runOperation !== 'function') {
		throw new TypeError('A video proxy generator requires an FFmpeg operation runner.');
	}
	const runOperation = dependencies.runOperation;
	return Object.freeze({
		id: GENERATOR_ID,
		version: GENERATOR_VERSION,
		async generate(
			original: Blob,
			_identity: VideoProxyCandidateOriginalIdentity,
			recipe: VideoProxyCandidateRecipe,
			options: Readonly<{ signal?: AbortSignal; assertCurrent(): void }>,
		): Promise<Blob> {
			assertMaintainedRecipe(recipe);
			if (!(original instanceof Blob)) {
				throw new TypeError('A video proxy is generated from the original Blob.');
			}
			throwIfAborted(options?.signal);
			options.assertCurrent();
			const bytes = new Uint8Array(await original.arrayBuffer());
			throwIfAborted(options?.signal);
			return runOperation(async (lease) => {
				const input = await lease.writeInput(bytes, signalOptions(options?.signal));
				const output = `${input}-proxy.${String(VIDEO_PROXY_GENERATION_RECIPE.extension)}`;
				try {
					const run = await lease.exec(
						buildVideoProxyGenerationArgs({ inputPath: input, outputPath: output }),
						signalOptions(options?.signal),
					);
					if (run.exitCode !== 0) throw new VideoProxyGenerationError(run.exitCode, run.logs);
					const produced = await lease.readOutput(output, signalOptions(options?.signal));
					if (!produced.byteLength) {
						throw new Error('FFmpeg produced an empty video proxy body.');
					}
					// Last, so a source that was relinked, reprobed, or removed while the
					// encode ran cannot hand back a body for the source it used to be.
					options.assertCurrent();
					// Copied, because the bytes the lease answered live in the shared
					// runtime's memory and the next operation may reuse them.
					return new Blob([produced.slice()], { type: String(VIDEO_PROXY_GENERATION_RECIPE.mimeType) });
				} finally {
					// Whatever happened, both paths were this operation's to write and are
					// therefore its own to remove: the runtime is shared, and an
					// abandoned original outlives every session that could clean it up.
					await forget(lease, input);
					await forget(lease, output);
				}
			}, signalOptions(options?.signal));
		},
	});
}

function assertMaintainedRecipe(recipe: VideoProxyCandidateRecipe): void {
	if (recipe?.id !== VIDEO_PROXY_GENERATION_RECIPE.id
		|| recipe?.version !== VIDEO_PROXY_GENERATION_RECIPE.version) {
		throw new RangeError(
			`This generator writes the ${VIDEO_PROXY_GENERATION_RECIPE.id} recipe, not ${
				typeof recipe?.id === 'string' ? recipe.id : 'an unnamed recipe'
			}.`,
		);
	}
}

async function forget(lease: FfmpegMediaFileLease, path: string): Promise<void> {
	// A path FFmpeg never created is not an error worth losing the real one over.
	try { await lease.deletePath(path); } catch { /* nothing was written there */ }
}

function signalOptions(signal: AbortSignal | undefined) {
	return signal ? { signal } : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? abortError();
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
