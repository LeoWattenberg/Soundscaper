/* SPDX-License-Identifier: AGPL-3.0-only */

interface WaveformSourceIdentity {
	readonly id?: string;
	readonly storageKey?: string;
	readonly revision?: number | string;
	readonly updatedAt?: string;
	readonly committedAt?: string;
}

interface WaveformClipIdentity {
	readonly id?: string;
	readonly sourceId?: string;
	readonly revision?: number | string;
	readonly updatedAt?: string;
	readonly timelineStartFrame?: number;
	readonly sourceStartFrame?: number;
	readonly sourceDurationFrames?: number;
	readonly durationFrames?: number;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly reversed?: boolean;
	readonly envelope?: readonly Readonly<{ frame?: number; value?: number }>[];
}

export interface WaveformSourceWindow {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface WaveformPreviewRenderingKey {
	readonly showRms: boolean;
	readonly halfWave: boolean;
	readonly pixelsPerSecond: number;
	readonly pixelWidth: number;
	readonly reuseSummaryForCompatibility: boolean;
	readonly provideAudacitySpectrogram: boolean;
}

/**
 * Stable value key for committed waveform plans. Object identity remains a
 * separate fast guard; this key makes source/clip/window invalidation explicit.
 */
export function createWaveformPreviewCacheKey({
	source,
	clip,
	sourceWindow,
	rendering,
}: {
	readonly source: WaveformSourceIdentity | null | undefined;
	readonly clip: WaveformClipIdentity;
	readonly sourceWindow: WaveformSourceWindow;
	readonly rendering: WaveformPreviewRenderingKey;
}): string {
	return JSON.stringify([
		'waveform-preview-v1',
		source?.id ?? clip.sourceId ?? '',
		source?.storageKey ?? '',
		source?.revision ?? source?.updatedAt ?? source?.committedAt ?? '',
		clip.id ?? '',
		clip.revision ?? clip.updatedAt ?? '',
		clip.timelineStartFrame ?? 0,
		clip.sourceStartFrame ?? 0,
		clip.sourceDurationFrames ?? clip.durationFrames ?? 0,
		clip.durationFrames ?? 0,
		clip.gain ?? 1,
		clip.fadeInFrames ?? 0,
		clip.fadeOutFrames ?? 0,
		Boolean(clip.reversed),
		(clip.envelope ?? []).map((point) => [point.frame ?? 0, point.value ?? 1]),
		sourceWindow.startFrame,
		sourceWindow.endFrame,
		rendering.showRms,
		rendering.halfWave,
		rendering.pixelsPerSecond,
		rendering.pixelWidth,
		rendering.reuseSummaryForCompatibility,
		rendering.provideAudacitySpectrogram,
	]);
}
