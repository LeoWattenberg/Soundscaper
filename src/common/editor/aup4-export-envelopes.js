/* SPDX-License-Identifier: AGPL-3.0-only */

// The single gain envelope an exported AUP4 clip carries. Audacity 4 has one
// control-point envelope per clip and no separate fade or crossfade, so the
// browser's fades, its automatic clip crossfades and its own envelope have to
// be evaluated together and sampled adaptively into control points that stay
// within the format's own limit. Split out of aup4-export.js; no behaviour
// changes here.

import { compareCodeUnits } from './code-unit-order.ts';
import {
	boundedFrame,
	finiteNonNegative,
	nonNegativeFrame,
	positiveFrame,
} from './aup4-export-values.js';

const AUP4_CLIP_ENVELOPE_MAX = 4;

export function createNativeClipEnvelope(clip, track, automaticCrossfade = {}) {
	const duration = positiveFrame(clip.durationFrames, `clip ${clip.id} durationFrames`);
	const gain = finiteNonNegative(clip.gain, 1);
	const fadeIn = boundedFrame(clip.fadeInFrames, duration);
	const fadeOut = boundedFrame(clip.fadeOutFrames, duration);
	const clipEnvelope = normalizedEnvelope(clip.envelope, duration);
	const trackEnvelope = normalizedEnvelope(track.envelope, Number.MAX_SAFE_INTEGER);
	const crossfadeInRanges = normalizedFrameRanges(automaticCrossfade.crossfadeInRanges, duration);
	const crossfadeOutRanges = normalizedFrameRanges(automaticCrossfade.crossfadeOutRanges, duration);
	const hasAutomaticCrossfade = crossfadeInRanges.length > 0 || crossfadeOutRanges.length > 0;
	const converted = gain !== 1 || fadeIn > 0 || fadeOut > 0 || trackEnvelope.length > 0 || hasAutomaticCrossfade;
	if (!converted) {
		const points = envelopeWithBoundaries(clipEnvelope);
		const maximum = Math.max(1, ...points.map((point) => point.value));
		const pcmGain = maximum > AUP4_CLIP_ENVELOPE_MAX ? maximum / AUP4_CLIP_ENVELOPE_MAX : 1;
		return {
			points: pcmGain === 1 ? points : points.map((point) => ({
				frame: point.frame,
				value: point.value / pcmGain,
			})),
			pcmGain,
			converted: pcmGain !== 1,
			automaticCrossfade: false,
		};
	}

	const boundaries = new Set([0, duration]);
	for (const point of clipEnvelope) boundaries.add(point.frame);
	for (const point of trackEnvelope) {
		const localFrame = point.frame - nonNegativeFrame(clip.timelineStartFrame, `clip ${clip.id} timelineStartFrame`);
		if (localFrame >= 0 && localFrame <= duration) boundaries.add(localFrame);
	}
	if (fadeIn > 0) boundaries.add(fadeIn);
	if (fadeOut > 0) boundaries.add(duration - fadeOut);
	for (const frame of [...crossfadeInRanges.flat(), ...crossfadeOutRanges.flat()]) boundaries.add(frame);
	const timelineStart = Number(clip.timelineStartFrame || 0);
	const valueAt = (frame) => Math.max(0,
		gain
			* envelopeValueAt(clipEnvelope, frame)
			* envelopeValueAt(trackEnvelope, timelineStart + frame)
			* fadeValueAt(frame, duration, fadeIn, fadeOut, crossfadeInRanges, crossfadeOutRanges));
	const rawPoints = adaptiveEnvelopePoints([...boundaries], valueAt);
	const maximum = Math.max(1, ...rawPoints.map((point) => point.value));
	const pcmGain = maximum > AUP4_CLIP_ENVELOPE_MAX ? maximum / AUP4_CLIP_ENVELOPE_MAX : 1;
	const points = rawPoints.map((point) => ({
		frame: point.frame,
		value: Math.min(AUP4_CLIP_ENVELOPE_MAX, point.value / pcmGain),
	}));
	return { points, pcmGain, converted: true, automaticCrossfade: hasAutomaticCrossfade };
}

function adaptiveEnvelopePoints(boundaries, valueAt) {
	const frames = [...new Set(boundaries)].sort((left, right) => left - right);
	const points = new Map();
	const maximumPoints = 65_536;
	const tolerance = 1e-4;
	for (let index = 1; index < frames.length; index += 1) {
		const left = frames[index - 1];
		const right = frames[index];
		points.set(left, valueAt(left));
		subdivide(left, right, points.get(left), valueAt(right), 0);
	}
	if (frames.length) points.set(frames.at(-1), valueAt(frames.at(-1)));
	return [...points].sort(([left], [right]) => left - right)
		.map(([frame, value]) => ({ frame, value }));

	function subdivide(left, right, leftValue, rightValue, depth) {
		if (right - left <= 1 || depth >= 16 || points.size >= maximumPoints) return;
		const probeFrames = [
			Math.round(left + (right - left) / 4),
			Math.round(left + (right - left) / 2),
			Math.round(left + (right - left) * 3 / 4),
		].filter((frame, index, all) => frame > left && frame < right && all.indexOf(frame) === index);
		let split = false;
		for (const frame of probeFrames) {
			const actual = valueAt(frame);
			const linear = leftValue + (rightValue - leftValue) * (frame - left) / (right - left);
			if (Math.abs(actual - linear) > tolerance) {
				split = true;
				break;
			}
		}
		if (!split) return;
		const middle = Math.round((left + right) / 2);
		if (middle <= left || middle >= right) return;
		const middleValue = valueAt(middle);
		points.set(middle, middleValue);
		subdivide(left, middle, leftValue, middleValue, depth + 1);
		subdivide(middle, right, middleValue, rightValue, depth + 1);
	}
}

