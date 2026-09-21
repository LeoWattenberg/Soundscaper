/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVampAnalysisRepeatRequest,
	normalizeVampAnalysisRequest,
	normalizeVampAnalysisResult,
	normalizeVampAnalyzerCatalog,
	vampAnalysisCacheKey,
	vampFeatureFrameRange,
	vampTimestampToFrame,
} from '../src/common/editor/vamp-analysis.ts';

const BINARY_SHA256 = 'ab'.repeat(32);
const PCM_SHA256 = 'cd'.repeat(32);

test('Vamp catalog and requests normalize closed native-independent models', () => {
	const catalog = normalizeVampAnalyzerCatalog([analyzer()]);
	assert.equal(catalog[0]?.outputs[0]?.sampleType, 'variable-sample-rate');
	assert.ok(Object.isFrozen(catalog));
	assert.ok(Object.isFrozen(catalog[0]?.parameters));

	const request = normalizeVampAnalysisRequest({
		schemaVersion: 1,
		analyzerId: 'installed-onsets',
		stableId: 'vamp-example-plugins:percussiononsets',
		binarySha256: BINARY_SHA256,
		outputId: 'onsets',
		program: 'Percussive',
		parameters: [
			{ id: 'sensitivity', value: 0.75 },
			{ id: 'threshold', value: 0.25 },
		],
		scope: 'track',
		startFrame: 1_000,
		endFrame: 45_100,
		sampleRate: 44_100,
	});
	assert.deepEqual(request.parameters.map(({ id }) => id), ['sensitivity', 'threshold']);
	assert.ok(Object.isFrozen(request.parameters));

	assert.throws(
		() => normalizeVampAnalyzerCatalog([{ ...analyzer(), surprise: true }]),
		/unknown.*surprise/iu,
	);
	assert.throws(
		() => normalizeVampAnalyzerCatalog([{ ...analyzer(), outputs: [output(), output()] }]),
		/duplicate.*output/iu,
	);
	assert.throws(
		() => normalizeVampAnalysisRequest({ ...request, parameters: [
			{ id: 'threshold', value: 0.25 }, { id: 'threshold', value: 0.5 },
		] }),
		/duplicate.*parameter/iu,
	);
	assert.throws(
		() => normalizeVampAnalysisRequest({ ...request, endFrame: request.startFrame }),
		/end.*after.*start/iu,
	);
});

test('Vamp renderer admission matches native program and feature-value boundaries', () => {
	const programs = Array.from({ length: 513 }, (_, index) => `Program ${String(index)}`);
	const catalog = normalizeVampAnalyzerCatalog([{ ...analyzer(), programs }]);
	assert.equal(catalog[0]?.programs.length, programs.length);

	const request = requestFixture();
	const values = Array.from({ length: 4_097 }, (_, index) => index / 4_097);
	const result = normalizeVampAnalysisResult({
		schemaVersion: 1, request,
		features: [feature(0, 100_000_000, null, values, 'spectrum')],
	}, request);
	assert.equal(result.features[0]?.values.length, values.length);
});

test('Vamp results bind every feature to the exact request and reject unsafe output', () => {
	const request = requestFixture();
	const result = normalizeVampAnalysisResult({
		schemaVersion: 1,
		request,
		features: [
			feature(0, 100_000_000, null, [0.5], 'Kick'),
			feature(0, 500_000_000, { seconds: 0, nanoseconds: 250_000_000 }, [0.8], ''),
		],
	}, request);
	assert.equal(result.features.length, 2);
	assert.ok(Object.isFrozen(result.features[0]?.values));

	assert.throws(
		() => normalizeVampAnalysisResult({ ...result, request: { ...request, outputId: 'beats' } }, request),
		/does not match/iu,
	);
	assert.throws(
		() => normalizeVampAnalysisResult({
			...result,
			features: [
				feature(0, 500_000_000, null, [], ''),
				feature(0, 400_000_000, null, [], ''),
			],
		}),
		/ordered/iu,
	);
	assert.throws(
		() => normalizeVampAnalysisResult({
			...result,
			features: [feature(1, 1, null, [], '')],
		}),
		/outside.*range/iu,
	);
	assert.throws(
		() => normalizeVampAnalysisResult({
			...result,
			features: [feature(0, 1, null, [Number.NaN], '')],
		}),
		/finite/iu,
	);
});

