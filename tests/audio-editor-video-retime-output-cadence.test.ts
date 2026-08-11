import assert from 'node:assert/strict';
import test from 'node:test';

import { sequenceFrameAtSample } from '../src/common/editor/sequence-frame-navigation.ts';
import {
	createVideoRetimeOutputCadence,
	videoRetimeOutputRateFromInteger,
} from '../src/common/editor/video-retime-output-cadence.ts';

test('normalizes integer rates and snapshots the default cadence on the global sequence grid', () => {
	const integerRate = videoRetimeOutputRateFromInteger(60);
	assert.deepEqual(integerRate, { num: 60, den: 1 });
	assert.ok(Object.isFrozen(integerRate));

	const sequenceRate = { num: 24, den: 1 };
	const input = {
		sampleStart: 96_001,
		sampleDuration: 5_000,
		sampleRate: 48_000,
		sequenceRate,
	};
	const cadence = createVideoRetimeOutputCadence(input);

	assert.equal(cadence.sampleStart, 96_001);
	assert.equal(cadence.sampleDuration, 5_000);
	assert.equal(cadence.sampleRate, 48_000);
	assert.deepEqual(cadence.sequenceRate, { num: 24, den: 1 });
	assert.deepEqual(cadence.outputRate, { num: 24, den: 1 });
	assert.equal(cadence.outputFrameCount, 3);
	assert.deepEqual(cadence.frameAt(0), {
		outputFrame: 0,
		relativePts: { numerator: 0n, denominator: 1n },
		absoluteSample: 96_001,
		sequenceFrame: sequenceFrameAtSample(96_001, { num: 24, den: 1 }, 48_000),
	});
	assert.deepEqual(cadence.frameAt(1), {
		outputFrame: 1,
		relativePts: { numerator: 1n, denominator: 24n },
		absoluteSample: 98_001,
		sequenceFrame: sequenceFrameAtSample(98_001, { num: 24, den: 1 }, 48_000),
	});
	assert.deepEqual(cadence.frameAt(2), {
		outputFrame: 2,
		relativePts: { numerator: 1n, denominator: 12n },
		absoluteSample: 100_001,
		sequenceFrame: sequenceFrameAtSample(100_001, { num: 24, den: 1 }, 48_000),
	});

	assert.ok(Object.isFrozen(cadence));
	assert.ok(Object.isFrozen(cadence.sequenceRate));
	assert.ok(Object.isFrozen(cadence.outputRate));
	assert.equal(Object.isFrozen(input), false);
	assert.equal(Object.isFrozen(sequenceRate), false);
	input.sampleStart = 0;
	sequenceRate.num = 1;
	assert.equal(cadence.sampleStart, 96_001);
	assert.deepEqual(cadence.sequenceRate, { num: 24, den: 1 });
	assert.deepEqual(cadence.outputRate, { num: 24, den: 1 });
});

test('keeps NTSC presentation times and sample-floor placement exact', () => {
	const cadence = createVideoRetimeOutputCadence({
		sampleStart: 11,
		sampleDuration: 4_804,
		sampleRate: 48_000,
		sequenceRate: { num: 30_000, den: 1_001 },
	});

	assert.equal(cadence.outputFrameCount, 3);
	assert.deepEqual(cadence.frameAt(0).relativePts, { numerator: 0n, denominator: 1n });
	assert.deepEqual(cadence.frameAt(1).relativePts, {
		numerator: 1_001n,
		denominator: 30_000n,
	});
	assert.deepEqual(cadence.frameAt(2).relativePts, {
		numerator: 1_001n,
		denominator: 15_000n,
	});
	assert.deepEqual(
		[0, 1, 2].map((index) => cadence.frameAt(index).absoluteSample),
		[11, 1_612, 3_214],
	);
	for (let index = 0; index < cadence.outputFrameCount; index += 1) {
		const frame = cadence.frameAt(index);
		assert.equal(
			frame.sequenceFrame,
			sequenceFrameAtSample(frame.absoluteSample, { num: 30_000, den: 1_001 }, 48_000),
		);
		assert.ok(Object.isFrozen(frame));
		assert.ok(Object.isFrozen(frame.relativePts));
	}
});

