/* SPDX-License-Identifier: AGPL-3.0-only */

/** Audacity 3's boundary guide accepts points fewer than four screen pixels away. */
export const BOUNDARY_SNAP_PIXEL_TOLERANCE = 4;
const COINCIDENT_SECONDS = 1 / 44_100;

interface BoundaryClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

interface BoundaryTrack {
	readonly id: string;
	readonly clipIds?: readonly string[];
}

interface BoundaryProject {
	readonly clips: readonly BoundaryClip[];
	readonly tracks: readonly BoundaryTrack[];
}

interface SnapInput {
	readonly project: BoundaryProject;
	readonly frame: number;
	readonly currentTrackId: string | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly rightEdge?: boolean;
	readonly excludedClipIds?: readonly string[];
}

interface BoundarySnapResult {
	readonly frame: number;
	readonly snapped: boolean;
}

interface ClipMoveSnapInput {
	readonly project: BoundaryProject;
	readonly clipId: string;
	readonly movingClipIds: readonly string[];
	readonly rawStartFrame: number;
	readonly currentTrackId: string | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly preferRightEdge: boolean;
}

interface ClipMoveSnapResult {
	readonly startFrame: number;
	readonly guideFrame: number | null;
}

interface SnapPoint {
	readonly frame: number;
	readonly trackId: string | null;
}

function pixelPosition(frame: number, pixelsPerSecond: number, sampleRate: number): number {
	return Math.round(frame * pixelsPerSecond / sampleRate);
}

function collectPoints(project: BoundaryProject, excludedClipIds: readonly string[]): SnapPoint[] {
	const excluded = new Set(excludedClipIds);
	const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const points: SnapPoint[] = [{ frame: 0, trackId: null }];
	for (const track of project.tracks) {
		for (const clipId of track.clipIds ?? []) {
			if (excluded.has(clipId)) continue;
			const clip = clipById.get(clipId);
			if (!clip) continue;
			const start = clip.timelineStartFrame;
			const end = start + clip.durationFrames;
			points.push({ frame: start, trackId: track.id });
			if (end !== start) points.push({ frame: end, trackId: track.id });
		}
	}
	return points.sort((left, right) => left.frame - right.frame);
}

/**
 * Resolve Audacity 3's physical-boundary rule, independently of time-grid snap.
 * Distinct nearby boundaries are intentionally ambiguous unless exactly one is
 * on the track being edited. This prevents a nearest-point jump the user did
 * not clearly aim at.
 */
export function resolveBoundarySnap(input: SnapInput): BoundarySnapResult {
	const { frame, currentTrackId, pixelsPerSecond, sampleRate, rightEdge = false } = input;
	if (!Number.isFinite(frame) || pixelsPerSecond <= 0 || sampleRate <= 0) {
		return { frame, snapped: false };
	}
	const position = pixelPosition(frame, pixelsPerSecond, sampleRate);
	const nearby = collectPoints(input.project, input.excludedClipIds ?? []).filter((point) => (
		Math.abs(pixelPosition(point.frame, pixelsPerSecond, sampleRate) - position)
			< BOUNDARY_SNAP_PIXEL_TOLERANCE
	));
	if (nearby.length === 0) return { frame, snapped: false };
	if (nearby.length === 1) return { frame: nearby[0]!.frame, snapped: true };
	const onCurrentTrack = nearby.filter(({ trackId }) => trackId === currentTrackId);
	if (onCurrentTrack.length === 1) return { frame: onCurrentTrack[0]!.frame, snapped: true };
	if ((nearby.at(-1)!.frame - nearby[0]!.frame) / sampleRate < COINCIDENT_SECONDS) {
		return { frame: (rightEdge ? nearby.at(-1)! : nearby[0]!).frame, snapped: true };
	}
	return { frame, snapped: false };
}

/** Move the grabbed clip by one snapped edge, keeping every moving clip together. */
export function resolveClipMoveBoundarySnap(input: ClipMoveSnapInput): ClipMoveSnapResult {
	const clip = input.project.clips.find(({ id }) => id === input.clipId);
	if (!clip) return { startFrame: input.rawStartFrame, guideFrame: null };
	const common = {
		project: input.project,
		currentTrackId: input.currentTrackId,
		pixelsPerSecond: input.pixelsPerSecond,
		sampleRate: input.sampleRate,
		excludedClipIds: input.movingClipIds,
	};
	const leftFrame = input.rawStartFrame;
	const rightFrame = leftFrame + clip.durationFrames;
	const left = resolveBoundarySnap({ ...common, frame: leftFrame });
	const right = resolveBoundarySnap({ ...common, frame: rightFrame });
	const leftChanged = left.snapped && left.frame !== leftFrame;
	const rightChanged = right.snapped && right.frame !== rightFrame;
	const useRight = rightChanged && (!leftChanged || input.preferRightEdge);
	if (useRight) return { startFrame: leftFrame + right.frame - rightFrame, guideFrame: right.frame };
	if (leftChanged) return { startFrame: left.frame, guideFrame: left.frame };
	return { startFrame: leftFrame, guideFrame: null };
}
