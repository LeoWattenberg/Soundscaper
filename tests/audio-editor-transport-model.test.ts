/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	calculateAudioEditorCountInFrames,
	calculateAudioEditorMetronomeSchedule,
} from '../src/common/editor/controller/transport-model.ts';

test('metronome schedules remain frame-accurate across playback rates', () => {
	assert.deepEqual(calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		sampleRate: 48_000,
		positionFrame: 12_000,
		playbackRate: 2,
	}), {
		beatIndex: 1,
		delaySeconds: 0.125,
		beatDurationSeconds: 0.25,
	});
});

test('metronome schedules normalize invalid numeric input without negative delays', () => {
	const schedule = calculateAudioEditorMetronomeSchedule({
		bpm: 0,
		sampleRate: 0,
		positionFrame: -1,
		playbackRate: Number.NaN,
	});
	assert.equal(schedule.beatIndex, 0);
	assert.equal(schedule.delaySeconds, 0);
	assert.equal(schedule.beatDurationSeconds, 0.5);
});

test('metronome schedules resolve tempo transitions from the authoritative map origin', () => {
	assert.deepEqual(calculateAudioEditorMetronomeSchedule({
		bpm: 30,
		tempoMap: {
			mode: 'musical',
			events: [
				{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
			],
		},
		signatureMap: {
			events: [{ bar: 0, numerator: 4, denominator: 4 }],
		},
		timeSignature: { numerator: 7, denominator: 8 },
		sampleRate: 48_000,
		positionFrame: 90_000,
	}), {
		beatIndex: 4,
		delaySeconds: 0.125,
		beatDurationSeconds: 1,
		barIndex: 1,
		pulseIndex: 0,
		accent: 'bar',
	});
});

test('signature transitions use denominator pulses and compound-meter group accents', () => {
	const tempoMap = {
		mode: 'musical' as const,
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
	};
	const signatureMap = {
		events: [
			{ bar: 0, numerator: 4, denominator: 4 },
			{ bar: 1, numerator: 6, denominator: 8 },
			{ bar: 2, numerator: 3, denominator: 4 },
		],
	};
	assert.deepEqual(calculateAudioEditorMetronomeSchedule({
		tempoMap,
		signatureMap,
		sampleRate: 48_000,
		positionFrame: 132_000,
	}), {
		beatIndex: 7,
		delaySeconds: 0,
		beatDurationSeconds: 0.25,
		barIndex: 1,
		pulseIndex: 3,
		accent: 'group',
	});
	assert.deepEqual(calculateAudioEditorMetronomeSchedule({
		tempoMap,
		signatureMap,
		sampleRate: 48_000,
		positionFrame: 168_000,
	}), {
		beatIndex: 10,
		delaySeconds: 0,
		beatDurationSeconds: 0.5,
		barIndex: 2,
		pulseIndex: 0,
		accent: 'bar',
	});
});

test('count-in duration follows compound meter across tempo-map transitions', () => {
	assert.equal(calculateAudioEditorCountInFrames({
		tempoMap: {
			mode: 'musical',
			events: [
				{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ beat: { num: 2, den: 1 }, bpm: { num: 60, den: 1 } },
			],
		},
		signatureMap: {
			events: [{ bar: 0, numerator: 6, denominator: 8 }],
		},
		sampleRate: 48_000,
		positionFrame: 144_000,
		measureCount: 1,
	}), 120_000);
});

test('count-in applies the signature event beginning at an adjacent record boundary', () => {
	assert.equal(calculateAudioEditorCountInFrames({
		tempoMap: {
			mode: 'musical',
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		signatureMap: {
			events: [
				{ bar: 0, numerator: 4, denominator: 4 },
				{ bar: 1, numerator: 6, denominator: 8 },
			],
		},
		sampleRate: 48_000,
		positionFrame: 96_000,
	}), 72_000);
});

test('legacy singleton schedule input retains compound-meter accents when maps are absent', () => {
	assert.deepEqual(calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		timeSignature: { numerator: 6, denominator: 8 },
		sampleRate: 48_000,
		positionFrame: 36_000,
	}), {
		beatIndex: 3,
		delaySeconds: 0,
		beatDurationSeconds: 0.25,
		barIndex: 0,
		pulseIndex: 3,
		accent: 'group',
	});
});
