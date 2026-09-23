/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SummaryWaveformChannel,
	WaveformRendering,
} from '../../design-system-adapters/types.ts';

interface RetainedWaveform extends WaveformRendering {
	readonly sourceId?: string;
	readonly waveformIdentity?: string;
}

interface PendingClip {
	readonly sourceId?: string;
	readonly waveformIdentity?: string;
	readonly waveformStartFrame?: number;
	readonly waveformEndFrame?: number;
	readonly trimStart: number;
	readonly duration: number;
}

/** Keep existing audio aligned during a viewport change while a finer read completes. */
export function reprojectPendingWaveform(
	plan: RetainedWaveform,
	clip: PendingClip,
	sampleRate: number,
	pixelWidth: number,
): RetainedWaveform | null {
	if (plan.sourceId !== clip.sourceId || plan.waveformIdentity !== clip.waveformIdentity) return null;
	if (!(sampleRate > 0) || !(pixelWidth > 0) || !(plan.frameCount > 0)) return null;
	const startFrame = clip.waveformStartFrame ?? Math.round(clip.trimStart * sampleRate);
	const endFrame = clip.waveformEndFrame ?? Math.round((clip.trimStart + clip.duration) * sampleRate);
	if (!(endFrame > startFrame) || endFrame <= plan.startFrame || startFrame >= plan.endFrame) return null;
	return reprojectWaveformRange(plan, startFrame, endFrame, pixelWidth);
}

export function reprojectWaveformRange<T extends WaveformRendering>(
	plan: T,
	startFrame: number,
	endFrame: number,
	pixelWidth: number,
): T {
	if (plan.startFrame === startFrame && plan.endFrame === endFrame) return plan;
	const frameCount = endFrame - startFrame;
	const scale = plan.frameCount / frameCount * pixelWidth / plan.pixelWidth;
	const offset = (plan.startFrame - startFrame) / frameCount * pixelWidth;
	return {
		...plan,
		startFrame,
		endFrame,
		frameCount,
		pixelWidth,
		pixelsPerSample: plan.pixelsPerSample * scale,
		channels: plan.channels.map((channel) => 'samples' in channel
			? { ...channel, firstSampleX: offset + channel.firstSampleX * scale }
			: projectSummary(channel, plan, startFrame, frameCount, pixelWidth)),
	};
}

function projectSummary(
	channel: SummaryWaveformChannel,
	plan: WaveformRendering,
	startFrame: number,
	frameCount: number,
	pixelWidth: number,
): SummaryWaveformChannel {
	const columns = Math.max(1, Math.ceil(pixelWidth));
	const sourceColumns = Math.min(channel.minimum.length, channel.maximum.length);
	const minimum = new Float32Array(columns);
	const maximum = new Float32Array(columns);
	const rms = channel.rms ? new Float32Array(columns) : null;
	for (let column = 0; column < columns; column += 1) {
		const from = (startFrame + column / columns * frameCount - plan.startFrame) / plan.frameCount * sourceColumns;
		const to = (startFrame + (column + 1) / columns * frameCount - plan.startFrame) / plan.frameCount * sourceColumns;
		const first = Math.max(0, Math.floor(from));
		const last = Math.min(sourceColumns, Math.ceil(to));
		if (first >= last) continue;
		let lower = Infinity;
		let upper = -Infinity;
		let sum = 0;
		for (let index = first; index < last; index += 1) {
			lower = Math.min(lower, channel.minimum[index] ?? 0);
			upper = Math.max(upper, channel.maximum[index] ?? 0);
			if (rms) sum += (channel.rms?.[index] ?? 0) ** 2;
		}
		minimum[column] = lower;
		maximum[column] = upper;
		if (rms) rms[column] = Math.sqrt(sum / (last - first));
	}
	return { minimum, maximum, rms };
}
