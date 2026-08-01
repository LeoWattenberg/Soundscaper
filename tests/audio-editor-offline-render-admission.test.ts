/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import {
	MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	OfflineRenderOutputMemoryLimitError,
	assertOfflineRenderOutputBufferGeometry,
	assertOfflineRenderOutputContextGeometry,
	planOfflineRenderOutputAdmission,
} from '../src/common/editor/engine/offline-render-admission.ts';

const MIB = 1024 * 1024;

test('offline render admission reports exact immutable no-crop output PCM', () => {
	const plan = planOfflineRenderOutputAdmission({
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 120,
		captureOffsetFrames: 0,
		requestedFrames: 120,
	});

	assert.deepEqual(plan, {
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 120,
		captureOffsetFrames: 0,
		requestedFrames: 120,
		maximumUsefulBinaryBytes: 256 * MIB,
		contextOutput: {
			bytes: 960,
			certainty: 'exact',
			scope: 'offline-context-output-float32-useful-binary',
		},
		cropOutput: {
			bytes: 0,
			certainty: 'exact',
			scope: 'offline-render-crop-float32-useful-binary',
		},
		peakUsefulBinaryWorkingSet: {
			bytes: 960,
			certainty: 'exact',
			scope: 'offline-render-output-peak-float32-useful-binary',
		},
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.contextOutput), true);
	assert.equal(Object.isFrozen(plan.cropOutput), true);
	assert.equal(Object.isFrozen(plan.peakUsefulBinaryWorkingSet), true);
});

test('offline render admission charges the crop while the context output remains live', () => {
	const plan = planOfflineRenderOutputAdmission({
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 150,
		captureOffsetFrames: 30,
		requestedFrames: 120,
	});

	assert.equal(plan.contextOutput.bytes, 1_200);
	assert.equal(plan.cropOutput.bytes, 960);
	assert.equal(plan.peakUsefulBinaryWorkingSet.bytes, 2_160);
});

test('offline render admission distinguishes exact production boundaries', () => {
	assert.equal(MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES, 256 * MIB);
	const noCrop = planOfflineRenderOutputAdmission({
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 33_554_432,
		captureOffsetFrames: 0,
		requestedFrames: 33_554_432,
	});
	assert.equal(
		noCrop.peakUsefulBinaryWorkingSet.bytes,
		MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	);
	assert.throws(
		() => planOfflineRenderOutputAdmission({
			channelCount: 2,
			sampleRate: 48_000,
			contextFrames: 33_554_433,
			captureOffsetFrames: 0,
			requestedFrames: 33_554_433,
		}),
		(error: unknown) => error instanceof OfflineRenderOutputMemoryLimitError
			&& error.code === 'OFFLINE_RENDER_OUTPUT_MEMORY_LIMIT'
			&& error.peakUsefulBinaryBytes
				=== MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES + 8,
	);

	const cropped = planOfflineRenderOutputAdmission({
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 16_777_217,
		captureOffsetFrames: 2,
		requestedFrames: 16_777_215,
	});
	assert.equal(
		cropped.peakUsefulBinaryWorkingSet.bytes,
		MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES,
	);
	assert.throws(
		() => planOfflineRenderOutputAdmission({
			channelCount: 2,
			sampleRate: 48_000,
			contextFrames: 16_777_218,
			captureOffsetFrames: 2,
			requestedFrames: 16_777_216,
		}),
		(error: unknown) => error instanceof OfflineRenderOutputMemoryLimitError
			&& error.peakUsefulBinaryBytes
				=== MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES + 16,
	);
});

test('offline render admission has a lower-only test seam', () => {
	const geometry = {
		channelCount: 1,
		sampleRate: 48_000,
		contextFrames: 10,
		captureOffsetFrames: 0,
		requestedFrames: 10,
	};
	assert.equal(
		planOfflineRenderOutputAdmission(geometry, { maximumUsefulBinaryBytes: 40 })
			.maximumUsefulBinaryBytes,
		40,
	);
	assert.throws(
		() => planOfflineRenderOutputAdmission(geometry, { maximumUsefulBinaryBytes: 39 }),
		(error: unknown) => error instanceof OfflineRenderOutputMemoryLimitError
			&& error.maximumUsefulBinaryBytes === 39,
	);
	for (const maximumUsefulBinaryBytes of [
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES + 1,
		null,
		'40',
	]) {
		assert.throws(
			() => planOfflineRenderOutputAdmission(
				geometry,
				{ maximumUsefulBinaryBytes } as never,
			),
			/offline render output maximum/iu,
		);
	}
});

test('offline render admission rejects malformed or inconsistent geometry', () => {
	const valid = {
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 10,
		captureOffsetFrames: 2,
		requestedFrames: 8,
	};
	for (const geometry of [
		{ ...valid, channelCount: 0 },
		{ ...valid, channelCount: 33 },
		{ ...valid, channelCount: 1.5 },
		{ ...valid, sampleRate: 0 },
		{ ...valid, sampleRate: 48_000.5 },
		{ ...valid, contextFrames: 0 },
		{ ...valid, captureOffsetFrames: -1 },
		{ ...valid, requestedFrames: 0 },
		{ ...valid, requestedFrames: 9 },
	]) {
		assert.throws(
			() => planOfflineRenderOutputAdmission(geometry),
			/offline render output/iu,
		);
	}
	assert.throws(
		() => planOfflineRenderOutputAdmission({
			channelCount: 32,
			sampleRate: 48_000,
			contextFrames: Number.MAX_SAFE_INTEGER,
			captureOffsetFrames: 0,
			requestedFrames: Number.MAX_SAFE_INTEGER,
		}),
		/safe integer range/iu,
	);
});

