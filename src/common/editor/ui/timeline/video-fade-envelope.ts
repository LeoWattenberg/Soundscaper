/* SPDX-License-Identifier: AGPL-3.0-only */
import { addRationals, compareRationals, normalizeRational, type Rational } from '../../timeline-time.ts';
import { compileInterpolationCurve, evaluateInterpolationCurveAtExactPosition } from '../../interpolation-curve.ts';
import { mapVideoKeyframeVisiblePosition } from '../../video-keyframe-time-domain.ts';
import { normalizeVideoKeyframeCurves, type VideoKeyframeCurves } from '../../video-keyframe-curves.ts';

export interface VideoFadeClip {
	readonly sequenceFrameCount: number;
	readonly videoComposition: Readonly<{ opacity: number }>;
	readonly videoEffects: unknown;
	readonly videoKeyframes: VideoKeyframeCurves;
}

export interface VideoFadeEnvelope {
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly peak: number;
}

/** Quick fades own a linear opacity envelope; custom authored curves stay intact. */
export function readVideoFadeEnvelope(clip: VideoFadeClip): VideoFadeEnvelope | null {
	const { timeDomain, curves } = clip.videoKeyframes;
	const entry = curves.find(({ target }) => target.kind === 'composition' && target.parameterId === 'opacity');
	if (!entry) return { fadeInFrames: 0, fadeOutFrames: 0, peak: clip.videoComposition.opacity };
	const end = addRationals(timeDomain.viewStart, timeDomain.viewDuration);
	if (entry.curve.segments.some(({ kind }) => kind !== 'linear')) return null;
	const curve = compileInterpolationCurve(entry.curve);
	// Trims and splits retain authored anchors, so the visible edges can lie
	// inside a segment even when this view is still a standard fade envelope.
	const anchors = [
		{ position: timeDomain.viewStart, value: evaluateInterpolationCurveAtExactPosition(curve, timeDomain.viewStart) },
		...entry.curve.anchors.filter(({ position }) => compareRationals(position, timeDomain.viewStart) > 0 && compareRationals(position, end) < 0),
		{ position: end, value: evaluateInterpolationCurveAtExactPosition(curve, end) },
	];
	if (anchors.length > 4) return null;
	const first = anchors[0]!;
	const last = anchors.at(-1)!;
	const peak = Math.max(...anchors.map(({ value }) => value));
	if (peak <= 0 || first.value !== 0 && first.value !== peak || last.value !== 0 && last.value !== peak
		|| anchors.slice(1, -1).some(({ value }) => value !== peak)) return null;
	const scale = clip.sequenceFrameCount / rationalNumber(timeDomain.viewDuration);
	const fadeInFrames = first.value === 0 ? (rationalNumber(anchors[1]!.position) - rationalNumber(timeDomain.viewStart)) * scale : 0;
	const fadeOutFrames = last.value === 0 ? (rationalNumber(last.position) - rationalNumber(anchors.at(-2)!.position)) * scale : 0;
	return { fadeInFrames: Math.round(fadeInFrames), fadeOutFrames: Math.round(fadeOutFrames), peak };
}

/** Keep fades in the existing serializable, undoable exact video keyframe authority. */
export function createVideoFadeKeyframes(clip: VideoFadeClip, edge: 'in' | 'out', duration: number): VideoKeyframeCurves {
	const envelope = readVideoFadeEnvelope(clip);
	if (!envelope) throw new RangeError('Quick fades cannot replace a custom opacity curve.');
	if (!Number.isFinite(duration)) throw new RangeError('Video fade duration must be finite.');
	const opposite = edge === 'in' ? envelope.fadeOutFrames : envelope.fadeInFrames;
	const value = Math.max(0, Math.min(clip.sequenceFrameCount - opposite, Math.round(duration)));
	const fadeIn = edge === 'in' ? value : envelope.fadeInFrames;
	const fadeOut = edge === 'out' ? value : envelope.fadeOutFrames;
	const { timeDomain } = clip.videoKeyframes;
	const existing = clip.videoKeyframes.curves.find(({ target }) => target.kind === 'composition' && target.parameterId === 'opacity');
	const viewEnd = addRationals(timeDomain.viewStart, timeDomain.viewDuration);
	const hiddenOpacity = existing?.curve.anchors.some(({ position, value: opacity }) =>
		(compareRationals(position, timeDomain.viewStart) < 0 || compareRationals(position, viewEnd) > 0) && opacity !== envelope.peak);
	const curves = clip.videoKeyframes.curves.filter(({ target }) => target.kind !== 'composition' || target.parameterId !== 'opacity');
	if (fadeIn || fadeOut || envelope.peak !== clip.videoComposition.opacity || hiddenOpacity) {
		const at = (frame: number): Rational => mapVideoKeyframeVisiblePosition(timeDomain, clip.sequenceFrameCount, frame);
		const points = new Map<string, { position: Rational; value: number }>();
		const put = (position: Rational, opacity: number): void => {
			points.set(`${position.num}:${position.den}`, { position, value: opacity });
		};
		if (existing) {
			for (const anchor of existing.curve.anchors) {
				if (compareRationals(anchor.position, timeDomain.viewStart) < 0 || compareRationals(anchor.position, viewEnd) > 0) put(anchor.position, anchor.value);
			}
		} else {
			put(normalizeRational(0), envelope.peak);
			put(timeDomain.authoredDuration, envelope.peak);
		}
		put(at(0), fadeIn ? 0 : envelope.peak);
		put(at(fadeIn), envelope.peak);
		put(at(clip.sequenceFrameCount - fadeOut), envelope.peak);
		put(at(clip.sequenceFrameCount), fadeOut ? 0 : envelope.peak);
		const anchors = [...points.values()].sort((left, right) => compareRationals(left.position, right.position));
		curves.push({ target: { kind: 'composition', parameterId: 'opacity' }, curve: {
			anchors,
			segments: anchors.slice(1).map(() => ({ kind: 'linear' as const })),
		} });
	}
	return normalizeVideoKeyframeCurves({ schemaVersion: 1, timeDomain, curves }, {
		duration: clip.sequenceFrameCount, composition: clip.videoComposition, videoEffects: clip.videoEffects,
	});
}

function rationalNumber(value: Readonly<{ num: number; den: number }>): number {
	return value.num / value.den;
}
