/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VAMP_ANALYZER_LIMITS,
	admitVampAnalyzerConfiguration,
	admitVampAnalyzerDescriptor,
	admitVampAnalyzerFeatures,
	admitVampAnalyzerPcmChunk,
	type VampAnalyzerDescriptor,
} from '../desktop/vamp-analyzer-contract.ts';

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		kind: 'analyzer', format: 'vamp', identifier: 'com.example.spectral-centroid',
		name: 'Spectral Centroid', description: 'Finds each frame centroid.', maker: 'Example',
		copyright: 'Example', pluginVersion: 3, vampApiVersion: 2,
		inputDomain: 'frequency', minimumChannels: 1, maximumChannels: 2,
		preferredStepSize: 512, preferredBlockSize: 1_024,
		parameters: [{
			identifier: 'threshold', name: 'Threshold', description: 'Floor', unit: 'dB',
			minimumValue: -120, maximumValue: 0, defaultValue: -60,
			quantizeStep: null, valueNames: [],
		}, {
			identifier: 'mode', name: 'Mode', description: 'Detection mode', unit: '',
			minimumValue: 0, maximumValue: 1, defaultValue: 0,
			quantizeStep: 1, valueNames: ['Fast', 'Precise'],
		}],
		programs: ['Default', 'Speech'],
		outputs: [{
			identifier: 'centroid', name: 'Centroid', description: 'Per-frame centroid', unit: 'Hz',
			binCount: 1, binNames: ['Centroid'], extents: { minimumValue: 0, maximumValue: 24_000 },
			quantizeStep: null, sampleType: 'one-sample-per-step', sampleRate: null,
			hasDuration: false,
		}, {
			identifier: 'events', name: 'Events', description: 'Detected events', unit: '',
			binCount: null, binNames: [], extents: null, quantizeStep: null,
			sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: true,
		}],
		...overrides,
	};
}

function validDescriptor(): VampAnalyzerDescriptor {
	return admitVampAnalyzerDescriptor(descriptor());
}

test('Vamp descriptors are analyzer-only, deeply admitted, and immutable', () => {
	const admitted = validDescriptor();
	assert.equal(admitted.kind, 'analyzer');
	assert.equal(admitted.format, 'vamp');
	assert.equal(admitted.parameters[1]?.quantizeStep, 1);
	assert.equal(admitted.outputs[0]?.binNames[0], 'Centroid');
	assert.ok(Object.isFrozen(admitted));
	assert.ok(Object.isFrozen(admitted.parameters));
	assert.ok(Object.isFrozen(admitted.outputs[0]));

	assert.throws(() => admitVampAnalyzerDescriptor(descriptor({ kind: 'effect' })), /analyzer kind/iu);
	assert.throws(() => admitVampAnalyzerDescriptor(descriptor({ format: 'vst3' })), /Vamp format/iu);
	assert.throws(() => admitVampAnalyzerDescriptor({ ...descriptor(), binaryPath: '/tmp/a.so' }), /keys/iu);
});

test('descriptor collections, value ranges, and output semantics have closed bounds', () => {
	const duplicatedParameters = descriptor({
		parameters: Array.from({ length: 2 }, () => ({
			identifier: 'same', name: 'Same', description: '', unit: '', minimumValue: 0,
			maximumValue: 1, defaultValue: 0, quantizeStep: null, valueNames: [],
		})),
	});
	assert.throws(() => admitVampAnalyzerDescriptor(duplicatedParameters), /duplicate.*parameter/iu);
	assert.throws(() => admitVampAnalyzerDescriptor(descriptor({
		parameters: Array.from({ length: VAMP_ANALYZER_LIMITS.maximumParameters + 1 }, (_, index) => ({
			identifier: `p${String(index)}`, name: 'P', description: '', unit: '', minimumValue: 0,
			maximumValue: 1, defaultValue: 0, quantizeStep: null, valueNames: [],
		})),
	})), /parameters/iu);
	assert.throws(() => admitVampAnalyzerDescriptor(descriptor({
		outputs: [{
			identifier: 'bad', name: 'Bad', description: '', unit: '', binCount: 2,
			binNames: ['only-one'], extents: null, quantizeStep: null,
			sampleType: 'one-sample-per-step', sampleRate: null, hasDuration: false,
		}],
	})), /bin names/iu);
	assert.throws(() => admitVampAnalyzerDescriptor(descriptor({
		outputs: [{
			identifier: 'bad', name: 'Bad', description: '', unit: '', binCount: null,
			binNames: [], extents: null, quantizeStep: null,
			sampleType: 'fixed-sample-rate', sampleRate: null, hasDuration: false,
		}],
	})), /sample rate/iu);
});

