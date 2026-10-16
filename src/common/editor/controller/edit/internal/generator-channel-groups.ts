/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioGeneratorDocument, AudioGeneratorSelection, AudioGeneratorTrack } from './generator-project-view.ts';

export interface GeneratorChannelGroup {
	readonly channelCount: number;
	readonly selection: AudioGeneratorSelection | null;
	readonly track: AudioGeneratorTrack | null;
}

/** Default generation retains each selected lane's channel width. */
export function generatorChannelGroups(
	project: AudioGeneratorDocument,
	selection: AudioGeneratorSelection | null,
	focused: AudioGeneratorTrack | null,
	channelCount: number,
	requested: Readonly<{ trackId?: string | null; channelCount?: unknown }>,
	trackChannelCount: (project: AudioGeneratorDocument, track: AudioGeneratorTrack | null, fallback: number) => number,
): readonly GeneratorChannelGroup[] {
	if (!selection || focused?.type !== 'audio' || requested.trackId || requested.channelCount) {
		return [{ channelCount, selection, track: focused }];
	}
	const selectedIds = new Set(selection.trackIds ?? []);
	const targets = project.tracks.filter(track => track.type === 'audio' && selectedIds.has(track.id));
	if (!targets.length) return [{ channelCount, selection, track: focused }];
	const tracksByWidth = new Map<number, AudioGeneratorTrack[]>();
	for (const track of targets) {
		const width = trackChannelCount(project, track, project.masterChannels || 2);
		const tracks = tracksByWidth.get(width) ?? [];
		tracks.push(track);
		tracksByWidth.set(width, tracks);
	}
	return [...tracksByWidth].map(([width, tracks]) => ({
		channelCount: width,
		selection: { ...selection, trackIds: tracks.map(({ id }) => id) },
		track: tracks.find(({ id }) => id === focused.id) ?? tracks[0]!,
	}));
}
