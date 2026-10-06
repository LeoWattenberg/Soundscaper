/* SPDX-License-Identifier: AGPL-3.0-only */
import { getTrackClips, automaticCrossfadeRanges } from './clip-schedule-geometry.ts';
import { clipStart, clipDuration } from './buffer-math.ts';
import type { ClipCrossfadeRanges } from '../audio-clip-overlap.ts';
import type { EngineProject, EngineTrack, EngineClip } from './types.ts';

const MAXIMUM_RETAINED_CLIPS = 32_768;
interface Interval { readonly clip: EngineClip; readonly start: number; readonly end: number; readonly ordinal: number }
interface TrackIndex {
	readonly kind: 'ids' | 'clips'; readonly membership: readonly unknown[]; readonly signature: readonly unknown[];
	readonly frozenMembership: boolean; readonly clips: readonly EngineClip[];
	readonly ordered: readonly Interval[]; readonly prefixEnds: Float64Array;
	readonly crossfades: ReadonlyMap<string, ClipCrossfadeRanges>;
}
interface ProjectIndex {
	readonly clipsById: ReadonlyMap<string, EngineClip>; readonly tracks: Map<EngineTrack, TrackIndex>;
	retainedClips: number;
}
const projects = new WeakMap<EngineProject, ProjectIndex>();
const uncachedProjects = new WeakSet<EngineProject>();

/** Retain only immutable data-owned clip geometry; generic mutable documents stay uncached. */
function projectIndex(project: EngineProject): ProjectIndex | null {
	const existing = projects.get(project); if (existing) return existing;
	if (uncachedProjects.has(project)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(project, 'clips');
	const clips = descriptor && 'value' in descriptor ? descriptor.value as unknown : null;
	if (!Object.isFrozen(project) || !Array.isArray(clips) || !Object.isFrozen(clips)
		|| clips.length > MAXIMUM_RETAINED_CLIPS || !clips.every(immutableGeometry)) { uncachedProjects.add(project); return null; }
	const index: ProjectIndex = { clipsById: new Map((clips as EngineClip[]).map((clip) => [String(clip.id), clip])), tracks: new Map(), retainedClips: 0 };
	projects.set(project, index); return index;
}
function immutableGeometry(value: unknown): value is EngineClip {
	if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
	for (const key of ['id', 'timelineStartFrame', 'durationFrames']) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !('value' in descriptor)) return false;
		if (key === 'id') { if (typeof descriptor.value !== 'string' && typeof descriptor.value !== 'number') return false; }
		else if (typeof descriptor.value !== 'number' || !Number.isFinite(descriptor.value)) return false;
	}
	return true;
}
function membership(track: EngineTrack): Readonly<{ kind: 'ids' | 'clips'; values: readonly unknown[] }> | null {
	if (Array.isArray(track.clipIds)) return { kind: 'ids', values: track.clipIds };
	if (Array.isArray(track.clips)) return { kind: 'clips', values: track.clips };
	return null;
}
function signature(value: unknown, kind: 'ids' | 'clips'): unknown {
	return kind === 'clips' && value && typeof value === 'object' ? value : String(value);
}
function matches(index: TrackIndex, current: NonNullable<ReturnType<typeof membership>>): boolean {
	if (index.kind !== current.kind || index.signature.length !== current.values.length) return false;
	if (index.frozenMembership && index.membership === current.values) return true;
	for (let ordinal = 0; ordinal < current.values.length; ordinal++) {
		if (signature(current.values[ordinal], current.kind) !== index.signature[ordinal]) return false;
	}
	return true;
}
function trackIndex(project: ProjectIndex, track: EngineTrack): TrackIndex | null {
	const current = membership(track); if (!current || current.values.length > MAXIMUM_RETAINED_CLIPS) return null;
	const existing = project.tracks.get(track);
	if (existing && matches(existing, current)) return existing;
	const clips = getTrackClips(track, project.clipsById);
	if (!clips.every(immutableGeometry)) return null;
	const ordered = clips.map((clip, ordinal) => {
		const start = clipStart(clip); return { clip, start, end: start + clipDuration(clip), ordinal };
	}).sort((left, right) => left.start - right.start || left.ordinal - right.ordinal);
	const prefixEnds = new Float64Array(ordered.length);
	let maximumEnd = -Infinity;
	for (let ordinal = 0; ordinal < ordered.length; ordinal++) prefixEnds[ordinal] = maximumEnd = Math.max(maximumEnd, ordered[ordinal]!.end);
	const result: TrackIndex = { kind: current.kind, membership: current.values,
		signature: current.values.map((value) => signature(value, current.kind)),
		frozenMembership: Object.isFrozen(current.values) && current.values.every((value) => typeof value === 'string' || typeof value === 'number' || (current.kind === 'clips' && immutableGeometry(value))),
		clips, ordered, prefixEnds, crossfades: automaticCrossfadeRanges(clips) };
	if (existing) { project.retainedClips -= existing.clips.length; project.tracks.delete(track); }
	while ((project.retainedClips + clips.length > MAXIMUM_RETAINED_CLIPS || project.tracks.size >= 64) && project.tracks.size) {
		const oldest = project.tracks.keys().next().value!; project.retainedClips -= project.tracks.get(oldest)!.clips.length; project.tracks.delete(oldest);
	}
	project.tracks.set(track, result); project.retainedClips += clips.length;
	return result;
}

/** Query intervals while preserving original clip/summing order and full-track crossfades. */
export function indexedClipScheduleRange(project: EngineProject, track: EngineTrack, fromFrame: number, toFrame: number):
	Readonly<{ clips: readonly EngineClip[]; crossfades: ReadonlyMap<string, ClipCrossfadeRanges> }> | null {
	if (!Number.isFinite(fromFrame) || !Number.isFinite(toFrame)) return null;
	const owner = projectIndex(project); if (!owner) return null;
	const index = trackIndex(owner, track); if (!index) return null;
	let first = 0; let last = index.ordered.length;
	while (first < last) { const middle = (first + last) >>> 1; if (index.prefixEnds[middle]! <= fromFrame) first = middle + 1; else last = middle; }
	const selected: Interval[] = [];
	for (let ordinal = first; ordinal < index.ordered.length; ordinal++) {
		const interval = index.ordered[ordinal]!; if (interval.start >= toFrame) break;
		if (interval.end > fromFrame) selected.push(interval);
	}
	selected.sort((left, right) => left.ordinal - right.ordinal);
	const clips = selected.map((interval) => interval.clip);
	const crossfades = new Map<string, ClipCrossfadeRanges>();
	for (const clip of clips) {
		const ranges = index.crossfades.get(String(clip.id));
		if (ranges) crossfades.set(String(clip.id), {
			crossfadeInRanges: ranges.crossfadeInRanges.map(([start, end]) => [start, end]),
			crossfadeOutRanges: ranges.crossfadeOutRanges.map(([start, end]) => [start, end]),
		});
	}
	return { clips, crossfades };
}
