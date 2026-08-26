/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Shot boundaries expressed in the project's canonical coordinate.
 *
 * Detectors report seconds; this module refuses them. Every boundary is an
 * integer sample frame converted once at the adapter edge, so a shot compares,
 * sorts, and abuts exactly like every other editorial position. A shot index
 * is a derived asset: it is produced from persisted media, replaced whole
 * rather than merged, and nothing here mutates a project.
 *
 * The index is the shared substrate of the video assistance track. Tagging
 * samples keyframes per shot, reframing proposes one crop per shot, and
 * highlight assembly snaps clip edges onto boundaries so no clip opens
 * mid-cut. Those stages consume shots and never re-derive them.
 */

export const ASSISTANCE_SHOT_INDEX_SCHEMA_VERSION = 1;

/** An index may not exceed these bounds; a longer result is refused. */
export const MAX_SHOTS = 100_000;

export interface Shot {
	readonly startFrame: number;
	/** Exclusive, so one shot's end is the next shot's start. */
	readonly endFrame: number;
	/**
	 * Detector confidence in the unit interval for the boundary that opened
	 * this shot. The first shot opens at the source start rather than at a
	 * detection, and carries 1.
	 */
	readonly score: number;
}

export interface AssistanceShotIndex {
	readonly schemaVersion: typeof ASSISTANCE_SHOT_INDEX_SCHEMA_VERSION;
	readonly sourceId: string;
	readonly sampleRate: number;
	/** The detector that produced these boundaries, for the review list. */
	readonly detector: string;
	readonly shots: readonly Shot[];
}

export interface ShotIndexDraft {
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly detector: string;
	readonly shots: readonly Shot[];
}

export interface ShotBoundary {
	readonly frame: number;
	readonly score: number;
}

export interface ShotBoundaryOptions {
	readonly durationFrames: number;
	/**
	 * Boundaries closer together than this collapse into one. The fast
	 * detector scores frame differences, so a dissolve trips its threshold
	 * several times running; without this a gradual transition becomes a run
	 * of one-frame shots rather than a single cut.
	 */
	readonly minimumShotFrames?: number;
}

function assertFrame(value: number, label: string): void {
	if (!Number.isInteger(value)) {
		throw new TypeError(`${label} must be an integer sample frame, not ${value}`);
	}
}

