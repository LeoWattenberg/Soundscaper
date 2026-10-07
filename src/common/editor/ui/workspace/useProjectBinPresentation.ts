/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { projectBinItems, projectBinWaveformPath, projectBinTransformBadges, formatProjectBinDuration } from './project-bin-model.ts';
import { projectBinVideoPreviewModel, projectBinVisualDurationFrames } from './project-bin-video-preview-model.ts';

type BinClip = NonNullable<Parameters<typeof projectBinItems>[0]>[number] & { readonly sourceId?: string };
type BinSource = Parameters<typeof projectBinTransformBadges>[1] & { readonly id: string };
const EMPTY_CLIPS: readonly BinClip[] = [];
const EMPTY_SOURCES: readonly BinSource[] = [];

/** Published document collections own these joins; playback progress does not. */
export function useProjectBinItems(clips: readonly BinClip[] = EMPTY_CLIPS) {
	return useMemo(() => projectBinItems(clips), [clips]);
}

export function useProjectBinSources(items: ReturnType<typeof projectBinItems>, sources: readonly BinSource[] = EMPTY_SOURCES) {
	return useMemo(() => {
		const sourceById = new Map(sources.map(source => [source.id, source]));
		const itemSources = new Map(items.map(item => [item.id, item.clips.map(clip => sourceById.get((clip as BinClip).sourceId ?? '') ?? null)]));
		return { sourceById, itemSources };
	}, [items, sources]);
}

export function useProjectBinWaveformPath(visual: Parameters<typeof projectBinWaveformPath>[0], clip: Parameters<typeof projectBinWaveformPath>[1]) {
	return useMemo(() => projectBinWaveformPath(visual, clip), [visual?.buffer, visual?.peaks, clip]);
}

export function useProjectBinTransformBadges(clips: readonly BinClip[], sources: readonly Parameters<typeof projectBinTransformBadges>[1][], copy: Parameters<typeof projectBinTransformBadges>[2]) {
	return useMemo(() => [...new Set(clips.flatMap((clip, index) => projectBinTransformBadges(clip, sources[index], copy)))], [clips, sources, copy]);
}

export function useProjectBinMediaTiming(project: Parameters<typeof projectBinVideoPreviewModel>[0], videoClip: Parameters<typeof projectBinVideoPreviewModel>[1], videoSource: Parameters<typeof projectBinVideoPreviewModel>[2], visualClip: Parameters<typeof projectBinVisualDurationFrames>[1]) {
	const videoPreview = useMemo(() => projectBinVideoPreviewModel(project, videoClip, videoSource), [project, videoClip, videoSource]);
	const visualDuration = useMemo(() => projectBinVisualDurationFrames(project, visualClip), [project, visualClip]);
	return { videoPreview, visualDuration };
}

export function useProjectBinDuration(durationFrames: number, sampleRate: number, locale: string) {
	return useMemo(() => formatProjectBinDuration(durationFrames, sampleRate, locale), [durationFrames, sampleRate, locale]);
}

/** Counts are document membership, independent of the preview's transport state. */
export function useProjectBinInstanceCount(count: (id: string) => number, id: string, timelineClips: unknown, binClips: unknown) {
	return useMemo(() => count(id), [count, id, timelineClips, binClips]);
}
