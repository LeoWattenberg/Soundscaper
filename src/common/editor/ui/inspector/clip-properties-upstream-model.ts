/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ClipPropertiesClip, ClipPropertiesSelection } from '@soundscaper/design-system/ClipPropertiesPanel/clip-properties-types';
import { readClipLoop } from '../../audio-clip-loop.ts';
import { selectedEndFadeShapePreset } from '../../clip-fade-presets.ts';

export interface PropertyClip {
	readonly id: string;
	readonly kind: string;
	readonly sourceId: string;
	readonly title?: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly speedRatio?: number;
	readonly pitchCents?: number;
	readonly linkPitchAndTempo?: boolean;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly reversed?: boolean;
	readonly color?: string;
	readonly groupId?: string | null;
}
export interface PropertySource {
	readonly id: string;
	readonly name?: string;
	readonly sampleRate?: number;
	readonly frameCount?: number;
}
export interface PropertyTrack {
	readonly id: string;
	readonly type?: string;
	readonly name: string;
	readonly clipIds?: readonly string[];
	readonly color?: string;
	readonly locked?: boolean;
}
export interface PropertyProject {
	readonly id: string;
	readonly sampleRate: number;
	readonly clips: readonly PropertyClip[];
	readonly sources: readonly PropertySource[];
	readonly tracks: readonly PropertyTrack[];
}

/** Seconds are a presentation boundary; the source retains its imported clock. */
export function clipPropertiesPresentation(project: PropertyProject | null, ids: readonly string[], fallback: string,
	preferredClipId: string | null = null) {
	const selected = new Set(ids);
	const selectedClips = project?.clips.filter(clip => selected.has(clip.id)) ?? [];
	const preferred = selectedClips.find(clip => clip.id === preferredClipId);
	const clips = preferred ? [preferred, ...selectedClips.filter(clip => clip !== preferred)] : selectedClips;
	const tracks = project?.tracks.filter(track => track.clipIds?.some(id => selected.has(id))) ?? [];
	const views = clips.map((clip): ClipPropertiesClip => {
		const source = project!.sources.find(source => source.id === clip.sourceId);
		const track = tracks.find(track => track.clipIds?.includes(clip.id));
		const rate = project!.sampleRate;
		const sourceRate = source?.sampleRate || rate;
		return {
			id: clip.id, name: clip.title || source?.name || fallback,
			trackName: track?.name ?? '', trackId: track?.id,
			color: clip.color === 'auto' ? 'track' : clip.color, trackColor: track?.color,
			start: clip.timelineStartFrame / rate, duration: clip.durationFrames / rate,
			trimStart: clip.sourceStartFrame / sourceRate,
			fullDuration: (source?.frameCount ?? clip.sourceStartFrame + clip.sourceDurationFrames) / sourceRate,
			// Actual extents also cover warped/musical clips whose scalar speed is only a hint.
			stretchFactor: ((readClipLoop(clip)?.periodFrames ?? clip.durationFrames) / rate) / (clip.sourceDurationFrames / sourceRate),
			pitchSemitones: clip.linkPitchAndTempo ? 12 * Math.log2(clip.speedRatio ?? 1) : (clip.pitchCents ?? 0) / 100,
			fadeIn: (clip.fadeInFrames ?? 0) / rate, fadeOut: (clip.fadeOutFrames ?? 0) / rate,
			fadeInShapeId: selectedEndFadeShapePreset(clip.fadeInShape) ?? undefined,
			fadeOutShapeId: selectedEndFadeShapePreset(clip.fadeOutShape) ?? undefined,
			fadeInShape: clip.fadeInShape ?? 'linear', fadeOutShape: clip.fadeOutShape ?? 'linear',
			reversed: Boolean(clip.reversed), groupId: clip.groupId ?? undefined,
		};
	});
	const merge = <K extends keyof ClipPropertiesClip>(key: K): ClipPropertiesClip[K] | 'mixed' => {
		const value = views[0]?.[key];
		return views.every(clip => clip[key] === value) ? value : 'mixed';
	};
	const selection: ClipPropertiesSelection | null = views.length < 2 ? null : {
		count: views.length, trackNames: tracks.map(track => track.name), trackId: merge('trackId'),
		start: Math.min(...views.map(clip => clip.start)), end: Math.max(...views.map(clip => clip.start + clip.duration)),
		color: merge('color'), stretchFactor: merge('stretchFactor')!, pitchSemitones: merge('pitchSemitones')!,
		fadeIn: merge('fadeIn')!, fadeOut: merge('fadeOut')!, fadeInShapeId: merge('fadeInShapeId'), fadeOutShapeId: merge('fadeOutShapeId'),
		reversed: merge('reversed'),
	};
	return { clip: views[0] ?? null, selection, clips, tracks, locked: tracks.some(track => track.locked) };
}
