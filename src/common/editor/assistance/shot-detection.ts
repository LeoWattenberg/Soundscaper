/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Resolves shot boundaries from whichever decode path a build actually has.
 *
 * Getting frames out of a video already has a house pattern: `probeVideoTiming`
 * tries ordered backend ports, prefers the hardware-accelerated WebCodecs path,
 * falls back to the pinned FFmpeg runtime, and records an explicit decision
 * with its failures rather than guessing. Shot detection has exactly the same
 * shape and problem, so it follows the same pattern rather than inventing a
 * second one — and in particular it does not reach for a native binary, which
 * would put a new licence and a per-platform packaging burden into the desktop
 * build for a job the existing runtimes already do.
 *
 * A backend's only job is to report per-frame scene scores in the canonical
 * coordinate. Deciding which scores are cuts belongs to `scene-scores.ts` and
 * turning cuts into shots belongs to `shots.ts`, so every backend produces
 * identical boundaries from identical scores.
 */

import { sceneScoresToBoundaries, type SceneScore, type SceneScoreOptions } from './scene-scores.ts';
import { buildShotIndex, shotsFromBoundaries, type AssistanceShotIndex } from './shots.ts';

export interface ShotDetectorResult {
	/** Per-frame scene scores in ascending frame order. */
	readonly scores: readonly SceneScore[];
	readonly durationFrames: number;
	readonly sampleRate: number;
}

export interface ShotDetectorPort {
	readonly id: string;
	detect(input: Blob, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<ShotDetectorResult>;
}

export type ResolvedShotDetection =
	| Readonly<{
		decision: 'shot-index';
		backend: string;
		index: AssistanceShotIndex;
	}>
	| Readonly<{
		decision: 'unavailable';
		reason: 'no-detector-succeeded';
		failures: readonly Readonly<{ backend: string; message: string }>[];
	}>;

export interface ShotDetectionOptions {
	readonly sourceId: string;
	readonly detectors?: readonly ShotDetectorPort[];
	readonly minimumShotFrames?: number;
	readonly sceneScores?: SceneScoreOptions;
	readonly signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Shot detection was cancelled.', 'AbortError');
}

function assertResult(result: ShotDetectorResult): ShotDetectorResult {
	if (!Number.isInteger(result?.durationFrames) || result.durationFrames <= 0) {
		throw new RangeError('A shot detector must report a positive integer source duration in frames');
	}
	if (!Number.isInteger(result.sampleRate) || result.sampleRate <= 0) {
		throw new RangeError('A shot detector must report the sample rate its frames are counted in');
	}
	if (!Array.isArray(result.scores)) {
		throw new TypeError('A shot detector must report scene scores, even when there are none');
	}
	return result;
}

/**
 * Tries each detector in preference order and returns the first index one
 * produces, or an explicit unavailable decision carrying every failure.
 *
 * A source with no detected cut is a result, not a failure: it is one shot.
 * Having no working detector at all is the failure, and it is reported rather
 * than flattened into that same single-shot answer, because the two mean very
 * different things to everything downstream.
 */
export async function detectShots(
	input: Blob,
	options: ShotDetectionOptions,
): Promise<ResolvedShotDetection> {
	if (!(input instanceof Blob)) throw new TypeError('A video Blob is required for shot detection.');
	if (typeof options?.sourceId !== 'string' || options.sourceId === '') {
		throw new TypeError('Shot detection needs the source it describes.');
	}

	const failures: Array<Readonly<{ backend: string; message: string }>> = [];
	for (const detector of options.detectors ?? []) {
		if (!detector || typeof detector.id !== 'string' || !detector.id
			|| typeof detector.detect !== 'function') {
			throw new TypeError('Every shot detector requires an ID and detect function.');
		}
		throwIfAborted(options.signal);
		try {
			const result = assertResult(await detector.detect(input, { signal: options.signal }));
			throwIfAborted(options.signal);
			const boundaries = sceneScoresToBoundaries(result.scores, options.sceneScores);
			const shots = shotsFromBoundaries(
				boundaries.map(({ frame, score }) => ({ frame, score })),
				{ durationFrames: result.durationFrames, minimumShotFrames: options.minimumShotFrames },
			);
			return Object.freeze({
				decision: 'shot-index',
				backend: detector.id,
				index: buildShotIndex({
					sourceId: options.sourceId,
					sampleRate: result.sampleRate,
					detector: detector.id,
					shots,
				}),
			});
		} catch (error) {
			throwIfAborted(options.signal);
			failures.push(Object.freeze({
				backend: detector.id,
				message: error instanceof Error ? error.message : String(error),
			}));
		}
	}

	return Object.freeze({
		decision: 'unavailable',
		reason: 'no-detector-succeeded',
		failures: Object.freeze(failures),
	});
}

/** Adapter for a WebCodecs decode path that scores frames as it walks them. */
export function createWebCodecsShotDetector(
	detect: ShotDetectorPort['detect'],
): ShotDetectorPort {
	if (typeof detect !== 'function') throw new TypeError('A WebCodecs scene-score walker is required.');
	return Object.freeze({ id: 'webcodecs', detect });
}

/** Adapter for the pinned FFmpeg runtime exposing the bounded scene-score port. */
export function createFfmpegShotDetector(runtime: Readonly<{
	detectSceneScores?: ShotDetectorPort['detect'];
}>): ShotDetectorPort | null {
	return typeof runtime?.detectSceneScores === 'function'
		? Object.freeze({ id: 'ffmpeg', detect: runtime.detectSceneScores.bind(runtime) })
		: null;
}