test('Vamp time conversion is exact at variable sample rates and encloses durations', () => {
	assert.equal(vampTimestampToFrame({ seconds: 1, nanoseconds: 500_000_000 }, 44_100), 66_150);
	assert.equal(vampTimestampToFrame({ seconds: 0, nanoseconds: 1 }, 44_100, 'enclosingStart'), 0);
	assert.equal(vampTimestampToFrame({ seconds: 0, nanoseconds: 1 }, 44_100, 'enclosingEnd'), 1);
	assert.throws(
		() => vampTimestampToFrame({ seconds: 0, nanoseconds: 1 }, 44_100, 'directional'),
		/directional rounding requires/iu,
	);

	const range = vampFeatureFrameRange(requestFixture(), feature(
		0,
		100_000_001,
		{ seconds: 0, nanoseconds: 100_000_001 },
		[],
		'Hit',
	));
	assert.deepEqual(range, {
		startFrame: 5_410,
		endFrame: 9_821,
		point: false,
	});
	const point = vampFeatureFrameRange(
		requestFixture(),
		feature(0, 500_000_000, null, [], 'Marker'),
	);
	assert.deepEqual(point, { startFrame: 23_050, endFrame: 23_050, point: true });
});

test('Vamp cache and repeat identities are canonical and deeply immutable', () => {
	const request = requestFixture();
	const reversed = { ...request, parameters: [...request.parameters].reverse() };
	const key = vampAnalysisCacheKey(request, PCM_SHA256);
	assert.match(key, /^vamp-analysis-v1:[a-f0-9]{64}$/u);
	assert.equal(vampAnalysisCacheKey(reversed, PCM_SHA256), key);
	assert.notEqual(vampAnalysisCacheKey({ ...request, program: null }, PCM_SHA256), key);
	assert.notEqual(vampAnalysisCacheKey(request, 'ef'.repeat(32)), key);

	const repeat = createVampAnalysisRepeatRequest(request);
	assert.deepEqual(repeat, { type: 'vamp', request });
	assert.ok(Object.isFrozen(repeat));
	assert.ok(Object.isFrozen(repeat.request.parameters));
});

function analyzer() {
	return {
		analyzerId: 'installed-onsets',
		stableId: 'vamp-example-plugins:percussiononsets',
		binarySha256: BINARY_SHA256,
		name: 'Percussion Onsets',
		maker: 'Vamp Example Plugins',
		programs: ['Percussive'],
		parameters: [{
			id: 'threshold', name: 'Threshold', description: 'Detection threshold', unit: '',
			minValue: 0, maxValue: 1, defaultValue: 0.5, quantizeStep: null,
		}],
		outputs: [output()],
	};
}

function output() {
	return {
		id: 'onsets', name: 'Onsets', description: 'Detected percussion onsets', unit: '',
		sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false,
	};
}

function requestFixture() {
	return normalizeVampAnalysisRequest({
		schemaVersion: 1,
		analyzerId: 'installed-onsets',
		stableId: 'vamp-example-plugins:percussiononsets',
		binarySha256: BINARY_SHA256,
		outputId: 'onsets',
		program: 'Percussive',
		parameters: [{ id: 'threshold', value: 0.5 }],
		scope: 'track',
		startFrame: 1_000,
		endFrame: 45_100,
		sampleRate: 44_100,
	});
}

function feature(
	seconds: number,
	nanoseconds: number,
	duration: Readonly<{ seconds: number; nanoseconds: number }> | null,
	values: readonly number[],
	label: string,
) {
	return {
		timestamp: { seconds, nanoseconds },
		duration,
		values,
		label,
	};
}
