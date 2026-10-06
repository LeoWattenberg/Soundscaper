/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipSourceDisplayRange } from '../../clip-source-timing.ts';
import { readClipLoop, withoutClipLoop } from '../../audio-clip-loop.ts';
import type { ClipLoopCarrier } from '../../audio-clip-loop.ts';
import type { AudioWarpRuntimeClip } from '../../audio-warp-runtime.ts';

type Clip = AudioWarpRuntimeClip & ClipLoopCarrier & { readonly id: string; readonly sourceId: string };
type Source = { readonly sampleRate: number; readonly frameCount: number };

/** The untrimmed source surrounds the clip's processed output on one continuous axis. */
export function clipSourceSegments<T extends Clip>(clip: T, source: Source, sampleRate: number) {
	const range = clipSourceDisplayRange(clip, source, sampleRate);
	const plain = { ...clip, anchor: 'sample', warpMap: null, reversed: false, pitchCents: 0, speedRatio: 1,
		gain: 1, inverted: false, fadeInFrames: 0, fadeOutFrames: 0, envelope: [],
		opaqueExtensions: withoutClipLoop(clip.opaqueExtensions) };
	return [
		{ ...plain, id: `${clip.id}:before`, active: false, timelineStartFrame: 0, durationFrames: range.startFrame, sourceStartFrame: 0, sourceDurationFrames: clip.sourceStartFrame },
		{ ...clip, id: `${clip.id}:source`, active: true, timelineStartFrame: range.startFrame },
		{ ...plain, id: `${clip.id}:after`, active: false, timelineStartFrame: range.endFrame, durationFrames: range.totalFrames - range.endFrame,
			sourceStartFrame: clip.sourceStartFrame + clip.sourceDurationFrames,
			sourceDurationFrames: source.frameCount - clip.sourceStartFrame - clip.sourceDurationFrames },
	].filter(segment => segment.durationFrames > 0 && segment.sourceDurationFrames > 0);
}

/** Source handles never author the clip's project placement. */
export function clipSourceTrim(clip: Clip, source: Source, _sampleRate: number, edge: 'start' | 'end', sourceFrame: number) {
	const oldEnd = clip.sourceStartFrame + clip.sourceDurationFrames;
	const start = edge === 'start' ? Math.max(0, Math.min(oldEnd - 1, Math.round(sourceFrame))) : clip.sourceStartFrame;
	const end = edge === 'end' ? Math.max(start + 1, Math.min(source.frameCount, Math.round(sourceFrame))) : oldEnd;
	const sourceDurationFrames = end - start;
	const extent = readClipLoop(clip)?.periodFrames ?? clip.durationFrames;
	return { sourceStartFrame: start, sourceDurationFrames, durationFrames: Math.max(1, Math.round(extent * sourceDurationFrames / clip.sourceDurationFrames)) };
}

export function sourceRulerTicks({ startFrame, endFrame, width, sampleRate, originFrame }: {
	readonly startFrame: number; readonly endFrame: number; readonly width: number; readonly sampleRate: number; readonly originFrame: number;
}) {
	const secondsPerLabel = (endFrame - startFrame) / sampleRate / Math.max(1, width / 80);
	const power = 10 ** Math.floor(Math.log10(Math.max(0.001, secondsPerLabel)));
	const step = [1, 2, 5, 10].map(value => value * power).find(value => value >= secondsPerLabel) ?? power * 10;
	const first = Math.ceil((startFrame + originFrame) / sampleRate / step) * step;
	const ticks: { frame: number; label: string }[] = [];
	for (let i = 0; i < 100; i++) {
		const seconds = first + i * step;
		const frame = Math.round(seconds * sampleRate - originFrame);
		if (frame > endFrame) break;
		const absolute = Math.abs(seconds);
		const precision = Math.max(0, Math.min(3, -Math.floor(Math.log10(step))));
		const tail = (absolute % 60).toFixed(precision).padStart(precision ? precision + 3 : 2, '0');
		ticks.push({ frame, label: `${seconds < 0 ? '−' : ''}${Math.floor(absolute / 60)}:${tail}` });
	}
	return ticks;
}
