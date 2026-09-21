import test from 'node:test';
import assert from 'node:assert/strict';

import { planRecordingStartTiming } from '../src/common/editor/controller/recording/internal/recording-start-timing.ts';

const base = Object.freeze({
	project: Object.freeze({ id: 'project', tracks: Object.freeze([]), tempo: Object.freeze({
		bpm: 120,
		timeSignature: Object.freeze({ numerator: 4, denominator: 4 }),
	}) }),
	currentTimeMs: 1_000,
	contextCurrentTime: 10,
	projectSampleRate: 48_000,
	contextSampleRate: 48_000,
	requestedStartFrame: 120_000,
	leadInEnabled: true,
	createTimedRecordingPastError: () => new RangeError('past'),
});

test('ordinary recording timing owns count-in, clamping, seek, and context-frame conversion', () => {
	const timing = planRecordingStartTiming({ ...base, timedStartTimeMs: null });
	assert.equal(timing.scheduledTime, 10.08);
	assert.equal(timing.availableLeadInFrames, 96_000);
	assert.equal(timing.seekFrame, 24_000);
	assert.equal(timing.captureStartFrame(10.08), 579_840);

	const clamped = planRecordingStartTiming({
		...base,
		timedStartTimeMs: null,
		requestedStartFrame: 1_000,
	});
	assert.equal(clamped.availableLeadInFrames, 1_000);
	assert.equal(clamped.seekFrame, 0);
});

test('authoritative maps replace the legacy one-measure count-in calculation', () => {
	const timing = planRecordingStartTiming({
		...base,
		timedStartTimeMs: null,
		requestedStartFrame: 144_000,
		project: Object.freeze({
			id: 'project', tracks: Object.freeze([]),
			tempoMap: Object.freeze({ mode: 'musical', events: Object.freeze([
				Object.freeze({ beat: Object.freeze({ num: 0, den: 1 }), bpm: Object.freeze({ num: 120, den: 1 }) }),
				Object.freeze({ beat: Object.freeze({ num: 2, den: 1 }), bpm: Object.freeze({ num: 60, den: 1 }) }),
			]) }),
			signatureMap: Object.freeze({ events: Object.freeze([
				Object.freeze({ bar: 0, numerator: 6, denominator: 8 }),
			]) }),
		}),
	});
	assert.equal(timing.availableLeadInFrames, 120_000);
	assert.equal(timing.seekFrame, 24_000);
});

test('timed recording disables count-in and rejects an elapsed start', () => {
	const timing = planRecordingStartTiming({ ...base, timedStartTimeMs: 2_500 });
	assert.equal(timing.scheduledTime, 11.5);
	assert.equal(timing.availableLeadInFrames, 0);
	assert.equal(timing.seekFrame, base.requestedStartFrame);
	assert.throws(() => planRecordingStartTiming({ ...base, timedStartTimeMs: 1_000 }), {
		name: 'RangeError', message: 'past',
	});
});
