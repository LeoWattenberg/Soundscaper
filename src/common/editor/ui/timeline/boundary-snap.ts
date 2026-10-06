/* SPDX-License-Identifier: AGPL-3.0-only */

import { DEFAULT_CLIP_MICROFADE_SECONDS } from '../../clip-microfade.ts';
import { createBoundarySnapGeometry, type LoopSnapGeometry, type SnapIntervalIndex, type TrackSnapGeometry } from './boundary-snap-geometry.ts';

/** Audacity 3's boundary guide accepts points fewer than four screen pixels away. */
export const BOUNDARY_SNAP_PIXEL_TOLERANCE = 4;
const COINCIDENT_SECONDS = 1 / 44_100;

interface BoundaryClip {
	readonly id: string;
	readonly kind?: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly opaqueExtensions?: unknown;
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
	readonly index?: BoundarySnapIndex;
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
	readonly index?: BoundarySnapIndex;
	readonly clipId: string;
	readonly movingClipIds: readonly string[];
	readonly rawStartFrame: number;
	readonly currentTrackId: string | null;
	readonly destinationTrackId?: string | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly preferRightEdge: boolean;
	readonly microfadeNewClips?: boolean;
}

interface ClipMoveSnapResult {
	readonly startFrame: number;
	readonly guideFrame: number | null;
}

interface SnapPoint {
	readonly frame: number;
	readonly trackId: string | null;
}

export interface BoundarySnapIndex {
	readonly project: BoundaryProject;
	readonly excludedClipIds: readonly string[];
	readonly points: readonly SnapPoint[];
	readonly clipById: ReadonlyMap<string, BoundaryClip>;
	readonly trackById: ReadonlyMap<string, BoundaryTrack>;
	readonly loops: SnapIntervalIndex<LoopSnapGeometry>;
	readonly trackGeometry: ReadonlyMap<string, TrackSnapGeometry<BoundaryClip>>;
}

const NO_EXCLUDED_CLIPS: readonly string[] = [];

function pixelPosition(frame: number, pixelsPerSecond: number, sampleRate: number): number {
	return Math.round(frame * pixelsPerSecond / sampleRate);
}

