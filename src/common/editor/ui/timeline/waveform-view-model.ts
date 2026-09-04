/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	framesToSeconds,
	prepareBoundedWaveformWindow,
	preparePeakPyramidWaveformWindow,
} from '../../design-system-adapters.js';
import { envelopeFramesToDesignPoints } from '../../automation.js';
import { audacityWaveformMode } from '../../audacity-waveform-renderer.js';
import { createWaveformPreviewCacheKey } from '../waveform-preview-cache.ts';
import { pcmWindowCoversProjectedClip, type PcmPreviewWindow } from './preview.ts';
import {
	prepareAudioWarpPeakPyramidWaveformWindow,
	prepareAudioWarpWaveformWindow,
} from './audio-warp-waveform.ts';

const MINIMUM_VISIBLE_CLIP_PIXELS = 48;
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

export interface TimelineClipVisualData {
	readonly source?: TimelineWaveformSource | null;
	readonly buffer?: TimelineAudioBuffer | null;
	readonly pcmWindow?: TimelinePcmWindow | null;
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
	readonly project?: Readonly<Record<string, unknown>> | null;
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
	const waveformPcmWindow = pcmWindowCoversProjectedClip(visual?.pcmWindow, clip)
		? visual?.pcmWindow || null
		: null;
	const waveformPeaks = allowPeakPyramid ? visual?.peaks : null;
	const isWarped = clip.warpMap != null;
	const visibleSourceSamples = (clip.waveformEndFrame - clip.waveformStartFrame)
		* sourceDurationFrames / clip.durationFrames;
	const pixelWidth = output.duration * pixelsPerSecond;
	const usePeakPyramid = Boolean(waveformPeaks && visibleSourceSamples > 0
		&& audacityWaveformMode(pixelWidth / visibleSourceSamples) === 'summary');
	const waveformSource = usePeakPyramid
		? waveformPeaks
		: waveformBuffer || waveformPcmWindow || (isWarped ? null : waveformPeaks);
	const cached = cache?.get(String(clip.id));
	if (reuseCachedWaveform && cached?.data.audacityWaveform) {
		Object.assign(output, cached.data);
		return output;
	}
	if (!waveformSource) return output;
	try {
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
					visual?.peaks,
					{
						startFrame: clip.waveformStartFrame,
						endFrame: clip.waveformEndFrame,
						maxSamples: maximumSamples,
						pixelWidth,
						channelCount: Math.max(1, Math.min(2, Number(source?.channelCount) || 1)),
						sourceFrameCount: source?.frameCount,
					},
				)
				: preparePeakPyramidWaveformWindow(
					visual?.peaks as Parameters<typeof preparePeakPyramidWaveformWindow>[0],
					clip,
					{
						startFrame: clip.waveformStartFrame,
						endFrame: clip.waveformEndFrame,
						maxSamples: maximumSamples,
						pixelWidth,
						channelCount: Math.max(1, Math.min(2, Number(source?.channelCount) || 1)),
						sourceFrameCount: source?.frameCount,
					},
				)) as unknown as PreparedTimelineWaveform;
		const waveformData: TimelineWaveformPlanData = {
			audacityWaveform: {
				...waveform.rendering,
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
	} catch (error) {
		output.waveformError = error instanceof Error ? error.message : String(error);
	}
	return output;
}
