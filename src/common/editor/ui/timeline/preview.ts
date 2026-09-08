/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audioWarpSourceRange,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import { framesToSeconds } from '../../design-system-adapters.js';

const MINIMUM_VISIBLE_CLIP_PIXELS = 48;
const EMPTY_DESIGN_SYSTEM_WAVEFORM = Object.freeze([]);

export type RecordingPeakChannel = readonly number[] | Float32Array;

export interface ProjectedPreviewClip {
	readonly id: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame?: number;
	readonly sourceDurationFrames?: number;
	readonly waveformStartFrame: number;
	readonly waveformEndFrame: number;
	readonly reversed?: boolean;
}

export interface RecordingPreview {
	readonly channels?: readonly RecordingPeakChannel[];
}

export interface RecordingWaveformRendering {
	readonly mode: 'summary';
	readonly pixelWidth: number;
	readonly pixelsPerSample: 0;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameCount: number;
	readonly durationFrames: number;
	readonly envelope: readonly never[];
	readonly channels: readonly Readonly<{
		minimum: Float32Array;
		maximum: Float32Array;
		rms: null;
	}>[];
}

export interface RecordingDesignClip {
	readonly id: string;
	readonly name: string;
	readonly start: number;
	readonly duration: number;
	readonly selected: false;
	readonly trimStart: number;
	readonly fullDuration: number;
	readonly stretchFactor: 1;
	readonly waveform: readonly never[];
	audacityWaveform?: RecordingWaveformRendering;
	spectrogramWaveform?: readonly RecordingPeakChannel[];
}

export interface PcmPreviewWindow {
	readonly channels?: readonly ArrayLike<number>[];
	readonly startFrame: number;
	readonly endFrame: number;
}

export function recordingPreviewId(trackId: string): string {
	return `recording-preview-${trackId}`;
}

export function toDesignRecordingPreview(
	clip: ProjectedPreviewClip,
	preview: RecordingPreview | null | undefined,
	overscanStartFrame: number,
	pixelsPerSecond: number,
	sampleRate: number,
	copy: Readonly<{ recordingLabel: string }>,
	provideAudacitySpectrogram = false,
): RecordingDesignClip {
	const output: RecordingDesignClip = {
		id: clip.id,
		name: copy.recordingLabel,
		start: framesToSeconds(
			Math.max(0, Math.max(clip.timelineStartFrame, overscanStartFrame) - overscanStartFrame),
			{ sampleRate },
		),
		duration: Math.max(
			framesToSeconds(clip.waveformEndFrame - clip.waveformStartFrame, { sampleRate }),
			MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
		),
		selected: false,
		trimStart: framesToSeconds(clip.waveformStartFrame, { sampleRate }),
		fullDuration: framesToSeconds(clip.durationFrames, { sampleRate }),
		stretchFactor: 1,
		waveform: EMPTY_DESIGN_SYSTEM_WAVEFORM,
	};
	if (!preview?.channels?.length) return output;
	const waveformChannels = preview.channels.map((channel) => recordingPreviewWaveformWindow(channel, clip));
	output.audacityWaveform = prepareRecordingPreviewWaveform(
		waveformChannels,
		clip,
		output.duration * pixelsPerSecond,
	);
	if (provideAudacitySpectrogram) output.spectrogramWaveform = waveformChannels;
	return output;
}

export function recordingPreviewWaveformWindow(
	channel: RecordingPeakChannel | null | undefined,
	clip: Pick<ProjectedPreviewClip, 'durationFrames' | 'waveformStartFrame' | 'waveformEndFrame'>,
): number[] {
	if (!channel?.length || !clip.durationFrames) return [];
	const pairCount = Math.max(1, Math.floor(channel.length / 2));
	const startPair = Math.max(
		0,
		Math.min(pairCount - 1, Math.floor(clip.waveformStartFrame / clip.durationFrames * pairCount)),
	);
	const endPair = Math.max(
		startPair + 1,
		Math.min(pairCount, Math.ceil(clip.waveformEndFrame / clip.durationFrames * pairCount)),
	);
	return Array.from(channel.slice(startPair * 2, endPair * 2));
}