test('configuration fills parameter defaults and enforces program, channel, and duration limits', () => {
	const admitted = validDescriptor();
	const configured = admitVampAnalyzerConfiguration({
		sampleRate: 48_000, channelCount: 2, stepSize: 512, blockSize: 1_024,
		frameCount: 48_000 * 60, parameters: { threshold: -42 }, program: 'Speech',
	}, admitted);
	assert.deepEqual(configured.parameters, { threshold: -42, mode: 0 });
	assert.equal(configured.program, 'Speech');
	assert.ok(Object.isFrozen(configured.parameters));

	assert.throws(() => admitVampAnalyzerConfiguration({
		...configured, parameters: { surprise: 1 },
	}, admitted), /unknown.*parameter/iu);
	assert.throws(() => admitVampAnalyzerConfiguration({
		...configured, program: 'Unlisted',
	}, admitted), /program/iu);
	assert.throws(() => admitVampAnalyzerConfiguration({
		...configured, stepSize: 2_048,
	}, admitted), /step size/iu);
	assert.throws(() => admitVampAnalyzerConfiguration({
		...configured, frameCount: (48_000 * VAMP_ANALYZER_LIMITS.maximumSessionSeconds) + 1,
	}, admitted), /duration/iu);
});

test('PCM chunks are copied, finite, contiguous, and bounded by the configured source', () => {
	const configuration = admitVampAnalyzerConfiguration({
		sampleRate: 48_000, channelCount: 2, stepSize: 2, blockSize: 4,
		frameCount: 6, parameters: {}, program: null,
	}, validDescriptor());
	const left = Float32Array.from([0, 0.25, -0.25]);
	const admitted = admitVampAnalyzerPcmChunk({
		startFrame: 0, channels: [left, Float32Array.from([1, 0, -1])],
	}, configuration, 0);
	left[0] = 1;
	assert.equal(admitted.channels[0]?.[0], 0, 'backend input is detached from the renderer-owned view');
	assert.equal(admitted.frameCount, 3);

	assert.throws(() => admitVampAnalyzerPcmChunk({
		startFrame: 2, channels: [Float32Array.of(0), Float32Array.of(0)],
	}, configuration, 3), /contiguous/iu);
	assert.throws(() => admitVampAnalyzerPcmChunk({
		startFrame: 3, channels: [Float32Array.of(Number.NaN), Float32Array.of(0)],
	}, configuration, 3), /finite/iu);
	assert.throws(() => admitVampAnalyzerPcmChunk({
		startFrame: 5, channels: [Float32Array.of(0, 0), Float32Array.of(0, 0)],
	}, configuration, 5), /frame count/iu);
});

test('feature admission binds output IDs, bin counts, timestamps, durations, and aggregate limits', () => {
	const admitted = validDescriptor();
	const features = admitVampAnalyzerFeatures([{
		outputId: 'centroid', timestamp: null, duration: null, values: [440], label: 'A4',
	}, {
		outputId: 'events', timestamp: { seconds: 1, nanoseconds: 250_000_000 },
		duration: { seconds: 0, nanoseconds: 125_000_000 }, values: [0.9, 1], label: 'onset',
	}], admitted.outputs);
	assert.equal(features.length, 2);
	assert.ok(Object.isFrozen(features[1]?.values));

	assert.throws(() => admitVampAnalyzerFeatures([{
		outputId: 'missing', timestamp: null, duration: null, values: [], label: '',
	}], admitted.outputs), /unknown.*output/iu);
	assert.throws(() => admitVampAnalyzerFeatures([{
		outputId: 'centroid', timestamp: null, duration: null, values: [1, 2], label: '',
	}], admitted.outputs), /bin count/iu);
	assert.throws(() => admitVampAnalyzerFeatures([{
		outputId: 'events', timestamp: null,
		duration: { seconds: 0, nanoseconds: 1 }, values: [], label: '',
	}], admitted.outputs), /timestamp/iu);
	assert.throws(() => admitVampAnalyzerFeatures([{
		outputId: 'events', timestamp: { seconds: 0, nanoseconds: 0 }, duration: null,
		values: [], label: '',
	}], admitted.outputs), /duration/iu);
});
