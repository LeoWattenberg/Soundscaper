/* SPDX-License-Identifier: AGPL-3.0-only */

import { sampleFrameToVideoFrame, videoFrameToSampleFrame, type RationalRate } from '../common/editor/timeline-time.ts';

type DataRecord = Record<string, unknown>;

/** Restore detached visual placements on the inherited command's new sequence grid. */
export function conformRestoredSequenceVisualClips(
	before: Readonly<DataRecord>,
	after: Readonly<DataRecord>,
	clips: readonly DataRecord[],
): DataRecord[] {
	const previousRates = sequenceRates(before.sequences);
	const nextRates = sequenceRates(after.sequences);
	const sampleRate = Number(before.sampleRate);
	return clips.map((clip) => {
		if (!['image', 'still', 'generator'].includes(String(clip.kind))) return clip;
		const sequenceId = String(clip.sequenceId);
		const previous = previousRates.get(sequenceId);
		const next = nextRates.get(sequenceId);
		if (!previous || !next || (previous.num === next.num && previous.den === next.den)) return clip;
		const start = Number(clip.sequenceStartFrame);
		const end = start + Number(clip.sequenceFrameCount);
		const resolvedStart = videoFrameToSampleFrame(start, previous, sampleRate, 'point');
		const resolvedEnd = videoFrameToSampleFrame(end, previous, sampleRate, 'point');
		const sequenceStartFrame = sampleFrameToVideoFrame(resolvedStart, next, sampleRate, 'point');
		const sequenceEndFrame = sampleFrameToVideoFrame(resolvedEnd, next, sampleRate, 'point');
		return { ...clip, sequenceStartFrame, sequenceFrameCount: Math.max(1, sequenceEndFrame - sequenceStartFrame) };
	});
}

function sequenceRates(value: unknown): ReadonlyMap<string, RationalRate> {
	if (!Array.isArray(value)) throw new TypeError('Sequence rate conformance requires sequences.');
	return new Map(value.map((item: unknown) => {
		const sequence = record(item);
		const rate = record(sequence.rate);
		return [String(sequence.id), { num: Number(rate.num), den: Number(rate.den) }];
	}));
}

function record(value: unknown): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Sequence rate conformance requires a canonical record.');
	}
	return value as DataRecord;
}
