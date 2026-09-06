/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for the span a paste lands on.
 *
 * Pasting into a sequence has to conform the anchor onto that sequence's video
 * grid, and every downstream clip position is derived from the span this
 * returns. What matters is not one worked rate but that the span is always on
 * the grid, always has a positive extent, and never drifts further than half a
 * video frame from where the paste was asked for.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	clipboardContainsVideo,
	pasteSpanForSequence,
} from '../src/common/editor/commands/clipboard-time-runtime.js';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
} from '../src/common/editor/timeline-time.ts';

const SEED = 20_260_906;
const RUNS = 200;

interface RationalRate {
	readonly num: number;
	readonly den: number;
}

interface PasteSpan {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
	readonly sequenceFrame?: number;
	readonly sequenceFrameCount?: number;
	readonly sampleFrame?: number;
	readonly sampleDelta?: number;
}

const rateArbitrary = fc.constantFrom<RationalRate>(
	{ num: 24, den: 1 },
	{ num: 25, den: 1 },
	{ num: 30, den: 1 },
	{ num: 50, den: 1 },
	{ num: 60, den: 1 },
	{ num: 24_000, den: 1001 },
	{ num: 30_000, den: 1001 },
	{ num: 60_000, den: 1001 },
);
const sampleRateArbitrary = fc.constantFrom(44_100, 48_000, 96_000);
const frameArbitrary = fc.integer({ min: 0, max: 10_000_000 });
const durationArbitrary = fc.integer({ min: 1, max: 10_000_000 });

function span(sampleRate: number, rate: RationalRate | null, atFrame: number, duration: number): PasteSpan {
	const sequence = rate === null ? null : { id: 'sequence-a', rate, sampleRate };
	return pasteSpanForSequence({ sampleRate }, sequence, atFrame, duration) as PasteSpan;
}

test('a paste outside any video grid lands exactly where it was asked to', () => {
	fc.assert(
		fc.property(sampleRateArbitrary, frameArbitrary, durationArbitrary, (sampleRate, atFrame, duration) => {
			const result = span(sampleRate, null, atFrame, duration);
			assert.deepEqual(result, { startFrame: atFrame, endFrame: atFrame + duration, durationFrames: duration });
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a paste into a sequence lands on that sequence video grid', () => {
	fc.assert(
		fc.property(
			sampleRateArbitrary,
			rateArbitrary,
			frameArbitrary,
			durationArbitrary,
			(sampleRate, rate, atFrame, duration) => {
				const result = span(sampleRate, rate, atFrame, duration);
				const sequenceFrame = result.sequenceFrame as number;
				const sequenceFrameCount = result.sequenceFrameCount as number;

				assert.equal(result.startFrame, result.sampleFrame, 'the span opens on the conformed sample frame');
				assert.equal(sequenceFrame, sampleFrameToVideoFrame(atFrame, rate, sampleRate, 'point'));
				assert.equal(result.startFrame, videoFrameToSampleFrame(sequenceFrame, rate, sampleRate, 'point'));
				assert.ok(sequenceFrameCount >= 1, 'a paste always covers at least one video frame');
				assert.equal(
					result.endFrame,
					videoFrameToSampleFrame(sequenceFrame + sequenceFrameCount, rate, sampleRate, 'point'),
				);
				assert.equal(result.durationFrames, result.endFrame - result.startFrame);
				assert.ok(result.durationFrames > 0, 'a conformed paste keeps a positive extent');
				assert.equal(result.sampleDelta, result.startFrame - atFrame);

				for (const value of [result.startFrame, result.endFrame, sequenceFrame, sequenceFrameCount]) {
					assert.ok(Number.isSafeInteger(value) && value >= 0, `${String(value)} left the safe frame domain`);
				}

				// Conforming drifts by at most half a video frame plus the rounding
				// back into samples, or a paste would visibly slide off its anchor.
				const samplesPerVideoFrame = rate.den * sampleRate / rate.num;
				assert.ok(
					Math.abs(result.sampleDelta as number) <= samplesPerVideoFrame / 2 + 1,
					`the anchor drifted by ${String(result.sampleDelta)} samples`,
				);
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('conforming an already-conformed anchor moves it no further', () => {
	fc.assert(
		fc.property(
			sampleRateArbitrary,
			rateArbitrary,
			frameArbitrary,
			durationArbitrary,
			(sampleRate, rate, atFrame, duration) => {
				const first = span(sampleRate, rate, atFrame, duration);
				const second = span(sampleRate, rate, first.startFrame, duration);
				assert.deepEqual({ ...second, sampleDelta: 0 }, { ...first, sampleDelta: 0 });
				assert.equal(second.sampleDelta, 0, 'a conformed anchor is already on the grid');
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a clipboard counts as carrying video exactly when one of its tracks does', () => {
	const trackArbitrary = fc.record({
		sourceTrackId: fc.string({ minLength: 1, maxLength: 8 }),
		sourceTrackType: fc.option(fc.constantFrom('audio', 'video', 'label'), { nil: undefined }),
		clips: fc.array(fc.record({ kind: fc.constantFrom('audio', 'video') }), { maxLength: 3, size: 'max' }),
	});
	fc.assert(
		fc.property(fc.array(trackArbitrary, { maxLength: 6, size: 'max' }), (tracks) => {
			const expected = tracks.some((track) => (
				(track.sourceTrackType ?? track.clips[0]?.kind ?? 'audio') === 'video'
			));
			assert.equal(clipboardContainsVideo({ tracks }), expected);
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});
