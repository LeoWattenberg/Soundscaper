/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1,
	type AssistanceOnnxTensorV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from
	'../desktop/assistance-runtime-family-file-grants.ts';
import {
	assertAssistanceOnnxDereverbModelBindingV1,
} from '../desktop/assistance-operation-family-execution.ts';
import {
	runAssistanceRuntimeFamilyWorkerJobV1,
} from '../desktop/assistance-runtime-family-worker-entry.ts';
import { encodeWav } from '../src/common/editor/wav.js';

type TensorValue = AssistanceOnnxTensorV1;

const JOB_ID = 'a'.repeat(40);
const INPUT_ID = 'b'.repeat(40);
const OUTPUT_ID = 'c'.repeat(40);
const SPECTRUM_FRAMES = 751;
const FREQUENCY_BINS = 1_025;

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function audio(frameCount = 2_048, channelCount = 2): Uint8Array {
	const channels = Array.from({ length: channelCount }, (_value, channel) =>
		Float32Array.from({ length: frameCount }, (_frame, frame) =>
			0.4 * Math.sin(frame / (17 + channel * 3)) + (frame % 997 === 0 ? 0.2 : 0)));
	return encodeWav(channels, { sampleRate: 44_100, bitDepth: 32, float: true, dither: false });
}

async function dereverbFixture(
	context: TestContext,
	overrides: Readonly<{ audio?: Uint8Array; modelId?: string }> = {},
) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-dereverb-ort-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const inputBytes = overrides.audio ?? audio();
	const modelBytes = Buffer.from('converted-dereverb-room-network');
	const input = join(root, 'audio.wav');
	const model = join(root, 'dereverb-room.onnx');
	const output = join(root, 'dereverberated.wav');
	await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes),
		writeFile(output, new Uint8Array())]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'dereverberation',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'dereverberation',
			inputRoles: ['audio'], outputRoles: ['enhanced-audio'] }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'audio', mediaType: 'audio/wav', byteLength: inputBytes.byteLength,
			sha256: digest(inputBytes) }, path: input }],
		models: [{ modelId: overrides.modelId ?? 'dereverb-room', version: '1.0.0',
			artifactRole: 'network', path: model, byteLength: modelBytes.byteLength,
			sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'enhanced-audio' as const, mediaType: 'audio/wav',
			maximumByteLength: 16 * 1024 * 1024 }, path: output }],
	});
	return Object.freeze({
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: JOB_ID,
			familyId: 'onnxruntime-node' as const, task: 'dereverberation' as const,
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: Object.freeze({ familyId: 'onnxruntime-node' as const,
				runtimeVersion: '1.29.0', target: 'linux-x64' as const,
				executionProvider: 'cpu' as const, entrypoint: '/runtime/onnxruntime-node/index.js',
				files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js',
					relativePath: 'index.js', byteLength: 1, sha256: '6'.repeat(64),
					executable: false }]) }),
		}),
		paths: Object.freeze({ input, model, output }), inputBytes,
	});
}

function identityMask(): Readonly<Record<string, TensorValue>> {
	const mask = new Float32Array(FREQUENCY_BINS * SPECTRUM_FRAMES * 2);
	for (let index = 0; index < mask.length; index += 2) mask[index] = 1;
	return Object.freeze({ output: tensor(mask,
		[1, 1, FREQUENCY_BINS, SPECTRUM_FRAMES, 2]) });
}

function tensor(data: Float32Array, dims: readonly number[]): TensorValue {
	return Object.freeze({ type: 'float32', data, dims });
}

function fakeRuntime(
	inputNames: readonly string[],
	outputNames: readonly string[],
	run: (feeds: Readonly<Record<string, TensorValue>>) => Promise<Readonly<Record<string, TensorValue>>>,
	release?: () => void,
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements TensorValue {
		constructor(readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[]) {}
	}
	return Object.freeze({ Tensor, InferenceSession: Object.freeze({
		create: async () => Object.freeze({ inputNames, outputNames, run,
			...(release ? { release } : {}) }),
	}) });
}

function inspectFloatWave(value: Uint8Array): Readonly<{
	sampleRate: number; channels: readonly Float32Array[];
}> {
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	assert.equal(Buffer.from(value.subarray(0, 4)).toString('ascii'), 'RIFF');
	const channelCount = view.getUint16(22, true);
	const sampleRate = view.getUint32(24, true);
	const frameCount = view.getUint32(40, true) / (4 * channelCount);
	const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			channels[channel]![frame] = view.getFloat32(44 + (frame * channelCount + channel) * 4, true);
		}
	}
	return Object.freeze({ sampleRate, channels: Object.freeze(channels) });
}