export function prepareRecordingPreviewWaveform(
	channels: readonly RecordingPeakChannel[],
	clip: Pick<ProjectedPreviewClip, 'durationFrames' | 'waveformStartFrame' | 'waveformEndFrame'>,
	pixelWidth: number,
): RecordingWaveformRendering {
	const columnCount = Math.max(1, Math.ceil(pixelWidth));
	return {
		mode: 'summary',
		pixelWidth,
		pixelsPerSample: 0,
		startFrame: clip.waveformStartFrame,
		endFrame: clip.waveformEndFrame,
		frameCount: clip.waveformEndFrame - clip.waveformStartFrame,
		durationFrames: clip.durationFrames,
		envelope: [],
		channels: channels.map((channel) => {
			const pairCount = Math.max(1, Math.floor(channel.length / 2));
			const minimum = new Float32Array(columnCount);
			const maximum = new Float32Array(columnCount);
			for (let column = 0; column < columnCount; column += 1) {
				let pairStart: number;
				let pairEnd: number;
				if (pairCount >= columnCount) {
					pairStart = Math.round(column * pairCount / columnCount);
					pairEnd = Math.max(pairStart + 1, Math.round((column + 1) * pairCount / columnCount));
				} else {
					pairStart = Math.floor(column * pairCount / columnCount);
					pairEnd = pairStart + 1;
				}
				pairEnd = Math.min(pairCount, pairEnd);
				let bucketMinimum = Number.POSITIVE_INFINITY;
				let bucketMaximum = Number.NEGATIVE_INFINITY;
				for (let pair = pairStart; pair < pairEnd; pair += 1) {
					bucketMinimum = Math.min(bucketMinimum, Number(channel[pair * 2]) || 0);
					bucketMaximum = Math.max(bucketMaximum, Number(channel[pair * 2 + 1]) || 0);
				}
				if (column > 0 && minimum[column - 1] > bucketMaximum) bucketMaximum = minimum[column - 1];
				if (column > 0 && maximum[column - 1] < bucketMinimum) bucketMinimum = maximum[column - 1];
				minimum[column] = bucketMinimum;
				maximum[column] = bucketMaximum;
			}
			return { minimum, maximum, rms: null };
		}),
	};
}

export function pcmWindowCoversProjectedClip(
	window: PcmPreviewWindow | null | undefined,
	clip: Pick<
		ProjectedPreviewClip,
		'id' | 'timelineStartFrame' | 'durationFrames' | 'sourceDurationFrames' | 'sourceStartFrame'
		| 'waveformStartFrame' | 'waveformEndFrame' | 'reversed'
	> & Readonly<{
		kind?: unknown;
		anchor?: unknown;
		warpMap?: unknown;
	}>,
	project: AudioWarpRuntimeProject | null | undefined = null,
): boolean {
	if (!window?.channels?.length) return false;
	const range = projectedClipSourceRange(clip, project);
	if (range === null) return false;
	return window.startFrame <= Math.floor(range.startFrame)
		&& window.endFrame >= Math.ceil(range.endFrame);
}

export function projectedClipVisibleSourceSamples(
	clip: Parameters<typeof pcmWindowCoversProjectedClip>[1],
	project: AudioWarpRuntimeProject | null | undefined = null,
): number {
	const range = projectedClipSourceRange(clip, project);
	return range === null ? 0 : range.endFrame - range.startFrame;
}

function projectedClipSourceRange(
	clip: Parameters<typeof pcmWindowCoversProjectedClip>[1],
	project: AudioWarpRuntimeProject | null | undefined,
): Readonly<{ startFrame: number; endFrame: number }> | null {
	const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
	if (clip.warpMap != null) {
		if (!project) return null;
		try {
			return audioWarpSourceRange(project, {
				...clip,
				sourceStartFrame: clip.sourceStartFrame ?? 0,
				sourceDurationFrames,
			}, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
			});
		} catch {
			return null;
		}
	}
	const sourceFramesPerTimelineFrame = sourceDurationFrames / clip.durationFrames;
	const visualStart = clip.waveformStartFrame * sourceFramesPerTimelineFrame;
	const visualEnd = clip.waveformEndFrame * sourceFramesPerTimelineFrame;
	const sourceStartFrame = clip.sourceStartFrame ?? 0;
	const absoluteStart = sourceStartFrame + (clip.reversed
		? sourceDurationFrames - visualEnd
		: visualStart);
	const absoluteEnd = sourceStartFrame + (clip.reversed
		? sourceDurationFrames - visualStart
		: visualEnd);
	return Object.freeze({
		startFrame: Math.min(absoluteStart, absoluteEnd),
		endFrame: Math.max(absoluteStart, absoluteEnd),
	});
}