function collectPoints(project: BoundaryProject, excludedClipIds: readonly string[], clipById: ReadonlyMap<string, BoundaryClip>): SnapPoint[] {
	const excluded = new Set(excludedClipIds);
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

/** Build once per drag and reuse while the immutable project snapshot is unchanged. */
export function createBoundarySnapIndex(
	project: BoundaryProject,
	excludedClipIds: readonly string[] = NO_EXCLUDED_CLIPS,
): BoundarySnapIndex {
	const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
	const trackById = new Map(project.tracks.map((track) => [track.id, track]));
	const geometry = createBoundarySnapGeometry(project.tracks, clipById, new Set(excludedClipIds));
	return { project, excludedClipIds, clipById, trackById, ...geometry,
		points: collectPoints(project, excludedClipIds, clipById) };
}

function indexFor(
	project: BoundaryProject,
	excludedClipIds: readonly string[],
	index?: BoundarySnapIndex,
): BoundarySnapIndex {
	return index?.project === project && index.excludedClipIds === excludedClipIds
		? index : createBoundarySnapIndex(project, excludedClipIds);
}

function firstPointAtOrAfterPixel(
	points: readonly SnapPoint[],
	pixel: number,
	pixelsPerSecond: number,
	sampleRate: number,
): number {
	let low = 0;
	let high = points.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (pixelPosition(points[middle]!.frame, pixelsPerSecond, sampleRate) < pixel) low = middle + 1;
		else high = middle;
	}
	return low;
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
	const index = indexFor(input.project, input.excludedClipIds ?? NO_EXCLUDED_CLIPS, input.index);
	const points = index.points;
	const first = firstPointAtOrAfterPixel(points, position - BOUNDARY_SNAP_PIXEL_TOLERANCE + 1,
		pixelsPerSecond, sampleRate);
	const last = firstPointAtOrAfterPixel(points, position + BOUNDARY_SNAP_PIXEL_TOLERANCE,
		pixelsPerSecond, sampleRate);
	const nearby = points.slice(first, last);
	const framesPerPixel = sampleRate / pixelsPerSecond;
	for (const { trackId, start, end, loop } of index.loops.query(
		(position - BOUNDARY_SNAP_PIXEL_TOLERANCE) * framesPerPixel,
		(position + BOUNDARY_SNAP_PIXEL_TOLERANCE) * framesPerPixel,
	)) {
		const origin = start - loop.offsetFrames;
		const boundary = origin + Math.round((frame - origin) / loop.periodFrames) * loop.periodFrames;
		if (boundary > start && boundary < end
			&& Math.abs(pixelPosition(boundary, pixelsPerSecond, sampleRate) - position) < BOUNDARY_SNAP_PIXEL_TOLERANCE) nearby.push({ frame: boundary, trackId });
	}
	nearby.sort((left, right) => left.frame - right.frame);
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
	const index = indexFor(input.project, input.movingClipIds, input.index);
	const clip = index.clipById.get(input.clipId);
	if (!clip) return { startFrame: input.rawStartFrame, guideFrame: null };
	const common = {
		project: input.project,
		index,
		currentTrackId: input.currentTrackId,
		pixelsPerSecond: input.pixelsPerSecond,
		sampleRate: input.sampleRate,
		excludedClipIds: input.movingClipIds,
	};
	const leftFrame = input.rawStartFrame;
	const rightFrame = leftFrame + clip.durationFrames;
	const left = resolveBoundarySnap({ ...common, frame: leftFrame });
	const right = resolveBoundarySnap({ ...common, frame: rightFrame });
	const leftOverlap = left.snapped ? microfadeOverlapFrames(input, index, clip, left.frame, 'left') : 0;
	const rightOverlap = right.snapped ? microfadeOverlapFrames(input, index, clip, right.frame, 'right') : 0;
	const leftChanged = left.snapped && (left.frame !== leftFrame || leftOverlap > 0);
	const rightChanged = right.snapped && (right.frame !== rightFrame || rightOverlap > 0);
	const useRight = rightChanged && (!leftChanged || input.preferRightEdge);
	if (useRight) return { startFrame: leftFrame + right.frame - rightFrame + rightOverlap, guideFrame: right.frame };
	if (leftChanged) return { startFrame: left.frame - leftOverlap, guideFrame: left.frame };
	return { startFrame: leftFrame, guideFrame: null };
}

function microfadeOverlapFrames(
	input: ClipMoveSnapInput,
	index: BoundarySnapIndex,
	moving: BoundaryClip,
	boundary: number,
	edge: 'left' | 'right',
): number {
	if (!input.microfadeNewClips || moving.kind !== 'audio' || input.movingClipIds.length !== 1) return 0;
	const trackId = input.destinationTrackId ?? input.currentTrackId;
	const geometry = trackId === null ? undefined : index.trackGeometry.get(trackId);
	const neighbors = (edge === 'left' ? geometry?.ends : geometry?.starts)?.get(boundary) ?? [];
	if (neighbors.length !== 1) return 0;
	const neighbor = neighbors[0]!;
	const overlap = Math.min(
		Math.max(1, Math.round(input.sampleRate * DEFAULT_CLIP_MICROFADE_SECONDS)),
		Math.floor(Math.min(moving.durationFrames, neighbor.durationFrames) / 2),
	);
	if (overlap < 1) return 0;
	const start = edge === 'left' ? boundary - overlap : boundary - moving.durationFrames + overlap;
	const end = start + moving.durationFrames;
	if (geometry?.intervals.query(start, end).some((clip) => clip.id !== neighbor.id)) return 0;
	return overlap;
}