test('dereverb-room preserves exact 44.1 kHz stereo geometry through an identity mask',
	async (context) => {
		const fixture = await dereverbFixture(context);
		const feedGeometries: Array<readonly number[]> = [];
		let released = 0;
		const progress: number[] = [];
		const runtime = fakeRuntime(['input'], ['output'], async (feeds) => {
			feedGeometries.push(feeds.input!.dims);
			assert.ok((feeds.input!.data as Float32Array).every(Number.isFinite));
			return identityMask();
		}, () => { released += 1; });
		const result = await runAssistanceRuntimeFamilyWorkerJobV1({
			job: fixture.job, onProgress: (ratio) => progress.push(ratio),
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		});
		// One 384000-frame chunk per channel for a 2048-frame stereo selection.
		assert.deepEqual(feedGeometries, [
			[1, SPECTRUM_FRAMES, FREQUENCY_BINS * 2], [1, SPECTRUM_FRAMES, FREQUENCY_BINS * 2],
		]);
		assert.equal(released, 1);
		assert.equal(progress[0], 0);
		assert.equal(progress.at(-1), 1);
		const outputBytes = await readFile(fixture.paths.output);
		const output = inspectFloatWave(outputBytes);
		const input = inspectFloatWave(fixture.inputBytes);
		assert.equal(output.sampleRate, 44_100);
		assert.equal(output.channels.length, 2);
		assert.equal(output.channels[0]!.length, input.channels[0]!.length);
		for (let channel = 0; channel < input.channels.length; channel += 1) {
			const maximumError = input.channels[channel]!.reduce((maximum, sample, frame) =>
				Math.max(maximum, Math.abs(sample - output.channels[channel]![frame]!)), 0);
			assert.ok(maximumError < 2e-4, `identity mask error ${String(maximumError)}`);
		}
		assert.equal(result.outputs[0]!.sha256, digest(outputBytes));
		assert.equal(result.outputs[0]!.role, 'enhanced-audio');
	});

test('dereverb-room rejects substituted artifacts, foreign graphs, and non-finite masks',
	async (context) => {
		const substitution = await dereverbFixture(context, { modelId: 'other-dereverb' });
		let loaded = false;
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: substitution.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
				loaded = true; return fakeRuntime([], [], async () => ({}));
			} }),
		}), /dereverb-room|model|artifact/iu);
		assert.equal(loaded, false);

		const foreignGraph = await dereverbFixture(context);
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: foreignGraph.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () =>
				fakeRuntime(['spectrum'], ['mask'], async () => ({})) }),
		}), /graph|signature|input|output/iu);

		const nan = await dereverbFixture(context);
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: nan.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () =>
				fakeRuntime(['input'], ['output'], async () => {
					const output = identityMask();
					(output.output!.data as Float32Array)[0] = Number.NaN;
					return output;
				}) }),
		}), /finite|mask|tensor/iu);
	});

test('dereverb-room observes cancellation between channel graph calls without publishing a WAV',
	async (context) => {
		const fixture = await dereverbFixture(context);
		const controller = new AbortController();
		let calls = 0;
		let released = 0;
		const runtime = fakeRuntime(['input'], ['output'], async () => {
			calls += 1;
			controller.abort(new DOMException('cancelled', 'AbortError'));
			return identityMask();
		}, () => { released += 1; });
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: fixture.job, signal: controller.signal,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		}), { name: 'AbortError' });
		assert.equal(calls, 1);
		assert.equal(released, 1);
		assert.equal((await readFile(fixture.paths.output)).byteLength, 0);
	});

test('the dereverb-room binding gate closes model and version substitution', () => {
	assert.doesNotThrow(() => assertAssistanceOnnxDereverbModelBindingV1(
		{ modelId: 'dereverb-room', version: '1.0.0' } as never));
	assert.throws(() => assertAssistanceOnnxDereverbModelBindingV1(
		{ modelId: 'deepfilternet3', version: '3.0.0' } as never), /dereverb-room/u);
	assert.throws(() => assertAssistanceOnnxDereverbModelBindingV1(
		{ modelId: 'dereverb-room', version: '2.0.0' } as never), /1\.0\.0/u);
});
