/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSampleFrameBeatProjector, sampleFrameToBeat } from '../src/common/editor/timeline-tempo-inverse.ts';
import type { HoldTempoMap } from '../src/common/editor/timeline-time.ts';
import { compileAutomationLaneEventsV21 } from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { evaluateAutomationLaneAtFrameV21, normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

test('prepared inverse tempo projection matches origin-exact musical and sample-locked queries', () => {
	const musical: HoldTempoMap = { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 123, den: 1 } },
		{ beat: { num: 1, den: 3 }, bpm: { num: 97, den: 1 } },
		{ beat: { num: 2, den: 3 }, bpm: { num: 141, den: 1 } },
	] };
	const locked: HoldTempoMap = { mode: 'sampleLocked', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: 0 },
		{ beat: { num: 1, den: 1 }, bpm: { num: 60, den: 1 }, samplePosition: 24_000 },
		{ beat: { num: 2, den: 1 }, bpm: { num: 180, den: 1 }, samplePosition: 72_000 },
	] };
	for (const map of [musical, locked]) {
		const project = createSampleFrameBeatProjector(map, 48_000);
		for (const frame of [0, 1, 7_804, 7_805, 7_806, 23_999, 24_000, 24_001, 72_000, 144_000]) {
			assert.deepEqual(project(frame), sampleFrameToBeat(frame, map, 48_000));
		}
		assert.throws(() => project(-1), /frame/u);
		assert.throws(() => project(NaN), /frame/u);
	}
});

test('prepared inverse reads no authored events after preparation and owns its tempo values', () => {
	let reads = 0;
	const raw = Array.from({ length: 1_000 }, (_, index) => ({
		beat: { num: index, den: 1 }, bpm: { num: 120, den: 1 },
	}));
	const events = new Proxy(raw, { get(target, key) {
		if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
		return Reflect.get(target, key, target) as unknown;
	} });
	const project = createSampleFrameBeatProjector({ mode: 'musical', events }, 48_000);
	reads = 0;
	for (let query = 0; query < 100; query += 1) {
		assert.deepEqual(project(query * 24_000), { num: query, den: 1 });
	}
	assert.equal(reads, 0);
	raw[0]!.bpm.num = 60;
	assert.deepEqual(project(12_000), { num: 1, den: 2 });
});

test('prepared inverse preserves last-event authority when musical boundaries round to one sample', () => {
	const map: HoldTempoMap = { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ beat: { num: 1, den: 1_000_000 }, bpm: { num: 60, den: 1 } },
		{ beat: { num: 1, den: 500_000 }, bpm: { num: 180, den: 1 } },
	] };
	const project = createSampleFrameBeatProjector(map, 48_000);
	for (const frame of [0, 1, 10]) assert.deepEqual(project(frame), sampleFrameToBeat(frame, map, 48_000));
});

test('curved musical automation prepares the tempo map a bounded number of times per schedule', () => {
	let reads = 0;
	const raw = Array.from({ length: 200 }, (_, index) => ({
		beat: { num: index, den: 1 }, bpm: { num: 120, den: 1 },
	}));
	const events = new Proxy(raw, { get(target, key) {
		if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
		return Reflect.get(target, key, target) as unknown;
	} });
	const tempoMap: HoldTempoMap = { mode: 'musical', events };
	const lane = normalizeAutomationLaneV21({
		id: 'curve', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'musical-beats', points: [
			{ id: 'start', position: { num: 0, den: 1 }, value: 0 },
			{ id: 'end', position: { num: 10, den: 1 }, value: 1 },
		], segments: [{ kind: 'eased' }],
	});
	const schedule = compileAutomationLaneEventsV21(lane, { fromFrame: 0, toFrame: 240_000, sampleRate: 48_000, tempoMap });
	assert.ok(schedule.length > 50, 'fixture exercises recursive curve subdivision');
	assert.ok(reads < 20 * raw.length, `${String(reads)} tempo reads must stay bounded by preparation`);
	for (const event of schedule) assert.equal(event.value, evaluateAutomationLaneAtFrameV21(lane, event.frame, {
		sampleRate: 48_000, tempoMap,
	}));
});
