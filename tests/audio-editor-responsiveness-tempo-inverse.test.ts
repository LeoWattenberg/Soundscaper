/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSampleFrameBeatProjector, sampleFrameToBeat } from '../src/common/editor/timeline-tempo-inverse.ts';
import { secondsToSampleFrame, type HoldTempoMap } from '../src/common/editor/timeline-time.ts';
import { compileAutomationLaneEventsV21 } from '../src/common/editor/engine/automation-lane-scheduler-v21.ts';
import { evaluateAutomationLaneAtFrameV21, normalizeAutomationLaneV21, normalizeAutomationLaneCaptureV21, prepareAutomationLaneForSchedulingV21 } from '../src/common/editor/automation-lane-v21.ts';
import { canonicalParameterAddressKey } from '../src/common/editor/parameter-address.ts';

test('prepared inverse tempo projection matches origin-exact musical and sample-locked queries', () => {
	const musical: HoldTempoMap = { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 123, den: 1 } },
		{ beat: { num: 1, den: 3 }, bpm: { num: 97, den: 1 } },
		{ beat: { num: 2, den: 3 }, bpm: { num: 141, den: 1 } },
	] };
	const locked: HoldTempoMap = { mode: 'sampleLocked', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, samplePosition: secondsToSampleFrame(0, 48_000, 'point') },
		{ beat: { num: 1, den: 1 }, bpm: { num: 60, den: 1 }, samplePosition: secondsToSampleFrame(0.5, 48_000, 'point') },
		{ beat: { num: 2, den: 1 }, bpm: { num: 180, den: 1 }, samplePosition: secondsToSampleFrame(1.5, 48_000, 'point') },
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

test('prepared inverse preserves first-greater authority for malformed sample-locked positions and detaches facts', () => {
	for (const samples of [[0, 100, 10], [100, 10, 20], [0, 10, 100, 20, 30], [0, 0, 0, 100, 1]]) {
		const events = samples.map((sample, index) => ({
			beat: { num: index, den: 1 }, bpm: { num: 60 + index * 30, den: 1 },
			samplePosition: secondsToSampleFrame(sample, 1, 'point'),
		}));
		const map: HoldTempoMap = { mode: 'sampleLocked', events };
		const project = createSampleFrameBeatProjector(map, 48_000);
		const frames = [0, 1, 9, 10, 11, 19, 20, 21, 30, 40, 99, 100, 101, 200];
		const expected = frames.map(frame => sampleFrameToBeat(frame, map, 48_000));
		for (const [index, frame] of frames.entries()) assert.deepEqual(project(frame), expected[index]);
		for (const event of events) {
			event.beat.num += 1_000;
			event.bpm.num = 1;
			event.samplePosition = secondsToSampleFrame(1_000, 1, 'point');
		}
		events.reverse();
		for (const [index, frame] of frames.entries()) assert.deepEqual(project(frame), expected[index]);
	}
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

test('scheduling reuses privately produced frozen lanes while rechecking descriptor and capture caps', () => {
	const lane = normalizeAutomationLaneV21({
		id: 'gain', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [
			{ id: 'start', position: 0, value: 0 }, { id: 'end', position: 10, value: 1 },
		], segments: [{ kind: 'linear' }],
	});
	assert.equal(prepareAutomationLaneForSchedulingV21(lane), lane);
	assert.notEqual(normalizeAutomationLaneV21(lane), lane, 'public normalization retains detached-result semantics');
	const changed = { ...lane, points: [lane.points[0]!, { ...lane.points[1]!, value: 0.5 }] };
	const normalized = prepareAutomationLaneForSchedulingV21(changed);
	assert.notEqual(normalized, changed);
	assert.equal(normalized.points[1]?.value, 0.5);
	assert.throws(() => prepareAutomationLaneForSchedulingV21(lane, {
		descriptor: {
			id: canonicalParameterAddressKey(lane.address), address: lane.address, unit: 'linear',
			minimum: 0, maximum: 0.5, defaultValue: 0, step: null, taper: 'linear',
			automationTolerance: 0.001, automatable: true, latencyFrames: 0, tailFrames: 0,
		},
	}), /outside/u);
	const capture = normalizeAutomationLaneCaptureV21({ ...lane,
		points: Array.from({ length: 4_097 }, (_, index) => ({ id: String(index), position: index, value: 0 })),
		segments: Array.from({ length: 4_096 }, () => ({ kind: 'hold' })),
	});
	assert.throws(() => prepareAutomationLaneForSchedulingV21(capture), /4096/u);
});

test('linear musical segments inspect only their tempo window rather than filtering every boundary', () => {
	const tempoMap: HoldTempoMap = { mode: 'musical', events: Array.from({ length: 200 }, (_, index) => ({
		beat: { num: index, den: 1 }, bpm: { num: 120, den: 1 },
	})) };
	const lane = normalizeAutomationLaneV21({
		id: 'linear', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'musical-beats', points: Array.from({ length: 11 }, (_, index) => ({
			id: String(index), position: { num: index, den: 1 }, value: index / 10,
		})), segments: Array.from({ length: 10 }, () => ({ kind: 'linear' })),
	});
	const original = Array.prototype.filter;
	let inspected = 0;
	Object.defineProperty(Array.prototype, 'filter', { value: function (
		this: unknown[], callback: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown,
	) {
		if (this.length === 200 && typeof this[0] === 'number') inspected += this.length;
		return original.call(this, callback, thisArg) as unknown[];
	} });
	try {
		const events = compileAutomationLaneEventsV21(lane, { fromFrame: 0, toFrame: 240_000, sampleRate: 48_000, tempoMap });
		assert.equal(inspected, 0, 'no complete boundary filter per segment');
		assert.equal(events.length, 11);
		for (let index = 0; index < events.length; index += 1) assert.deepEqual(events[index], {
			kind: index === 0 ? 'set' : 'linear', frame: index * 24_000, value: index / 10,
		});
	} finally { Object.defineProperty(Array.prototype, 'filter', { value: original }); }
});