test('offline render context and result validation pin admitted geometry', () => {
	const plan = planOfflineRenderOutputAdmission({
		channelCount: 2,
		sampleRate: 48_000,
		contextFrames: 120,
		captureOffsetFrames: 20,
		requestedFrames: 100,
	});
	assert.doesNotThrow(() => assertOfflineRenderOutputContextGeometry({
		sampleRate: 48_000,
		length: 120,
	}, plan));
	for (const context of [
		{ sampleRate: 44_100, length: 120 },
		{ sampleRate: 48_000, length: 119 },
		null,
	]) {
		assert.throws(
			() => assertOfflineRenderOutputContextGeometry(context, plan),
			/offline render context/iu,
		);
	}
	const rendered = {
		numberOfChannels: 2,
		sampleRate: 48_000,
		length: 120,
		getChannelData: () => new Float32Array(120),
	};
	assert.doesNotThrow(() => assertOfflineRenderOutputBufferGeometry(rendered, plan));
	for (const candidate of [
		{ ...rendered, numberOfChannels: 1 },
		{ ...rendered, sampleRate: 44_100 },
		{ ...rendered, length: 119 },
		{ ...rendered, getChannelData: () => new Float32Array(119) },
		{ ...rendered, getChannelData: () => new Uint8Array(120) },
		null,
	]) {
		assert.throws(
			() => assertOfflineRenderOutputBufferGeometry(candidate, plan),
			/offline render output buffer/iu,
		);
	}
});

test('engine rejects oversized offline output before creating a context', async () => {
	let offlineContextFactoryCalls = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: (() => {
			offlineContextFactoryCalls += 1;
			throw new Error('Oversized OfflineAudioContext creation was reached.');
		}) as never,
	});
	const frameCount = 2_097_153;
	engine.loadProject({
		sampleRate: 48_000,
		masterChannels: 32,
		clips: [{ id: 'duration', timelineStartFrame: 0, durationFrames: frameCount }],
		tracks: [],
		master: { effects: [] },
	}, new Map());

	await assert.rejects(
		engine.renderMix({ startFrame: 0, endFrame: frameCount }),
		(error: unknown) => error instanceof OfflineRenderOutputMemoryLimitError
			&& error.code === 'OFFLINE_RENDER_OUTPUT_MEMORY_LIMIT',
	);
	assert.equal(offlineContextFactoryCalls, 0);
	await engine.dispose();
});

test('engine rejects mismatched context geometry before graph work', async () => {
	let destinationReads = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: ((options: {
			numberOfChannels: number;
			length: number;
			sampleRate: number;
		}) => ({
			length: options.length + 1,
			sampleRate: options.sampleRate,
			get destination() {
				destinationReads += 1;
				throw new Error('Graph work was reached.');
			},
		})) as never,
	});
	engine.loadProject(emptyProject());

	await assert.rejects(
		engine.renderMix({ outputFrames: 120 }),
		/offline render context geometry/iu,
	);
	assert.equal(destinationReads, 0);
	await engine.dispose();
});

test('engine rejects a rendered buffer which differs from its admission', async () => {
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: ((options: {
			numberOfChannels: number;
			length: number;
			sampleRate: number;
		}) => offlineContextFixture(options, options.length - 1)) as never,
	});
	engine.loadProject(emptyProject());

	await assert.rejects(
		engine.renderMix({ outputFrames: 120 }),
		/offline render output buffer geometry/iu,
	);
	await engine.dispose();
});

test('oversized geometry keeps the no-context software renderer fallback', async () => {
	const rendered = { channels: [Float32Array.of(0)] };
	let softwareRendererCalls = 0;
	const engine = createAudioEditorEngine({
		audioContextFactory: null,
		offlineAudioContextFactory: null,
		softwareRenderer() {
			softwareRendererCalls += 1;
			return rendered;
		},
	});
	const frameCount = 2_097_153;
	engine.loadProject({
		sampleRate: 48_000,
		masterChannels: 32,
		clips: [{ id: 'duration', timelineStartFrame: 0, durationFrames: frameCount }],
		tracks: [],
		master: { effects: [] },
	}, new Map());

	assert.strictEqual(
		await engine.renderMix({ startFrame: 0, endFrame: frameCount }),
		rendered,
	);
	assert.equal(softwareRendererCalls, 1);
	await engine.dispose();
});

function emptyProject() {
	return {
		sampleRate: 48_000,
		masterChannels: 2,
		clips: [],
		tracks: [],
		master: { effects: [] },
	};
}

function offlineContextFixture(
	options: { numberOfChannels: number; length: number; sampleRate: number },
	renderedLength: number,
) {
	const createNode = () => ({
		connect() {},
		disconnect() {},
	});
	return {
		...options,
		currentTime: 0,
		destination: createNode(),
		createGain() {
			return {
				...createNode(),
				gain: {
					value: 1,
					setValueAtTime(value: number) { this.value = value; },
				},
			};
		},
		async startRendering() {
			return {
				numberOfChannels: options.numberOfChannels,
				length: renderedLength,
				sampleRate: options.sampleRate,
				getChannelData: () => new Float32Array(renderedLength),
			};
		},
	};
}
