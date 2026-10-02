/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioWarpRuntimeProject } from '../../audio-warp-runtime.ts';
import type { SignatureMap } from '../../musical-grid.ts';
import type { TimelineClipVisualData, TimelineAudioBuffer, TimelinePcmWindow } from '../timeline/waveform-view-model.ts';
import type { SourceWaveformClip, SourceWaveformSource } from './ClipSourceWaveforms.tsx';

export interface ClipSourceProject extends AudioWarpRuntimeProject {
	readonly id: string;
	readonly clips: readonly SourceWaveformClip[];
	readonly sources: readonly SourceWaveformSource[];
	readonly signatureMap?: SignatureMap;
}
export interface SourceSelection { readonly startFrame: number; readonly endFrame: number }
export interface SourcePreviewState {
	readonly clipId: string | null;
	readonly focused: boolean;
	readonly state: 'stopped' | 'paused' | 'playing' | 'loading';
	readonly positionFrame: number;
	readonly loop: boolean;
	readonly loopRange: SourceSelection | null;
}
export interface ClipSourceController {
	getClipVisualData(clipId: string): TimelineClipVisualData | null | undefined;
	readonly actions: {
		readonly clip: { update(clipId: string, changes: Readonly<Record<string, unknown>>): unknown };
		readonly audioWarp: {
			addSourceMarker(clipId: string, sourceFrame: number): unknown;
			moveSourceMarker(clipId: string, pointIndex: number, clipRelativeFrame: number): unknown;
			deleteSourceMarker(clipId: string, pointIndex: number): unknown;
		};
		readonly effects: {
			setSourceSelection(selection: (SourceSelection & { readonly clipId: string }) | null): unknown;
			loadSourceAudio?(clipId: string): Promise<TimelineAudioBuffer>;
			loadSourceAudioWindow?(clipId: string, range: SourceSelection & { readonly signal?: AbortSignal }): Promise<TimelinePcmWindow | null>;
		};
		readonly timeline: { requestFrequencyWaveform?(clipId: string): Promise<unknown> };
		readonly clipSourcePreview: {
			focus(clipId: string): unknown;
			blur(): unknown;
			playPause(clipId: string): unknown;
			stop(): unknown;
			seek(frame: number): unknown;
			setLoop(enabled: boolean): unknown;
			setLoopRange(range: SourceSelection | null): unknown;
			setSelection(selection: SourceSelection | null): unknown;
			snapshot(): SourcePreviewState;
			subscribe(listener: () => void): () => void;
			trim(clipId: string, changes: Readonly<Record<string, number>>): unknown;
		};
	};
}
