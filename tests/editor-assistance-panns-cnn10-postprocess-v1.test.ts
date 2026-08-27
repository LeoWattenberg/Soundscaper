/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT,
	ASSISTANCE_PANNS_CNN10_MAXIMUM_BINDINGS,
	ASSISTANCE_PANNS_CNN10_MAXIMUM_WINDOWS,
	createAssistancePannsCnn10AudioTagsV1,
	createAssistancePannsCnn10ScoreProjectorV1,
} from '../src/common/editor/assistance/panns-cnn10-postprocess-v1.ts';

const BINDINGS = Object.freeze([
	Object.freeze({ index: 1, label: 'Laughter', signal: 'laughter' as const }),
	Object.freeze({ index: 2, label: 'Giggle', signal: 'laughter' as const }),
	Object.freeze({ index: 7, label: 'Applause', signal: 'applause' as const }),
	Object.freeze({ index: 11, label: 'Cheering', signal: 'cheering' as const }),
]);

function scores(values: Readonly<Record<number, number>> = {}): Float32Array {
	const result = new Float32Array(ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT);
	for (const [index, value] of Object.entries(values)) result[Number(index)] = value;
	return result;
}

function request(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		schemaVersion: 1,
		sampleRate: 32_000,
		channelCount: 1,
		windowSamples: 32_000,
		classCount: ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT,
		scoreKind: 'probabilities',
		classBindings: BINDINGS,
		windows: [{
			startSample: 0,
			scores: scores({ 1: 0.25, 2: 0.75, 7: 0.5, 11: 1 }),
		}, {
			startSample: 64_000,
			scores: scores({ 1: 0.5, 2: 0.25, 7: 0, 11: 0.125 }),
		}],
		...overrides,
	};
}

test('PANNs Cnn10 aggregates exact AudioSet bindings into canonical excitement tags', () => {
	const reviewed = createAssistancePannsCnn10AudioTagsV1(request());

	assert.deepEqual(reviewed, {
		schemaVersion: 1,
		sampleRate: 32_000,
		windowSamples: 32_000,
		windows: [{
			startSample: 0,
			scores: { laughter: 0.75, applause: 0.5, cheering: 1 },
		}, {
			startSample: 64_000,
			scores: { laughter: 0.5, applause: 0, cheering: 0.125 },
		}],
	});
	assert.deepEqual(Object.keys(reviewed.windows[0]?.scores ?? {}).sort(), [
		'applause', 'cheering', 'laughter',
	]);
	assert.ok(Object.isFrozen(reviewed));
	assert.ok(Object.isFrozen(reviewed.windows));
	assert.ok(Object.isFrozen(reviewed.windows[0]?.scores));
});

test('PANNs Cnn10 converts finite logits stably before maximum aggregation', () => {
	const input = scores({ 1: -1_000, 2: 0, 7: 2, 11: 1_000 });
	const result = createAssistancePannsCnn10AudioTagsV1(request({
		scoreKind: 'logits',
		windows: [{ startSample: 0, scores: input }],
	}));

	assert.equal(result.windows[0]?.scores.laughter, 0.5);
	assert.equal(result.windows[0]?.scores.applause,
		Math.round((1 / (1 + Math.exp(-2))) * 1e12) / 1e12);
	assert.equal(result.windows[0]?.scores.cheering, 1);
});

test('PANNs Cnn10 bounded window projection is semantically equal to whole-result projection', () => {
	const input = request();
	const whole = createAssistancePannsCnn10AudioTagsV1(input);
	const projector = createAssistancePannsCnn10ScoreProjectorV1('probabilities', BINDINGS);
	const streamed = input.windows.map((window) => projector.project(window.startSample, window.scores));

	assert.deepEqual(streamed, whole.windows);
	assert.ok(streamed.every((window) => Object.isFrozen(window) && Object.isFrozen(window.scores)));
});

test('PANNs Cnn10 binds an ordered, unique exact-index AudioSet authority', () => {
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classCount: ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT - 1,
	})), /class.*count|527|AudioSet/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: [BINDINGS[1], BINDINGS[0], BINDINGS[2], BINDINGS[3]],
	})), /binding.*ordered|index/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: [BINDINGS[0], { ...BINDINGS[1], index: 1 }, BINDINGS[2], BINDINGS[3]],
	})), /binding.*ordered|index|repeat/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: BINDINGS.slice(0, 3),
	})), /cheering|every.*signal|authority/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: [
			...BINDINGS, { index: ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT,
				label: 'Outside map', signal: 'cheering' },
		],
	})), /binding.*index|invalid/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: [
			{ ...BINDINGS[0], signal: 'speech' }, BINDINGS[1], BINDINGS[2], BINDINGS[3],
		],
	})), /signal|unsupported/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: [
			{ ...BINDINGS[0], label: 'Laughter\u0000' }, BINDINGS[1], BINDINGS[2], BINDINGS[3],
		],
	})), /label|text/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: [
			{ ...BINDINGS[0], classId: '/m/03qtwd' }, BINDINGS[1], BINDINGS[2], BINDINGS[3],
		],
	})), /fields/iu);
});

test('PANNs Cnn10 refuses non-baseline audio and window geometry', () => {
	for (const overrides of [
		{ schemaVersion: 2 },
		{ sampleRate: 16_000 },
		{ channelCount: 2 },
		{ windowSamples: 16_000 },
		{ windows: [{ startSample: 1, scores: scores() }] },
		{ windows: [
			{ startSample: 32_000, scores: scores() },
			{ startSample: 0, scores: scores() },
		] },
		{ windows: [{ startSample: 0, scores: new Float32Array(
			ASSISTANCE_PANNS_CNN10_AUDIOSET_CLASS_COUNT - 1,
		) }] },
		{ windows: [{ startSample: 0, scores: [...scores()] }] },
		{ windows: [] },
	] as const) {
		assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request(overrides)),
			/schema|audio|mono|window|sample|score|geometry|ordered/iu);
	}
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1({ ...request(), invented: true }),
		/fields/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		windows: [{ ...request().windows[0], activation: 'sigmoid' }],
	})), /fields/iu);
});

test('PANNs Cnn10 rejects NaN, infinity, and out-of-domain probability scores', () => {
	for (const invalid of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
		assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
			scoreKind: 'logits', windows: [{ startSample: 0, scores: scores({ 1: invalid }) }],
		})), /finite|score|logit/iu);
	}
	for (const invalid of [-0.1, 1.1]) {
		assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
			windows: [{ startSample: 0, scores: scores({ 1: invalid }) }],
		})), /probability|unit|score/iu);
	}
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		scoreKind: 'scores',
	})), /score.*kind|logit|probabilit/iu);
});

test('PANNs Cnn10 rejects oversized windows and class bindings before visiting entries', () => {
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		windows: new Array(ASSISTANCE_PANNS_CNN10_MAXIMUM_WINDOWS + 1),
	})), /window.*bound|inventory/iu);
	assert.throws(() => createAssistancePannsCnn10AudioTagsV1(request({
		classBindings: new Array(ASSISTANCE_PANNS_CNN10_MAXIMUM_BINDINGS + 1),
	})), /binding.*bound|authority/iu);
});