test('uses whole containing sequence cells when noncommensurate output rates duplicate or drop cells', () => {
	const duplicated = createVideoRetimeOutputCadence({
		sampleStart: 0,
		sampleDuration: 8_000,
		sampleRate: 48_000,
		sequenceRate: { num: 24, den: 1 },
		outputRate: { num: 60, den: 1 },
	});
	assert.equal(duplicated.outputFrameCount, 10);
	assert.deepEqual(
		Array.from({ length: duplicated.outputFrameCount }, (_, index) => duplicated.frameAt(index).sequenceFrame),
		[0, 0, 0, 1, 1, 2, 2, 2, 3, 3],
	);

	const dropped = createVideoRetimeOutputCadence({
		sampleStart: 0,
		sampleDuration: 20_000,
		sampleRate: 48_000,
		sequenceRate: { num: 24, den: 1 },
		outputRate: { num: 12, den: 1 },
	});
	assert.equal(dropped.outputFrameCount, 5);
	assert.deepEqual(
		Array.from({ length: dropped.outputFrameCount }, (_, index) => dropped.frameAt(index).sequenceFrame),
		[0, 2, 4, 6, 8],
	);
});

test('maps output frames to clip-relative cells and returns null outside the clip half-open range', () => {
	const cadence = createVideoRetimeOutputCadence({
		sampleStart: 96_001,
		sampleDuration: 5_000,
		sampleRate: 48_000,
		sequenceRate: { num: 24, den: 1 },
	});

	assert.equal(cadence.localCellAt(0, 49, 2), null);
	assert.equal(cadence.localCellAt(1, 49, 2), 0);
	assert.equal(cadence.localCellAt(2, 49, 2), 1);
	assert.equal(cadence.localCellAt(0, 46, 2), null);
	assert.equal(cadence.localCellAt(2, 51, 2), null);
});

test('constructs a two-million-frame cadence lazily and caches only queried frame descriptors', () => {
	const cadence = createVideoRetimeOutputCadence({
		sampleStart: 0,
		sampleDuration: 1,
		sampleRate: 1,
		sequenceRate: { num: 1, den: 1 },
		outputRate: { num: 2_000_000, den: 1 },
	});

	assert.equal(cadence.outputFrameCount, 2_000_000);
	const first = cadence.frameAt(0);
	assert.deepEqual(first, {
		outputFrame: 0,
		relativePts: { numerator: 0n, denominator: 1n },
		absoluteSample: 0,
		sequenceFrame: 0,
	});
	const last = cadence.frameAt(1_999_999);
	assert.deepEqual(last, {
		outputFrame: 1_999_999,
		relativePts: { numerator: 1_999_999n, denominator: 2_000_000n },
		absoluteSample: 0,
		sequenceFrame: 0,
	});
	assert.strictEqual(cadence.frameAt(1_999_999), last);
	assert.equal(cadence.localCellAt(1_999_999, 0, 1), 0);
	assert.equal(Object.hasOwn(cadence, 'frames'), false);
	assert.equal(Object.hasOwn(cadence, 'cache'), false);
	assert.deepEqual(Object.keys(cadence).sort(), [
		'frameAt',
		'localCellAt',
		'outputFrameCount',
		'outputRate',
		'sampleDuration',
		'sampleRate',
		'sampleStart',
		'sequenceRate',
	]);
});

test('compares the sequence-rate sample-grid bound with exact integer arithmetic', () => {
	const atBound = createVideoRetimeOutputCadence({
		sampleStart: 0,
		sampleDuration: 1,
		sampleRate: 48_000,
		sequenceRate: { num: 48_000, den: 1 },
		outputRate: { num: 1, den: 1 },
	});
	assert.equal(atBound.frameAt(0).sequenceFrame, 0);

	const maximumSafeInteger = Number.MAX_SAFE_INTEGER;
	const largeExactProduct = createVideoRetimeOutputCadence({
		sampleStart: 0,
		sampleDuration: 1,
		sampleRate: maximumSafeInteger,
		sequenceRate: { num: maximumSafeInteger, den: maximumSafeInteger - 1 },
		outputRate: { num: 1, den: 1 },
	});
	assert.equal(largeExactProduct.outputFrameCount, 1);

	assert.throws(
		() => createVideoRetimeOutputCadence({
			sampleStart: 0,
			sampleDuration: 1,
			sampleRate: 48_000,
			sequenceRate: { num: 48_001, den: 1 },
			outputRate: { num: 1, den: 1 },
		}),
		/rate|sample/i,
	);
});

