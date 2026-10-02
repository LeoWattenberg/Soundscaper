/* SPDX-License-Identifier: AGPL-3.0-only */
import { createTimelineClipViewModel, type TimelineClipVisualData, type TimelinePcmWindow } from '../timeline/waveform-view-model.ts';
import { pcmWindowCoversProjectedClip } from '../timeline/preview.ts';
import { prepareFrequencyWaveformClipProjection } from '../timeline/frequency-waveform-projection.ts';
import { clipDisplayFrameToSource } from '../../clip-source-timing.ts';
import { clipSourceSegments } from './clip-source-view.ts';
import type { ClipSourceProject, SourceSelection } from './clip-source-editor-types.ts';
import type { SourceWaveformClip, SourceWaveformSource } from './ClipSourceWaveforms.tsx';
import type { TrackDisplayMode } from '../../track-display-mode.ts';

interface Options {
	readonly project: Pick<ClipSourceProject, 'sampleRate' | 'tempoMap'>;
	readonly clip: SourceWaveformClip;
	readonly source: SourceWaveformSource;
	readonly visual: TimelineClipVisualData;
	readonly windows?: readonly TimelinePcmWindow[];
	readonly width: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly displayMode: TrackDisplayMode;
	readonly clipLabel: string;
}

/** Use the timeline's waveform projection, with private source-window requests. */
export function clipSourceWaveformModels({ project, clip, source, visual, windows = [], width, startFrame, endFrame, displayMode, clipLabel }: Options) {
	const pixelsPerSecond = width * project.sampleRate / (endFrame - startFrame);
	const requests: SourceSelection[] = [];
	const spectral = displayMode === 'spectrogram' || displayMode === 'multiview';
	const models = clipSourceSegments(clip, source, project.sampleRate).flatMap(segment => {
		const localStart = Math.max(0, startFrame - segment.timelineStartFrame);
		const localEnd = Math.min(segment.durationFrames, endFrame - segment.timelineStartFrame);
		if (localEnd <= localStart) return [];
		// Keep musical warp maps anchored to the original project tempo position.
		const waveformClip = { ...segment, timelineStartFrame: segment.active ? clip.timelineStartFrame : segment.timelineStartFrame,
			waveformStartFrame: localStart, waveformEndFrame: localEnd };
		const pcmWindow = windows.find(window => pcmWindowCoversProjectedClip(window, waveformClip, project)) ?? visual.pcmWindow;
		const offset = waveformClip.timelineStartFrame - segment.timelineStartFrame;
		const model = createTimelineClipViewModel({
			controller: { getClipVisualData: () => ({ ...visual, source, pcmWindow }) }, sourceLookup: new Map([[source.id, source]]), project,
			clip: waveformClip, geometry: { overscanStartFrame: startFrame + offset, pixelsPerSecond, sampleRate: project.sampleRate, minimumClipPixels: 0 },
			selection: { selectedClipIds: segment.active ? segment.id : '' }, copy: { clip: clipLabel },
			rendering: { showRms: true, halfWave: displayMode === 'half-wave', color: 'blue', provideAudacitySpectrogram: spectral,
				frequencyWaveformMode: displayMode === 'waveform-three-band' || displayMode === 'waveform-rainbow' ? displayMode : null,
				frequencyWaveformProjector: prepareFrequencyWaveformClipProjection },
			waveformPending: true,
		});
		if (!visual.buffer && !pcmWindowCoversProjectedClip(pcmWindow, waveformClip, project)
			&& (model.waveformPending || !model.audacityWaveform || spectral)) {
			const sourceAt = (local: number) => segment.active
				? clipDisplayFrameToSource(project, clip, source, segment.timelineStartFrame + local)
				: segment.sourceStartFrame + local / segment.durationFrames * segment.sourceDurationFrames;
			const first = sourceAt(localStart), last = sourceAt(localEnd);
			const range = { startFrame: Math.max(0, Math.floor(Math.min(first, last)) - 2), endFrame: Math.min(source.frameCount, Math.ceil(Math.max(first, last)) + 2) };
			if (range.endFrame - range.startFrame <= 262_144) requests.push(range);
		}
		return [model];
	});
	return { models, requests, pixelsPerSecond };
}
