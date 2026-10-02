/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo, useRef } from 'react';
import { AudacityWaveformCanvases } from '../timeline/TimelineCanvasRenderer.jsx';
import { createTimelineClipViewModel, type TimelineClipVisualData } from '../timeline/waveform-view-model.ts';
import { prepareFrequencyWaveformClipProjection } from '../timeline/frequency-waveform-projection.ts';
import { createSpectrogramCanvasOptions } from '../timeline/spectrogram-canvas-options.ts';
import { clipSourceSegments } from './clip-source-view.ts';
import type { AudioWarpRuntimeProject, AudioWarpRuntimeClip } from '../../audio-warp-runtime.ts';
import type { TrackDisplayMode } from '../../track-display-mode.ts';

export interface SourceWaveformClip extends AudioWarpRuntimeClip {
	readonly id: string;
	readonly sourceId: string;
	readonly title?: string;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly pitchCents?: number;
	readonly speedRatio?: number;
}
export interface SourceWaveformSource { readonly id: string; readonly name?: string; readonly frameCount: number; readonly sampleRate: number; readonly channelCount: number }
interface Props {
	readonly project: AudioWarpRuntimeProject;
	readonly clip: SourceWaveformClip;
	readonly source: SourceWaveformSource;
	readonly visual: TimelineClipVisualData;
	readonly width: number;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly displayMode: TrackDisplayMode;
	readonly verticalZoom: number;
	readonly selection: { readonly startFrame: number; readonly endFrame: number } | null;
	readonly copy: Readonly<Record<string, string>>;
}
export default function ClipSourceWaveforms({ project, clip, source, visual, width, startFrame, endFrame, displayMode, verticalZoom, selection, copy }: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const pixelsPerSecond = width * project.sampleRate / (endFrame - startFrame);
	const { buffer, peaks, pcmWindow, peakWindow, frequencyAnalysis, frequencyWindow } = visual;
	const stableVisual = useMemo(() => ({ source, buffer, peaks, pcmWindow, peakWindow, frequencyAnalysis, frequencyWindow }),
		[source, buffer, peaks, pcmWindow, peakWindow, frequencyAnalysis, frequencyWindow]);
	const models = useMemo(() => clipSourceSegments(clip, source, project.sampleRate).flatMap(segment => {
		const localStart = Math.max(0, startFrame - segment.timelineStartFrame);
		const localEnd = Math.min(segment.durationFrames, endFrame - segment.timelineStartFrame);
		if (localEnd <= localStart) return [];
		// Musical warp maps stay anchored to their original project tempo position.
		const waveformClip = { ...segment, timelineStartFrame: segment.active ? clip.timelineStartFrame : segment.timelineStartFrame,
			waveformStartFrame: localStart, waveformEndFrame: localEnd };
		const offset = waveformClip.timelineStartFrame - segment.timelineStartFrame;
		return [createTimelineClipViewModel({
			controller: { getClipVisualData: () => stableVisual }, sourceLookup: new Map([[source.id, source]]), project: { ...project },
			clip: waveformClip,
			geometry: { overscanStartFrame: startFrame + offset, pixelsPerSecond, sampleRate: project.sampleRate },
			selection: { selectedClipIds: segment.active ? segment.id : '' }, copy: { clip: copy.clip },
			rendering: { showRms: true, halfWave: displayMode === 'half-wave', color: 'blue',
				provideAudacitySpectrogram: displayMode === 'spectrogram' || displayMode === 'multiview',
				frequencyWaveformMode: displayMode === 'waveform-three-band' || displayMode === 'waveform-rainbow' ? displayMode : null,
				frequencyWaveformProjector: prepareFrequencyWaveformClipProjection },
		})];
	}), [clip, source, project, stableVisual, startFrame, endFrame, displayMode, pixelsPerSecond, copy.clip]);
	return <div ref={rootRef} className="audio-editor-source-waveforms" aria-hidden="true">
		{models.map(model => <div key={model.id} data-clip-id={model.id} className="clip-body clip-body--blue" data-source-active={model.selected} style={{ left: model.start * pixelsPerSecond, width: model.duration * pixelsPerSecond }}>
			<canvas className="clip-body__waveform" />
		</div>)}
		<AudacityWaveformCanvases rootRef={rootRef} clips={models} displayMode={displayMode} pixelsPerSecond={pixelsPerSecond}
			timeSelection={selection ? { startTime: (selection.startFrame - startFrame) / project.sampleRate, endTime: (selection.endFrame - startFrame) / project.sampleRate } : null}
			showRms halfWave={displayMode === 'half-wave'} verticalZoom={verticalZoom} channelHeightRatio={0.5}
			spectrogramOptions={createSpectrogramCanvasOptions({ scale: 'linear', maximumFrequency: source.sampleRate / 2 }, source.sampleRate)} />
	</div>;
}