test('rejects unsafe domains, oversized counts, and invalid query indices', () => {
	for (const rate of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => videoRetimeOutputRateFromInteger(rate), /rate|integer|safe/i);
	}

	const valid = {
		sampleStart: 0,
		sampleDuration: 1,
		sampleRate: 48_000,
		sequenceRate: { num: 24, den: 1 },
		outputRate: { num: 24, den: 1 },
	};
	for (const input of [
		{ ...valid, sampleStart: -1 },
		{ ...valid, sampleStart: Number.MAX_SAFE_INTEGER },
		{ ...valid, sampleDuration: 0 },
		{ ...valid, sampleDuration: Number.MAX_SAFE_INTEGER + 1 },
		{ ...valid, sampleRate: 0 },
		{ ...valid, sampleRate: 48_000.5 },
	]) {
		assert.throws(() => createVideoRetimeOutputCadence(input), /sample|safe|integer/i);
	}
	assert.throws(
		() => createVideoRetimeOutputCadence({
			sampleStart: 0,
			sampleDuration: 1,
			sampleRate: 1,
			sequenceRate: { num: 1, den: 1 },
			outputRate: { num: 2_000_001, den: 1 },
		}),
		/count|frame|2.?000.?000/i,
	);

	const cadence = createVideoRetimeOutputCadence(valid);
	for (const index of [-1, 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => cadence.frameAt(index), /index|frame|integer/i);
	}
	for (const [index, sequenceStartFrame, outerFrameCount] of [
		[-1, 0, 1],
		[1, 0, 1],
		[0, -1, 1],
		[0, 0.5, 1],
		[0, 0, 0],
		[0, 0, Number.MAX_SAFE_INTEGER + 1],
	]) {
		assert.throws(
			() => cadence.localCellAt(index, sequenceStartFrame, outerFrameCount),
			/index|frame|count|safe|integer/i,
		);
	}
});

test('rejects Number rates, noncanonical or open rational records, and every accessor without invoking it', () => {
	const base = {
		sampleStart: 0,
		sampleDuration: 48_000,
		sampleRate: 48_000,
		sequenceRate: { num: 24, den: 1 },
		outputRate: { num: 24, den: 1 },
	};
	for (const input of [
		{ ...base, sequenceRate: 24 },
		{ ...base, outputRate: 60 },
		{ ...base, sequenceRate: { num: 24, den: 1, extra: true } },
		{ ...base, outputRate: { num: 60, den: 1, extra: true } },
		{ ...base, sequenceRate: { num: 48, den: 2 } },
		{ ...base, outputRate: { num: 60, den: 2 } },
		{ ...base, sequenceRate: { num: 0, den: 1 } },
		{ ...base, outputRate: { num: 1, den: 0 } },
		{ ...base, outputRate: { num: Number.MAX_SAFE_INTEGER + 1, den: 1 } },
		{ ...base, extra: true },
	]) {
		assert.throws(() => createVideoRetimeOutputCadence(input as never), /input|rate|record|canonical|safe/i);
	}

	let getterCalls = 0;
	const topLevelAccessor = { ...base };
	Object.defineProperty(topLevelAccessor, 'sampleStart', {
		enumerable: true,
		get: () => {
			getterCalls += 1;
			return 0;
		},
	});
	assert.throws(
		() => createVideoRetimeOutputCadence(topLevelAccessor),
		/accessor|data|property|record/i,
	);
	assert.equal(getterCalls, 0);

	const rateAccessor = {} as { num: number; den: number };
	Object.defineProperties(rateAccessor, {
		num: {
			enumerable: true,
			get: () => {
				getterCalls += 1;
				return 24;
			},
		},
		den: { enumerable: true, value: 1 },
	});
	assert.throws(
		() => createVideoRetimeOutputCadence({ ...base, sequenceRate: rateAccessor }),
		/accessor|data|property|record|rate/i,
	);
	assert.equal(getterCalls, 0);
});

test('validates top-level and nested values from their data descriptors without Proxy get TOCTOU', () => {
	let topLevelGets = 0;
	const invalidTopLevel = new Proxy({
		sampleStart: 0,
		sampleDuration: 0,
		sampleRate: 48_000,
		sequenceRate: { num: 24, den: 1 },
	}, {
		get(target, key, receiver) {
			topLevelGets += 1;
			if (key === 'sampleDuration') return 48_000;
			return Reflect.get(target, key, receiver);
		},
	});
	assert.throws(
		() => createVideoRetimeOutputCadence(invalidTopLevel),
		/sampleDuration|positive/i,
	);
	assert.equal(topLevelGets, 0);

	let rateGets = 0;
	const invalidRate = new Proxy({ num: 0, den: 1 }, {
		get(target, key, receiver) {
			rateGets += 1;
			if (key === 'num') return 24;
			return Reflect.get(target, key, receiver);
		},
	});
	assert.throws(
		() => createVideoRetimeOutputCadence({
			sampleStart: 0,
			sampleDuration: 48_000,
			sampleRate: 48_000,
			sequenceRate: invalidRate,
		}),
		/sequenceRate\.num|positive/i,
	);
	assert.equal(rateGets, 0);
});
