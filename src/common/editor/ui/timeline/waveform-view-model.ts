/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	framesToSeconds,
	prepareBoundedWaveformWindow,
	preparePeakPyramidWaveformWindow,
} from '../../design-system-adapters.js';
import { envelopeFramesToDesignPoints } from '../../automation.js';
import {
	audioWarpMinimumSourceSpanPerColumn,
	type AudioWarpRuntimeProject,
} from '../../audio-warp-runtime.ts';
import { audacityWaveformMode } from '../../audacity-waveform-renderer.js';
import {
	validateWaveformPeakLevels,
	waveformPeakLevelForResolution,
	WaveformPeakResolutionError,
} from '../../design-system-adapters/waveform-internals.ts';
import { WAVEFORM_PEAKS_VERSION } from '../../waveform-peak-contract.ts';
import { createWaveformPreviewCacheKey } from '../waveform-preview-cache.ts';
import {
	MINIMUM_VISIBLE_CLIP_PIXELS,
	pcmWindowCoversProjectedClip,
	peakWindowCoversProjectedClip,
	projectedClipVisibleSourceSamples,
	type PcmPreviewWindow,
} from './preview.ts';
import {
	prepareAudioWarpPeakPyramidWaveformWindow,
	prepareAudioWarpWaveformWindow,
} from './audio-warp-waveform.ts';

function usableWaveformPeakLevel(peaks: unknown, sourceSamplesPerPixel: number) {
	try {
		return waveformPeakLevelForResolution(peaks, sourceSamplesPerPixel);
	} catch {
		// A stale peak cache must not mask valid PCM or a newly fetched peak window.
		return null;
	}
}

function coarsePeakPreviewWidth(peaks: unknown, sourceSamples: number, displayWidth: number): number | null {
	try {
		const finestBlockSize = validateWaveformPeakLevels(peaks).levels[0]?.blockSize;
		if (!finestBlockSize || !(sourceSamples > 0) || !(displayWidth > 0)) return null;
		const width = Math.min(displayWidth, sourceSamples / finestBlockSize);
		return width < displayWidth ? width * (1 - 1e-9) : null;
	} catch {
		return null;
	}
}

function coarseWarpPeakPreviewWidth(
	peaks: unknown,
	project: AudioWarpRuntimeProject,
	clip: TimelineWaveformClip & Parameters<typeof audioWarpMinimumSourceSpanPerColumn>[1],
	displayWidth: number,
): number | null {
	try {
		const finestBlockSize = validateWaveformPeakLevels(peaks).levels[0]?.blockSize;
		if (!finestBlockSize || !(displayWidth > 0)) return null;
		let columnCount = Math.max(1, Math.ceil(displayWidth));
		while (true) {
			const minimumSpan = audioWarpMinimumSourceSpanPerColumn(project, clip, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
				columnCount,
			});
			if (minimumSpan >= finestBlockSize) {
				return columnCount < displayWidth ? columnCount * (1 - 1e-9) : null;
			}
			if (columnCount === 1) return null;
			columnCount = Math.max(1, Math.floor(columnCount / 2));
		}
	} catch {
		return null;
	}
}

// The clip header writes the pitch badge as semitones rounded to two decimals,
// so anything finer than half a cent reads as a bare '+0'. A shift that small
// has to reach the design system as no shift at all, or the badge appears and
// announces nothing.
const SMALLEST_BADGED_PITCH_CENTS = 0.5;
const EMPTY_DESIGN_SYSTEM_WAVEFORM = Object.freeze([]);

export interface TimelineWaveformSource {
	readonly id?: string;
	readonly storageKey?: string;
	readonly revision?: number | string;
	readonly updatedAt?: string;
	readonly committedAt?: string;
	readonly name?: string;
	readonly sampleRate?: number;
	readonly frameCount?: number;
	readonly channelCount?: number;
}

