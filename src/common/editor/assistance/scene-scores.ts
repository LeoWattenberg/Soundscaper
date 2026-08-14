/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Turns per-frame scene-change scores into shot boundaries.
 *
 * The scores themselves come from whichever backend measured them; this module
 * only decides which of them are cuts, so the fast and accurate detectors can
 * share one decision rule and one set of tests. Frames are the project's
 * canonical coordinate here as everywhere: a backend reporting seconds
 * converts once at its own edge.
 *
 * A fixed threshold does not survive real footage. Locked-off dialogue scores
 * near zero between cuts, while handheld or gameplay footage scores high
 * continuously, so any threshold low enough to catch the first floods the
 * second. Detection therefore asks whether a score stands out against its own
 * neighbourhood, and keeps an absolute floor so that a source scoring nothing
 * at all does not make a compression flicker look like a discontinuity.
 *
 * Runs of adjacent trips are reported as they were seen. A dissolve trips the
 * threshold several times running, and collapsing that into one transition
 * needs the minimum shot length, which belongs to shot construction rather
 * than here.
 */

/** Below this, a score is never a cut however unusual it is locally. */
export const SCENE_SCORE_ABSOLUTE_FLOOR = 0.12;

/**
 * How far into the headroom above its neighbourhood a score must reach.
 *
 * Deliberately not a multiple of the local baseline. Scores are bounded at
 * one, so a multiplicative rule becomes unsatisfiable exactly where it is
 * needed most: against a baseline of 0.45, a rule demanding two and a half
 * times the local score asks for 1.125, and no cut in the most motion-heavy
 * footage could ever clear it. Measuring the remaining range instead keeps the
 * rule meaningful at every baseline, and degrades to a plain threshold when
 * the neighbourhood scores nothing.
 */
export const SCENE_SCORE_LOCAL_SEPARATION = 0.25;

/** Frames of neighbourhood, either side, that a score is compared against. */
export const SCENE_SCORE_WINDOW_FRAMES = 20;

export interface SceneScore {
	readonly frame: number;
	/** Frame-difference measure in the unit interval. */
	readonly score: number;
}

export interface SceneScoreOptions {
	readonly absoluteFloor?: number;
	readonly localSeparation?: number;
	readonly windowFrames?: number;
}

function assertUnitInterval(value: number, label: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${label} must be in the unit interval`);
	}
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
		: sorted[middle] as number;
}

/**
 * Selects the scores that are cuts.
 *
 * The neighbourhood excludes the frame under test, so a strong cut cannot
 * raise the baseline it is being measured against.
 */
export function sceneScoresToBoundaries(
	scores: readonly SceneScore[],
	options: SceneScoreOptions = {},
): readonly SceneScore[] {
	const absoluteFloor = options.absoluteFloor ?? SCENE_SCORE_ABSOLUTE_FLOOR;
	const localSeparation = options.localSeparation ?? SCENE_SCORE_LOCAL_SEPARATION;
	const windowFrames = options.windowFrames ?? SCENE_SCORE_WINDOW_FRAMES;

	assertUnitInterval(absoluteFloor, 'The absolute floor');
	if (!Number.isFinite(localSeparation) || localSeparation <= 0 || localSeparation >= 1) {
		throw new RangeError('The local separation must fall strictly between zero and one');
	}
	if (!Number.isInteger(windowFrames) || windowFrames <= 0) {
		throw new RangeError('The comparison window must be a positive integer');
	}

	let previousFrame = -1;
	for (const entry of scores) {
		if (!Number.isInteger(entry.frame)) {
			throw new TypeError(`A scene score frame must be an integer, not ${entry.frame}`);
		}
		if (entry.frame < 0) throw new RangeError('A scene score frame cannot be negative');
		if (entry.frame <= previousFrame) {
			throw new RangeError('Scene scores must arrive in ascending frame order');
		}
		assertUnitInterval(entry.score, 'A scene score');
		previousFrame = entry.frame;
	}

	const boundaries: SceneScore[] = [];
	for (const [position, entry] of scores.entries()) {
		if (entry.score < absoluteFloor) continue;

		const from = Math.max(0, position - windowFrames);
		const to = Math.min(scores.length, position + windowFrames + 1);
		const neighbourhood: number[] = [];
		for (let index = from; index < to; index += 1) {
			if (index !== position) neighbourhood.push((scores[index] as SceneScore).score);
		}
		// With no neighbours there is nothing to stand out from, so the floor is
		// the only test a score has to pass.
		if (neighbourhood.length === 0) {
			boundaries.push(entry);
			continue;
		}
		const baseline = median(neighbourhood);
		if (entry.score >= baseline + (1 - baseline) * localSeparation) boundaries.push(entry);
	}
	return Object.freeze(boundaries.map((entry) => Object.freeze({ ...entry })));
}
