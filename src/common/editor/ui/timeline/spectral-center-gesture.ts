/* SPDX-License-Identifier: AGPL-3.0-only */

import { calculateAudioSpectrum } from '../../audio-spectrum.ts';
import {
	spectrogramFrequencyAtFraction,
	spectrogramFrequencyFraction,
	spectrogramScaleValue,
	type SpectrogramScale,
} from './geometry.ts';
import type { TimelineClipVisualController, TimelineWaveformClip } from './waveform-view-model.ts';

interface FrequencyBand {
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
}

function frequencyAt(position: number, scale: SpectrogramScale, minimum: number, maximum: number): number {
	if (scale === 'linear') return minimum + position * (maximum - minimum);
	if (position <= 0) return minimum;
	if (position >= 1) return maximum;
	return spectrogramFrequencyAtFraction(position, scale, minimum, maximum);
}

export function spectralBandCenter(band: FrequencyBand, scale: SpectrogramScale, minimum: number, maximum: number): number {
	const low = spectrogramFrequencyFraction(band.minimumFrequency, scale, minimum, maximum);
	const high = spectrogramFrequencyFraction(band.maximumFrequency, scale, minimum, maximum);
	return frequencyAt((low + high) / 2, scale, minimum, maximum);
}

/** Audacity moves both edges by the same distance in the displayed frequency scale. */
export function moveSpectralBandCenter<T extends FrequencyBand>(
	band: T, requestedCenter: number, scale: SpectrogramScale, minimum: number, maximum: number,
): T {
	if (scale === 'linear') {
		const width = Math.min(maximum - minimum, Math.max(0, band.maximumFrequency - band.minimumFrequency));
		const start = Math.max(minimum, Math.min(maximum - width, requestedCenter - width / 2));
		return { ...band, minimumFrequency: start, maximumFrequency: start + width };
	}
	const extent = spectrogramScaleValue(maximum, scale) - spectrogramScaleValue(minimum, scale);
	const bandWidth = spectrogramScaleValue(band.maximumFrequency, scale) - spectrogramScaleValue(band.minimumFrequency, scale);
	const width = Math.max(0, Math.min(1, bandWidth / extent));
	const center = spectrogramFrequencyFraction(requestedCenter, scale, minimum, maximum);
	const start = Math.max(0, Math.min(1 - width, center - width / 2));
	return {
		...band,
		minimumFrequency: frequencyAt(start, scale, minimum, maximum),
		maximumFrequency: frequencyAt(start + width, scale, minimum, maximum),
	};
}

export function snapSpectralCenterToPeak(frequency: number, peaks: readonly number[]): number {
	let nearest = frequency;
	let distance = Infinity;
	for (const peak of peaks) {
		const candidateDistance = Math.abs(peak - frequency);
		if (candidateDistance < distance) {
			nearest = peak;
			distance = candidateDistance;
		}
	}
	return nearest;
}

/** Average independent channel/window power so opposite-phase channels retain their peaks. */
export function spectralSelectionPeaks(channels: readonly Float32Array[], sampleRate: number, size = 2_048): number[] {
	if (!channels.length || !channels[0]?.length || sampleRate <= 0) return [];
	const power = new Float64Array(size / 2 + 1);
	for (const channel of channels.slice(0, 2)) {
		const last = Math.max(0, channel.length - size);
		for (const offsetFrame of new Set([0, Math.floor(last / 2), last])) {
			const spectrum = calculateAudioSpectrum([channel], sampleRate, { size, offsetFrame });
			for (let index = 0; index < spectrum.bins.length; index += 1) {
				power[index] = (power[index] ?? 0) + (spectrum.bins[index]?.amplitude ?? 0) ** 2;
			}
		}
	}
	const maximum = Math.max(...power);
	if (maximum < 1e-12) return [];
	const peaks = [];
	for (let index = 1; index < power.length - 1; index += 1) {
		const value = power[index] ?? 0;
		if (value > maximum * 1e-4 && value > (power[index - 1] ?? 0) && value >= (power[index + 1] ?? 0)) {
			const left = Math.log(Math.max(1e-30, power[index - 1] ?? 0));
			const center = Math.log(value);
			const right = Math.log(Math.max(1e-30, power[index + 1] ?? 0));
			const curvature = left - 2 * center + right;
			const offset = curvature === 0 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / curvature));
			peaks.push((index + (Math.abs(offset) < 0.01 ? 0 : offset)) * sampleRate / size);
		}
	}
	return peaks;
}

/** Inspect only selected PCM, with bounded FFT windows, once at the beginning of a drag. */
export function selectedTrackSpectralPeaks(
	controller: TimelineClipVisualController,
	clips: readonly TimelineWaveformClip[],
	selection: Readonly<{ startFrame: number; endFrame: number }>,
	sampleRate: number,
	size = 2_048,
): number[] {
	const peaks: number[] = [];
	const selectedClips = clips.filter(clip => clip.timelineStartFrame < selection.endFrame
		&& clip.timelineStartFrame + clip.durationFrames > selection.startFrame);
	for (const clip of selectedClips.slice(0, 8)) {
		const start = Math.max(selection.startFrame, clip.timelineStartFrame);
		const end = Math.min(selection.endFrame, clip.timelineStartFrame + clip.durationFrames);
		if (end <= start || clip.durationFrames <= 0) continue;
		const visual = controller.getClipVisualData(clip.id);
		if (!visual) continue;
		const ratio = (clip.sourceDurationFrames || clip.durationFrames) / clip.durationFrames;
		const localStart = (start - clip.timelineStartFrame) * ratio;
		const localEnd = (end - clip.timelineStartFrame) * ratio;
		const sourceDuration = clip.sourceDurationFrames || clip.durationFrames;
		const sourceStart = clip.sourceStartFrame + (clip.reversed ? sourceDuration - localEnd : localStart);
		const sourceEnd = clip.sourceStartFrame + (clip.reversed ? sourceDuration - localStart : localEnd);
		const window = visual.pcmWindow;
		const buffer = visual.buffer;
		const offset = buffer ? 0 : window?.startFrame ?? 0;
		const channels = buffer
			? Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index))
			: window?.channels ?? [];
		const selectedChannels = channels.map(channel => channel.subarray(
			Math.max(0, Math.floor(sourceStart - offset)), Math.max(0, Math.ceil(sourceEnd - offset)),
		));
		const effectiveRate = sampleRate * ratio * 2 ** ((clip.pitchCents || 0) / 1_200);
		peaks.push(...spectralSelectionPeaks(selectedChannels, effectiveRate, size));
	}
	return [...new Set(peaks)].sort((left, right) => left - right);
}
