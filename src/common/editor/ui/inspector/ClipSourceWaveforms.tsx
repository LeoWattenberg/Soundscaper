/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo, useRef } from 'react';
import { AudacityWaveformCanvases } from '../timeline/TimelineCanvasRenderer.jsx';
import type { TimelineClipVisualData } from '../timeline/waveform-view-model.ts';
import { createSpectrogramCanvasOptions } from '../timeline/spectrogram-canvas-options.ts';
import { useClipSourceAudioWindows } from './useClipSourceAudioWindows.ts';
import type { ClipSourceController } from './clip-source-editor-types.ts';
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
	readonly loadSourceAudioWindow?: ClipSourceController['actions']['effects']['loadSourceAudioWindow'];
	readonly onLoadError: (error: unknown) => void;
}
export default function ClipSourceWaveforms({ project, clip, source, visual, width, startFrame, endFrame, displayMode, verticalZoom, selection, copy, loadSourceAudioWindow, onLoadError }: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const pixelsPerSecond = width * project.sampleRate / (endFrame - startFrame);
	const { buffer, peaks, pcmWindow, peakWindow, frequencyAnalysis, frequencyWindow } = visual;
	const stableVisual = useMemo(() => ({ source, buffer, peaks, pcmWindow, peakWindow, frequencyAnalysis, frequencyWindow }),
		[source, buffer, peaks, pcmWindow, peakWindow, frequencyAnalysis, frequencyWindow]);
	const options = useMemo(() => ({ project, clip, source, visual: stableVisual, width,
		startFrame, endFrame, displayMode, clipLabel: copy.clip }), [project, clip, source, stableVisual, width, startFrame, endFrame, displayMode, copy.clip]);
	const plans = useClipSourceAudioWindows(options, loadSourceAudioWindow, onLoadError);
	const models = plans.models;
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
