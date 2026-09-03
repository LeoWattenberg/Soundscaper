/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveSplitToolGuidelineFrame,
	splitToolTrackHasClipAt,
} from './timeline-tool-precedence.ts';

export interface SplitToolGuideline {
	readonly frame: number;
	readonly allTracks: boolean;
	readonly singleTop: number;
	readonly singleHeight: number;
	readonly allTop: number;
	readonly allHeight: number;
}

interface SplitToolGuidelineProject {
	readonly clips: readonly Readonly<{
		readonly id: unknown;
		readonly timelineStartFrame: number;
		readonly durationFrames: number;
	}>[];
	readonly tracks: readonly Readonly<{
		readonly id: string;
		readonly type?: string;
		readonly clipIds?: readonly unknown[];
	}>[];
	readonly sampleRate?: number;
	readonly snap?: Readonly<{ readonly enabled?: boolean }>;
	readonly [extension: string]: unknown;
}

interface GuidelineElement {
	readonly dataset?: Readonly<Record<string, string | undefined>>;
	closest?(selector: string): GuidelineElement | null;
	getBoundingClientRect(): Readonly<{ readonly top: number; readonly height: number }>;
}

interface GuidelineRoot {
	querySelector(selector: string): GuidelineElement | null;
	querySelectorAll?(selector: string): Iterable<GuidelineElement>;
}

interface ResolveSplitToolHoverGuidelineOptions {
	readonly allTracks: boolean;
	readonly clientX: number;
	readonly frameAtClientX: (clientX: number, lane: GuidelineElement) => number;
	readonly lane: GuidelineElement;
	readonly pixelsPerSecond: number;
	readonly project: SplitToolGuidelineProject;
	readonly sampleRate: number;
	readonly scrollRoot: GuidelineRoot | null;
}

/** Build the visible Split Tool line from the raw hover and current layout. */
export function resolveSplitToolHoverGuideline({
	allTracks,
	clientX,
	frameAtClientX,
	lane,
	pixelsPerSecond,
	project,
	sampleRate,
	scrollRoot,
}: ResolveSplitToolHoverGuidelineOptions): SplitToolGuideline | null {
	const trackId = lane.dataset?.trackId;
	const track = project.tracks.find((candidate) => candidate.id === trackId);
	if (!trackId || track?.type === 'label' || !Array.isArray(track?.clipIds)) return null;
	const rawFrame = frameAtClientX(clientX, lane);
	if (!splitToolTrackHasClipAt(project.tracks, project.clips, trackId, rawFrame)) return null;

	const surface = scrollRoot?.querySelector('.audio-editor-timeline-inner') ?? null;
	const trackList = scrollRoot?.querySelector('[data-track-list]') ?? null;
	const row = lane.closest?.('[data-track-row]') ?? lane;
	const surfaceTop = finiteLayoutValue(surface?.getBoundingClientRect().top, 0);
	const single = relativeBounds(row, surfaceTop);
	const all = relativeBounds(trackList ?? row, surfaceTop);
	return Object.freeze({
		frame: resolveSplitToolGuidelineFrame({ frame: rawFrame, pixelsPerSecond, project, sampleRate }),
		allTracks,
		singleTop: single.top,
		singleHeight: single.height,
		allTop: all.top,
		allHeight: all.height,
	});
}

/** Change only the Shift-dependent span without moving the snapped guideline. */
export function setSplitToolGuidelineAllTracks(
	guideline: SplitToolGuideline | null,
	allTracks: boolean,
): SplitToolGuideline | null {
	if (!guideline || guideline.allTracks === allTracks) return guideline;
	return Object.freeze({ ...guideline, allTracks });
}

/** Recover the lane beneath a captured pointer after its event target becomes the scroll root. */
export function resolveSplitToolPointerLane(
	target: Readonly<{ closest?(selector: string): GuidelineElement | null }> | null,
	clientY: number,
	scrollRoot: GuidelineRoot | null,
	capturedLane: GuidelineElement | null,
): GuidelineElement | null {
	const directLane = target?.closest?.('.audio-editor-track-lane[data-track-lane]') ?? null;
	if (directLane || !capturedLane) return directLane;
	const candidates = scrollRoot?.querySelectorAll?.('.audio-editor-track-lane[data-track-lane]');
	if (!candidates) return capturedLane;
	const y = Number(clientY);
	if (!Number.isFinite(y)) return null;
	return [...candidates].find((lane) => {
		const rect = lane.getBoundingClientRect();
		return y >= rect.top && y < rect.top + rect.height;
	}) ?? null;
}

function relativeBounds(element: GuidelineElement, surfaceTop: number): Readonly<{
	readonly top: number;
	readonly height: number;
}> {
	const rect = element.getBoundingClientRect();
	return Object.freeze({
		top: Math.max(0, finiteLayoutValue(rect.top, surfaceTop) - surfaceTop),
		height: Math.max(1, finiteLayoutValue(rect.height, 1)),
	});
}

function finiteLayoutValue(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}