export interface TimelineWaveformClip {
	readonly id: string;
	readonly sourceId: string;
	readonly projectBinClipId?: string;
	readonly title?: string;
	readonly revision?: number | string;
	readonly updatedAt?: string;
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames?: number;
	readonly durationFrames: number;
	readonly waveformStartFrame: number;
	readonly waveformEndFrame: number;
	readonly gain?: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly reversed?: boolean;
	readonly pitchCents?: number;
	readonly kind?: unknown;
	readonly anchor?: unknown;
	readonly musicalStartBeat?: unknown;
	readonly musicalExtent?: unknown;
	readonly musicalDurationBeats?: unknown;
	readonly warpMap?: unknown;
	readonly envelope?: readonly Readonly<{ frame?: number; value?: number }>[];
}

export interface TimelineAudioBuffer {
	readonly numberOfChannels: number;
	getChannelData(channel: number): Float32Array;
}

export interface TimelinePcmWindow extends PcmPreviewWindow {
	readonly channels: readonly Float32Array[];
}

export interface TimelinePeakWindow {
	readonly sourceId?: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly blockSize: number;
	readonly channels: readonly Readonly<{
		minimums: ArrayLike<number>;
		maximums: ArrayLike<number>;
		rms: ArrayLike<number>;
	}>[];
}

export interface TimelineClipVisualData {
	readonly available?: boolean;
	readonly source?: TimelineWaveformSource | null;
	readonly buffer?: TimelineAudioBuffer | null;
	readonly pcmWindow?: TimelinePcmWindow | null;
	readonly peakWindow?: TimelinePeakWindow | null;
	readonly peaks?: unknown;
}

export interface TimelineClipVisualController {
	getClipVisualData(clipId: string): TimelineClipVisualData | null | undefined;
	getProjectBinClipVisualData?(clipId: string): TimelineClipVisualData | null | undefined;
}

export interface TimelineWaveformPlanData {
	readonly audacityWaveform?: unknown;
	readonly spectrogramWaveform?: unknown;
}

interface PreparedTimelineWaveform {
	readonly rendering: Readonly<Record<string, unknown>>;
	readonly channels: readonly ArrayLike<number>[];
}

export interface TimelineWaveformCacheEntry {
	readonly source: unknown;
	readonly signature: string;
	readonly data: TimelineWaveformPlanData;
}

export interface TimelineClipViewModel {
	readonly id: string;
	readonly sourceId: string;
	readonly name: string;
	readonly start: number;
	readonly duration: number;
	readonly selected: boolean;
	readonly color: string;
	readonly trimStart: number;
	readonly fullDuration: number;
	readonly stretchFactor: number;
	readonly pitchCents: number;
	readonly envelopePoints: unknown;
	readonly waveform: readonly never[];
	audacityWaveform?: unknown;
	spectrogramWaveform?: unknown;
	waveformError?: string;
	waveformPending?: boolean;
}

export interface TimelineClipViewModelOptions {
	readonly controller: TimelineClipVisualController;
	readonly sourceLookup: ReadonlyMap<string, TimelineWaveformSource>;
	readonly clip: TimelineWaveformClip;
	readonly geometry: Readonly<{
		overscanStartFrame: number;
		pixelsPerSecond: number;
		sampleRate: number;
	}>;
	readonly project?: (AudioWarpRuntimeProject & Readonly<Record<string, unknown>>) | null;
	readonly selection: Readonly<{
		selectedClipIds: Set<string> | string | null | undefined;
	}>;
	readonly copy: Readonly<{ clip: string }>;
	readonly rendering: Readonly<{
		showRms?: boolean;
		halfWave?: boolean;
		color?: string;
		reuseSummaryForCompatibility?: boolean;
		allowPeakPyramid?: boolean;
		provideAudacitySpectrogram?: boolean;
	}>;
	readonly cache?: Map<string, TimelineWaveformCacheEntry> | null;
	readonly reuseCachedWaveform?: boolean;
	readonly waveformPending?: boolean;
}