function normalizedEnvelope(points, maximumFrame) {
	return (Array.isArray(points) ? points : [])
		.filter((point) => Number.isFinite(Number(point?.frame)) && Number.isFinite(Number(point?.value)))
		.map((point) => ({
			frame: Math.max(0, Math.min(maximumFrame, Math.round(Number(point.frame)))),
			value: Math.max(0, Number(point.value)),
		}))
		.sort((left, right) => left.frame - right.frame)
		.filter((point, index, values) => !index || point.frame > values[index - 1].frame);
}

function envelopeValueAt(points, frame) {
	if (!points.length) return 1;
	let low = 0;
	let high = points.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (points[middle].frame < frame) low = middle + 1;
		else high = middle;
	}
	const right = points[low];
	if (!right) return points.at(-1).value;
	if (right.frame === frame) return right.value;
	const left = low ? points[low - 1] : { frame: 0, value: 1 };
	if (right.frame <= left.frame) return right.value;
	return left.value + (right.value - left.value) * (frame - left.frame) / (right.frame - left.frame);
}

function fadeValueAt(frame, duration, fadeIn, fadeOut, crossfadeInRanges, crossfadeOutRanges) {
	let value = 1;
	if (fadeIn > 0 && frame < fadeIn) value *= frame / fadeIn;
	if (fadeOut > 0 && frame > duration - fadeOut) value *= (duration - frame) / fadeOut;
	value *= crossfadeValueAt(frame, crossfadeInRanges, 'in');
	value *= crossfadeValueAt(frame, crossfadeOutRanges, 'out');
	return Math.max(0, value);
}

function envelopeWithBoundaries(points) {
	if (!points.length) return [];
	const output = points.map((point) => ({ ...point }));
	if (output[0].frame > 0) output.unshift({ frame: 0, value: envelopeValueAt(points, 0) });
	return output;
}

function normalizedFrameRanges(ranges, duration) {
	const ordered = (Array.isArray(ranges) ? ranges : [])
		.map((range) => [
			Math.max(0, Math.min(duration, Math.round(Number(range?.[0])))),
			Math.max(0, Math.min(duration, Math.round(Number(range?.[1])))),
		])
		.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
		.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const merged = [];
	for (const [start, end] of ordered) {
		const previous = merged.at(-1);
		if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

function crossfadeValueAt(frame, ranges, direction) {
	let gain = 1;
	for (const [start, end] of ranges) {
		if (frame < start || frame > end) continue;
		const progress = end > start ? (frame - start) / (end - start) : 1;
		gain = Math.min(gain, direction === 'in' ? progress : 1 - progress);
	}
	return Math.max(0, Math.min(1, gain));
}

export function automaticAup4CrossfadeRanges(clips) {
	const ranges = new Map(clips.map((clip) => [
		String(clip.id),
		{ crossfadeInRanges: [], crossfadeOutRanges: [] },
	]));
	const ordered = clips.slice().sort((left, right) => (
		Number(left.timelineStartFrame) - Number(right.timelineStartFrame)
		|| compareCodeUnits(String(left.id), String(right.id))
	));
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftStart = Number(left.timelineStartFrame);
		const leftEnd = leftStart + Number(left.durationFrames);
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			const rightStart = Number(right.timelineStartFrame);
			if (rightStart >= leftEnd) break;
			const overlapStart = Math.max(leftStart, rightStart);
			const overlapEnd = Math.min(leftEnd, rightStart + Number(right.durationFrames));
			if (overlapEnd <= overlapStart) continue;
			ranges.get(String(left.id)).crossfadeOutRanges.push([
				overlapStart - leftStart,
				overlapEnd - leftStart,
			]);
			ranges.get(String(right.id)).crossfadeInRanges.push([
				overlapStart - rightStart,
				overlapEnd - rightStart,
			]);
		}
	}
	for (const value of ranges.values()) {
		value.crossfadeInRanges = normalizedFrameRanges(value.crossfadeInRanges, Number.MAX_SAFE_INTEGER);
		value.crossfadeOutRanges = normalizedFrameRanges(value.crossfadeOutRanges, Number.MAX_SAFE_INTEGER);
	}
	return ranges;
}