function assertScore(value: number, label: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${label} must be a confidence in the unit interval`);
	}
}

/**
 * Turns detected boundaries into contiguous shots covering the whole source.
 *
 * The result always spans `[0, durationFrames)` with no gap and no overlap,
 * whatever the detector reported, so a consumer never has to ask what happens
 * between two shots.
 */
export function shotsFromBoundaries(
	boundaries: readonly ShotBoundary[],
	options: ShotBoundaryOptions,
): readonly Shot[] {
	const { durationFrames } = options;
	assertFrame(durationFrames, 'The source duration');
	if (durationFrames <= 0) throw new RangeError('The source duration must be positive');
	const minimumShotFrames = options.minimumShotFrames ?? 0;
	assertFrame(minimumShotFrames, 'The minimum shot length');
	if (minimumShotFrames < 0) throw new RangeError('The minimum shot length cannot be negative');

	for (const boundary of boundaries) {
		assertFrame(boundary.frame, 'A shot boundary');
		assertScore(boundary.score, 'A shot boundary score');
		if (boundary.frame <= 0 || boundary.frame >= durationFrames) {
			throw new RangeError(
				`A shot boundary at ${boundary.frame} falls outside the source; the source start is not a cut`,
			);
		}
	}

	const sorted = [...boundaries].sort((left, right) => left.frame - right.frame);
	const kept: ShotBoundary[] = [];
	for (const boundary of sorted) {
		const previous = kept.at(-1);
		// Within the minimum, this boundary and the previous one describe the
		// same transition. Keep whichever the detector was surer of, which for
		// a dissolve is its midpoint rather than either edge.
		if (previous && boundary.frame - previous.frame < minimumShotFrames) {
			// Replacing moves the kept boundary forward, so the replacement has to
			// clear the same head and tail guards the push below applies; otherwise
			// the collapse can leave a final shot shorter than the minimum.
			if (boundary.score > previous.score
				&& boundary.frame >= minimumShotFrames
				&& durationFrames - boundary.frame >= minimumShotFrames) {
				kept[kept.length - 1] = boundary;
			}
			continue;
		}
		if (boundary.frame < minimumShotFrames) continue;
		if (durationFrames - boundary.frame < minimumShotFrames) continue;
		kept.push(boundary);
	}

	const shots: Shot[] = [];
	let startFrame = 0;
	let score = 1;
	for (const boundary of kept) {
		shots.push({ startFrame, endFrame: boundary.frame, score });
		startFrame = boundary.frame;
		score = boundary.score;
	}
	shots.push({ startFrame, endFrame: durationFrames, score });
	return Object.freeze(shots.map((shot) => Object.freeze(shot)));
}

/** Validates a draft into an index, refusing anything a consumer could not read. */
export function buildShotIndex(draft: ShotIndexDraft): AssistanceShotIndex {
	if (typeof draft?.sourceId !== 'string' || draft.sourceId === '') {
		throw new TypeError('A shot index needs the source it describes');
	}
	if (!Number.isInteger(draft.sampleRate) || draft.sampleRate <= 0) {
		throw new TypeError('A shot index needs the sample rate its frames are counted in');
	}
	if (typeof draft.detector !== 'string' || draft.detector === '') {
		throw new TypeError('A shot index needs the detector that produced it');
	}
	const shots = draft.shots ?? [];
	if (shots.length === 0) throw new RangeError('A shot index needs at least one shot');
	if (shots.length > MAX_SHOTS) throw new RangeError(`A shot index may not exceed ${MAX_SHOTS} shots`);
	if (shots[0]?.startFrame !== 0) throw new RangeError('Shots must start at zero and cover the source');

	let previousEnd = 0;
	for (const shot of shots) {
		assertFrame(shot.startFrame, 'A shot start');
		assertFrame(shot.endFrame, 'A shot end');
		assertScore(shot.score, 'A shot score');
		if (shot.endFrame <= shot.startFrame) throw new RangeError('A shot may not be empty');
		if (shot.startFrame !== previousEnd) {
			throw new RangeError(
				`Shots must be contiguous; ${shot.startFrame} does not continue from ${previousEnd}`,
			);
		}
		previousEnd = shot.endFrame;
	}

	return Object.freeze({
		schemaVersion: ASSISTANCE_SHOT_INDEX_SCHEMA_VERSION,
		sourceId: draft.sourceId,
		sampleRate: draft.sampleRate,
		detector: draft.detector,
		shots: Object.freeze(shots.map((shot) => Object.freeze({ ...shot }))),
	});
}

/** The shot containing a frame, or null when the frame is outside the source. */
export function shotAt(index: AssistanceShotIndex, frame: number): Shot | null {
	if (!Number.isInteger(frame) || frame < 0) return null;
	let low = 0;
	let high = index.shots.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const shot = index.shots[middle] as Shot;
		if (frame < shot.startFrame) high = middle - 1;
		else if (frame >= shot.endFrame) low = middle + 1;
		else return shot;
	}
	return null;
}

/**
 * Moves a frame onto the nearest cut within `toleranceFrames`, or returns it
 * unchanged. Snapping is bounded deliberately: a frame far from any cut is a
 * position someone chose, not a near miss.
 */
export function snapFrameToShotBoundary(
	index: AssistanceShotIndex,
	frame: number,
	toleranceFrames: number,
): number {
	assertFrame(frame, 'A frame to snap');
	assertFrame(toleranceFrames, 'The snap tolerance');
	if (toleranceFrames <= 0) return frame;

	let best = frame;
	let bestDistance = toleranceFrames + 1;
	for (const shot of index.shots) {
		for (const candidate of [shot.startFrame, shot.endFrame]) {
			const distance = Math.abs(candidate - frame);
			if (distance < bestDistance) {
				best = candidate;
				bestDistance = distance;
			}
		}
	}
	return bestDistance <= toleranceFrames ? best : frame;
}

/**
 * Frames to sample for a shot, spread evenly and strictly inside it.
 *
 * Sampling never touches the boundary frames: a cut frame in a dissolve blends
 * two shots into an image that represents neither. A shot too short for the
 * requested count yields fewer distinct frames rather than the same frame
 * repeatedly, which keeps an index over a rapid-cut sequence from filling with
 * duplicates.
 */
export function keyframeFramesForShot(shot: Shot, count: number): readonly number[] {
	if (!Number.isInteger(count) || count < 0) {
		throw new TypeError('A keyframe count must be a non-negative integer');
	}
	if (count === 0) return Object.freeze([]);
	const span = shot.endFrame - shot.startFrame;
	if (span <= 0) return Object.freeze([]);

	const frames: number[] = [];
	for (let position = 0; position < count; position += 1) {
		const offset = Math.floor((span * (position * 2 + 1)) / (count * 2));
		const frame = shot.startFrame + Math.min(offset, span - 1);
		if (frames.at(-1) !== frame) frames.push(frame);
	}
	return Object.freeze(frames);
}