/** Read a stored shift the way the header badge rounds it, so the two agree. */
function badgedPitchCents(cents: number | undefined): number {
	const shift = Number(cents) || 0;
	return Math.abs(shift) < SMALLEST_BADGED_PITCH_CENTS ? 0 : shift;
}

/** Build the design-system clip projection while owning waveform-plan caching. */
export function createTimelineClipViewModel({
	controller,
	sourceLookup,
	clip,
	geometry,
	project = null,
	selection,
	copy,
	rendering,
	cache = null,
	reuseCachedWaveform = false,
	waveformPending = false,
}: TimelineClipViewModelOptions): TimelineClipViewModel {
	const { overscanStartFrame, pixelsPerSecond, sampleRate } = geometry;
	const {
		showRms = false,
		halfWave = false,
		color = 'blue',
		reuseSummaryForCompatibility = false,
		allowPeakPyramid = true,
		provideAudacitySpectrogram = false,
	} = rendering;
	const visual = controller.getClipVisualData(clip.id)
		|| controller.getProjectBinClipVisualData?.(clip.projectBinClipId || clip.id);
	const source = visual?.source || sourceLookup.get(clip.sourceId);
	const sourceRate = Number(source?.sampleRate) > 0 ? Number(source?.sampleRate) : sampleRate;
	const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
	const selectedClipIds = selection.selectedClipIds;
	const selected = selectedClipIds instanceof Set
		? selectedClipIds.has(clip.id)
		: selectedClipIds === clip.id;
	const sourceName = typeof source?.name === 'string' ? source.name : '';
	const title = typeof clip.title === 'string' ? clip.title.trim() : '';
	const generatedTitle = sourceName.replace(/\.[^./\\]+$/, '');
	const output: TimelineClipViewModel = {
		id: clip.id,
		sourceId: clip.sourceId,
		// Imported clips begin with a title derived from the source filename. Keep
		// showing the original source label until that generated title is renamed.
		name: title && title !== generatedTitle ? title : sourceName || title || copy.clip,
		start: framesToSeconds(
			Math.max(0, Math.max(clip.timelineStartFrame, overscanStartFrame) - overscanStartFrame),
			{ sampleRate },
		),
		duration: Math.max(
			framesToSeconds(clip.waveformEndFrame - clip.waveformStartFrame, { sampleRate }),
			MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
		),
		selected,
		color,
		trimStart: framesToSeconds(clip.waveformStartFrame, { sampleRate }),
		fullDuration: sourceDurationFrames / sourceRate,
		stretchFactor: (clip.durationFrames / sampleRate) / (sourceDurationFrames / sourceRate),
		// The clip header draws a pitch badge beside the time-stretch one, so the
		// shift the pitch commands step has to reach the design system too.
		pitchCents: badgedPitchCents(clip.pitchCents),
		envelopePoints: envelopeFramesToDesignPoints(clip.envelope, sampleRate, {
			startFrame: clip.waveformStartFrame,
			endFrame: clip.waveformEndFrame,
		}),
		waveform: EMPTY_DESIGN_SYSTEM_WAVEFORM,
	};
	const waveformBuffer = visual?.buffer || null;
	const waveformPcmWindow = pcmWindowCoversProjectedClip(visual?.pcmWindow, clip, project)
		? visual?.pcmWindow || null
		: null;
	const waveformPeaks = allowPeakPyramid ? visual?.peaks : null;
	const isWarped = clip.warpMap != null;
	const visibleSourceSamples = projectedClipVisibleSourceSamples(clip, project);
	const pixelWidth = output.duration * pixelsPerSecond;
	const waveformPeakWindow = allowPeakPyramid
		&& peakWindowCoversProjectedClip(visual?.peakWindow, clip, project, pixelWidth)
		? visual?.peakWindow || null
		: null;
	const peakWindowPyramid = waveformPeakWindow ? {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: waveformPeakWindow.channels.length,
		levels: [{ blockSize: waveformPeakWindow.blockSize, channels: waveformPeakWindow.channels }],
	} : null;
	const cached = cache?.get(String(clip.id));
	const cachedPlan = cached?.data.audacityWaveform as Readonly<{
		sourceId?: string;
		startFrame: number;
		endFrame: number;
		pixelWidth: number;
		peakBlockSize?: number;
	}> | undefined;
	if (reuseCachedWaveform && cached && cachedPlan && cachedPlan.sourceId === clip.sourceId
		&& (!cachedPlan.peakBlockSize || (
			cachedPlan.startFrame === clip.waveformStartFrame
			&& cachedPlan.endFrame === clip.waveformEndFrame
			&& pixelWidth <= cachedPlan.pixelWidth
		))) {
		Object.assign(output, cached.data);
		return output;
	}
	try {
		const exactWaveformSource = waveformBuffer || waveformPcmWindow;
		const sourceSamplesPerPixel = isWarped && !exactWaveformSource
			&& (waveformPeaks || peakWindowPyramid) && visibleSourceSamples > 0 && pixelWidth > 0
			? audioWarpMinimumSourceSpanPerColumn(
				project as AudioWarpRuntimeProject,
				clip as Parameters<typeof audioWarpMinimumSourceSpanPerColumn>[1],
				{
					startFrame: clip.waveformStartFrame,
					endFrame: clip.waveformEndFrame,
					columnCount: Math.max(1, Math.ceil(pixelWidth)),
				},
			)
			: visibleSourceSamples / pixelWidth;
		const peakLevel = waveformPeaks && sourceSamplesPerPixel > 0
			? usableWaveformPeakLevel(waveformPeaks, sourceSamplesPerPixel)
			: null;
		const peakWindowLevel = peakWindowPyramid && sourceSamplesPerPixel > 0
			? usableWaveformPeakLevel(peakWindowPyramid, sourceSamplesPerPixel)
			: null;
		const summaryMode = audacityWaveformMode(pixelWidth / visibleSourceSamples) === 'summary';
		const usePeakPyramid = Boolean(peakLevel && summaryMode && (!isWarped || !exactWaveformSource));
		const usePeakWindow = Boolean(!usePeakPyramid && !exactWaveformSource && peakWindowLevel && summaryMode);
		const previewWidth = waveformPending && !exactWaveformSource
			&& !usePeakPyramid && !usePeakWindow && waveformPeaks
			? isWarped
				? coarseWarpPeakPreviewWidth(
					waveformPeaks,
					project as AudioWarpRuntimeProject,
					clip as TimelineWaveformClip & Parameters<typeof audioWarpMinimumSourceSpanPerColumn>[1],
					pixelWidth,
				)
				: coarsePeakPreviewWidth(waveformPeaks, visibleSourceSamples, pixelWidth)
			: null;
		const waveformSource = usePeakPyramid
			? waveformPeaks
			: exactWaveformSource || (usePeakWindow ? waveformPeakWindow : previewWidth ? waveformPeaks : null);
		const waveformPeakSource = usePeakPyramid || previewWidth ? waveformPeaks : peakWindowPyramid;
		const waveformPeakSourceFrameOffset = usePeakWindow ? waveformPeakWindow?.startFrame ?? 0 : 0;
		if (!waveformSource) {
			if ((waveformPending || waveformPeaks || waveformPeakWindow) && visibleSourceSamples > 0) {
				output.waveformPending = true;
			}
			return output;
		}
		const cacheSignature = createWaveformPreviewCacheKey({
			source,
			clip: { ...clip, sourceDurationFrames },
			sourceWindow: {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
			},
			rendering: {
				showRms,
				halfWave,
				pixelsPerSecond,
				pixelWidth,
				reuseSummaryForCompatibility,
				provideAudacitySpectrogram,
			},
		});
		if (cached?.source === waveformSource && cached.signature === cacheSignature) {
			Object.assign(output, cached.data);
			if (previewWidth) output.waveformPending = true;
			return output;
		}
		const maximumSamples = Math.max(32, Math.min(4096, Math.ceil(pixelWidth) * 2));
		const usesPcm = waveformSource === waveformBuffer || waveformSource === waveformPcmWindow;
		const pcmChannels = waveformSource === waveformBuffer
			? Array.from(
				{ length: waveformBuffer.numberOfChannels },
				(_, channel) => waveformBuffer.getChannelData(channel),
			)
			: waveformPcmWindow?.channels;
		const waveform = (usesPcm
			? clip.warpMap != null
				? prepareAudioWarpWaveformWindow(
					project as unknown as Parameters<typeof prepareAudioWarpWaveformWindow>[0],
					clip as Parameters<typeof prepareAudioWarpWaveformWindow>[1],
					Array.from(pcmChannels || []),
					{
						startFrame: clip.waveformStartFrame,
						endFrame: clip.waveformEndFrame,
						maxSamples: maximumSamples,
						pixelWidth,
						sourceFrameOffset: waveformSource === waveformPcmWindow
							? waveformPcmWindow?.startFrame ?? 0
							: 0,
					},
				)
				: prepareBoundedWaveformWindow(Array.from(pcmChannels || []), clip, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
				maxSamples: maximumSamples,
				pixelWidth,
				sourceFrameOffset: waveformSource === waveformPcmWindow ? waveformPcmWindow?.startFrame ?? 0 : 0,
				reuseSummaryForCompatibility,
			})
			: isWarped
				? prepareAudioWarpPeakPyramidWaveformWindow(
					project as unknown as Parameters<typeof prepareAudioWarpPeakPyramidWaveformWindow>[0],
					clip as Parameters<typeof prepareAudioWarpPeakPyramidWaveformWindow>[1],
					waveformPeakSource,
					{
						startFrame: clip.waveformStartFrame,
						endFrame: clip.waveformEndFrame,
						maxSamples: maximumSamples,
						pixelWidth: previewWidth ?? pixelWidth,
						channelCount: Math.max(1, Math.min(2, Number(source?.channelCount) || 1)),
						sourceFrameCount: source?.frameCount,
						sourceFrameOffset: waveformPeakSourceFrameOffset,
					},
				)
				: preparePeakPyramidWaveformWindow(
					waveformPeakSource as Parameters<typeof preparePeakPyramidWaveformWindow>[0],
					clip,
					{
						startFrame: clip.waveformStartFrame,
						endFrame: clip.waveformEndFrame,
						maxSamples: maximumSamples,
						pixelWidth: previewWidth ?? pixelWidth,
						channelCount: Math.max(1, Math.min(2, Number(source?.channelCount) || 1)),
						sourceFrameCount: source?.frameCount,
						sourceFrameOffset: waveformPeakSourceFrameOffset,
					},
				)) as unknown as PreparedTimelineWaveform;
		const waveformData: TimelineWaveformPlanData = {
			audacityWaveform: {
				...waveform.rendering,
				sourceId: clip.sourceId,
				durationFrames: clip.durationFrames,
				envelope: clip.envelope || [],
			},
			...(provideAudacitySpectrogram
				? { spectrogramWaveform: waveform.channels.map((channel: ArrayLike<number>) => Array.from(channel)) }
				: {}),
		};
		cache?.set(String(clip.id), {
			source: waveformSource,
			signature: cacheSignature,
			data: waveformData,
		});
		Object.assign(output, waveformData);
		if (previewWidth) output.waveformPending = true;
	} catch (error) {
		if (error instanceof WaveformPeakResolutionError) output.waveformPending = true;
		else output.waveformError = error instanceof Error ? error.message : String(error);
	}
	return output;
}
