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
} from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from
	'../desktop/assistance-runtime-family-file-grants.ts';
import {
	assertAssistanceOnnxEnhancementSeparationModelBindingV1,
} from '../desktop/assistance-operation-family-execution.ts';
import {
	AssistanceRuntimeFamilyAdapterUnavailableError,
	runAssistanceRuntimeFamilyWorkerJobV1,
} from '../desktop/assistance-runtime-family-worker-entry.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_IDS = Object.freeze(['3'.repeat(40), '4'.repeat(40), '5'.repeat(40)]);
const CONFIG = Object.freeze({
	architectures: ['DeepFilterNet3'], conv_lookahead: 2, df_bins: 96,
	df_lookahead: 2, df_order: 5, erb_bands: 32, fft_bins: 481,
	fft_size: 960, hop_size: 480, library_name: 'onnxruntime',
	min_nb_erb_freqs: 2, model_type: 'deepfilternet3', norm_tau: 1,
	normalization_alpha: 0.99, sample_rate: 48_000,
});

interface TensorValue {
	readonly type: string;
	readonly data: Uint8Array | Float32Array | BigInt64Array;
	readonly dims: readonly number[];
}

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function audio(frameCount = 1_001, sampleRate = 48_000): Uint8Array {
	const left = Float32Array.from({ length: frameCount }, (_value, frame) =>
		0.2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate));
	const right = Float32Array.from({ length: frameCount }, (_value, frame) =>
		0.1 * Math.cos(2 * Math.PI * 330 * frame / sampleRate));
	return encodeWav([left, right], { sampleRate, bitDepth: 32, float: true, dither: false });
}

function auxiliary(): Uint8Array {
	const widths = deepFilterErbWidths();
	const values = new Float32Array(481 * 32 * 2 + 960);
	let frequencyStart = 0;
	for (let band = 0; band < widths.length; band += 1) {
		const width = widths[band]!;
		for (let frequency = frequencyStart; frequency < frequencyStart + width; frequency += 1) {
			values[frequency * 32 + band] = 1 / width;
			values[481 * 32 + band * 481 + frequency] = 1;
		}
		frequencyStart += width;
	}
	for (let frame = 0; frame < 960; frame += 1) {
		const inner = Math.sin(Math.PI * (frame + 0.5) / 960);
		values[481 * 32 * 2 + frame] = Math.sin(0.5 * Math.PI * inner * inner);
	}
	return new Uint8Array(values.buffer);
}

function deepFilterErbWidths(): readonly number[] {
	const frequencyToErb = (frequency: number) => 9.265 * Math.log1p(frequency / (24.7 * 9.265));
	const erbToFrequency = (erb: number) => 24.7 * 9.265 * Math.expm1(erb / 9.265);
	const erbHigh = frequencyToErb(24_000);
	const widths: number[] = [];
	let previousBin = 0;
	let carried = 0;
	for (let band = 1; band <= 32; band += 1) {
		const boundary = Math.round(erbToFrequency(erbHigh * band / 32) / 50);
		let width = boundary - previousBin - carried;
		if (width < 2) { carried = 2 - width; width = 2; } else carried = 0;
		widths.push(width);
		previousBin = boundary;
	}
	widths[31]! += 1;
	widths[31]! -= widths.reduce((total, width) => total + width, 0) - 481;
	return widths;
}

async function enhancementFixture(
	context: TestContext,
	overrides: Readonly<{ audio?: Uint8Array; modelId?: string; artifactRole?: string }> = {},
) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-deepfilter-ort-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const inputBytes = overrides.audio ?? audio();
	const modelBytes = Buffer.from('deepfilter-network');
	const auxiliaryBytes = auxiliary();
	const configBytes = Buffer.from(JSON.stringify(CONFIG), 'utf8');
	const paths = Object.freeze({ input: join(root, 'audio.wav'), model: join(root, 'deepfilter.onnx'),
		auxiliary: join(root, 'deepfilter-auxiliary.bin'), config: join(root, 'config.json'),
		output: join(root, 'enhanced.wav') });
	await Promise.all([
		writeFile(paths.input, inputBytes), writeFile(paths.model, modelBytes),
		writeFile(paths.auxiliary, auxiliaryBytes), writeFile(paths.config, configBytes),
		writeFile(paths.output, new Uint8Array()),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'speech-enhancement',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'speech-enhancement',
			inputRoles: ['audio'], outputRoles: ['enhanced-audio'] }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'audio', mediaType: 'audio/wav', byteLength: inputBytes.byteLength,
			sha256: digest(inputBytes) }, path: paths.input }],
		models: [
			{ modelId: overrides.modelId ?? 'deepfilternet3', version: '3.0.0',
				artifactRole: overrides.artifactRole ?? 'deepfilter', path: paths.model,
				byteLength: modelBytes.byteLength, sha256: digest(modelBytes) },
			{ modelId: 'deepfilternet3', version: '3.0.0', artifactRole: 'deepfilter-auxiliary',
				path: paths.auxiliary, byteLength: auxiliaryBytes.byteLength,
				sha256: digest(auxiliaryBytes) },
			{ modelId: 'deepfilternet3', version: '3.0.0', artifactRole: 'config',
				path: paths.config, byteLength: configBytes.byteLength, sha256: digest(configBytes) },
		],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_IDS[0]!, jobId: JOB_ID,
			role: 'enhanced-audio', mediaType: 'audio/wav', maximumByteLength: 16 * 1024 * 1024 },
		path: paths.output }],
	});
	return Object.freeze({ job: job('speech-enhancement', grant), paths, inputBytes });
}

test('DeepFilterNet3 preserves exact 48 kHz multichannel geometry through its CPU graph',
	async (context) => {
		const fixture = await enhancementFixture(context);
		const seen: Array<Readonly<{ erb: readonly number[]; spectrum: readonly number[] }>> = [];
		let released = 0;
		const runtime = fakeRuntime(['feat_erb', 'feat_spec'], ['erb_mask', 'df_coefs'],
			async (feeds) => {
				const frames = feeds.feat_erb!.dims[2]!;
				seen.push(Object.freeze({ erb: feeds.feat_erb!.dims,
					spectrum: feeds.feat_spec!.dims }));
				assert.ok((feeds.feat_erb!.data as Float32Array).every(Number.isFinite));
				assert.ok((feeds.feat_spec!.data as Float32Array).every(Number.isFinite));
				return identityDeepFilterOutput(frames);
			}, () => { released += 1; });
		const progress: number[] = [];
		const result = await runAssistanceRuntimeFamilyWorkerJobV1({
			job: fixture.job, onProgress: (ratio) => progress.push(ratio),
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		});

		assert.deepEqual(seen, [
			{ erb: [1, 1, 4, 32], spectrum: [1, 2, 4, 96] },
			{ erb: [1, 1, 4, 32], spectrum: [1, 2, 4, 96] },
		]);
		assert.equal(released, 1);
		assert.deepEqual(progress, [0, 1 / 3, 2 / 3, 1]);
		const outputBytes = await readFile(fixture.paths.output);
		const output = inspectFloatWave(outputBytes);
		const input = inspectFloatWave(fixture.inputBytes);
		assert.deepEqual({ sampleRate: output.sampleRate, channelCount: output.channels.length,
			frameCount: output.channels[0]!.length },
		{ sampleRate: 48_000, channelCount: 2, frameCount: 1_001 });
		for (let channel = 0; channel < input.channels.length; channel += 1) {
			const maximumError = input.channels[channel]!.reduce((maximum, sample, frame) =>
				Math.max(maximum, Math.abs(sample - output.channels[channel]![frame]!)), 0);
			assert.ok(maximumError < 2e-4, `identity graph error ${String(maximumError)}`);
		}
		assert.equal(result.outputs[0]!.sha256, digest(outputBytes));
	});

test('DeepFilterNet3 rejects substituted artifacts, graph signatures, and non-finite tensors',
	async (context) => {
		const substitution = await enhancementFixture(context, { modelId: 'other-enhancer' });
		let loaded = false;
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: substitution.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
				loaded = true; return fakeRuntime([], [], async () => ({}));
			} }),
		}), /DeepFilterNet3|model|artifact/iu);
		assert.equal(loaded, false);

		const foreignGraph = await enhancementFixture(context);
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: foreignGraph.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () =>
				fakeRuntime(['audio'], ['enhanced'], async () => ({})) }),
		}), /graph|signature|input|output/iu);

		const nan = await enhancementFixture(context);
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: nan.job,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () =>
				fakeRuntime(['feat_erb', 'feat_spec'], ['erb_mask', 'df_coefs'], async (feeds) => {
					const output = identityDeepFilterOutput(feeds.feat_erb!.dims[2]!);
					(output.erb_mask.data as Float32Array)[0] = Number.NaN;
					return output;
				}) }),
		}), /finite|mask|tensor/iu);
	});

test('DeepFilterNet3 observes cancellation between channel graph calls without publishing a WAV',
	async (context) => {
		const fixture = await enhancementFixture(context);
		const controller = new AbortController();
		let calls = 0;
		let released = 0;
		const runtime = fakeRuntime(['feat_erb', 'feat_spec'], ['erb_mask', 'df_coefs'],
			async (feeds) => {
				calls += 1;
				controller.abort(new DOMException('cancelled', 'AbortError'));
				return identityDeepFilterOutput(feeds.feat_erb!.dims[2]!);
			}, () => { released += 1; });
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: fixture.job, signal: controller.signal,
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
		}), { name: 'AbortError' });
		assert.equal(calls, 1);
		assert.equal(released, 1);
		assert.equal((await readFile(fixture.paths.output)).byteLength, 0);
	});

test('TIGER remains typed unavailable while its pinned safetensors lacks converted ONNX evidence',
	async (context) => {
		const root = await mkdtemp(join(tmpdir(), 'soundscaper-tiger-ort-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		const inputBytes = audio(2_048, 44_100);
		const modelBytes = Buffer.from('pending-converted-network');
		const input = join(root, 'audio.wav');
		const model = join(root, 'tiger-dnr.onnx');
		const outputs = OUTPUT_IDS.map((_, index) => join(root, `stem-${String(index)}.wav`));
		await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes),
			...outputs.map((path) => writeFile(path, new Uint8Array()))]);
		const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
			jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'source-separation',
			settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'source-separation',
				inputRoles: ['audio'], outputRoles: ['separated-audio', 'separated-audio',
					'separated-audio'] }),
			inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
				role: 'audio', mediaType: 'audio/wav', byteLength: inputBytes.byteLength,
				sha256: digest(inputBytes) }, path: input }],
			models: [{ modelId: 'tiger-dnr', version: '1.0.0', artifactRole: 'network',
				path: model, byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
			outputs: outputs.map((path, index) => ({ reservation: { claimVersion: 1,
				claimId: OUTPUT_IDS[index]!, jobId: JOB_ID, role: 'separated-audio' as const,
				mediaType: 'audio/wav', maximumByteLength: 16 * 1024 * 1024 }, path })),
		});
		let loaded = false;
		await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
			job: job('source-separation', grant),
			execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
				loaded = true; return fakeRuntime([], [], async () => ({}));
			} }),
		}), (error: unknown) => {
			assert.ok(error instanceof AssistanceRuntimeFamilyAdapterUnavailableError);
			assert.equal(error.code, 'ADAPTER_UNAVAILABLE');
			assert.match(error.message, /converted|ONNX|adapter/iu);
			return true;
		});
		assert.equal(loaded, false);
		assert.deepEqual((await Promise.all(outputs.map((path) => readFile(path))))
			.map(({ byteLength }) => byteLength), [0, 0, 0]);
	});

test('main closes enhancement and separation model substitution before catalog lookup', () => {
	assert.doesNotThrow(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1(
		'speech-enhancement', { modelId: 'deepfilternet3', version: '3.0.0',
			artifactSha256s: ['a'.repeat(64)] },
	));
	assert.doesNotThrow(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1(
		'source-separation', { modelId: 'tiger-dnr', version: '1.0.0',
			artifactSha256s: ['b'.repeat(64)] },
	));
	assert.throws(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1(
		'speech-enhancement', { modelId: 'other-enhancer', version: '3.0.0',
			artifactSha256s: ['a'.repeat(64)] },
	), /DeepFilterNet3|exact/iu);
	assert.throws(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1(
		'source-separation', { modelId: 'tiger-dnr', version: '0.9.0',
			artifactSha256s: ['b'.repeat(64)] },
	), /TIGER|exact/iu);
});

function job<Task extends 'speech-enhancement' | 'source-separation'>(task: Task, grant: Awaited<
	ReturnType<typeof captureAssistanceRuntimeFamilyJobGrantV1>
>) {
	return Object.freeze({
		protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const, task,
		maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
		descriptor: Object.freeze({ familyId: 'onnxruntime-node' as const,
			runtimeVersion: '1.29.0', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/onnxruntime-node/index.js',
			files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js', relativePath: 'index.js',
				byteLength: 1, sha256: '6'.repeat(64), executable: false }]) }),
	});
}

function identityDeepFilterOutput(frames: number): Readonly<Record<string, TensorValue>> {
	const mask = new Float32Array(frames * 32).fill(1);
	const coefficients = new Float32Array(5 * frames * 96 * 2);
	for (let frame = 0; frame < frames; frame += 1) {
		for (let frequency = 0; frequency < 96; frequency += 1) {
			coefficients[((2 * frames + frame) * 96 + frequency) * 2] = 1;
		}
	}
	return Object.freeze({
		erb_mask: tensor(mask, [1, 1, frames, 32]),
		df_coefs: tensor(coefficients, [1, 5, frames, 96, 2]),
	});
}

function tensor(data: Float32Array, dims: readonly number[]): TensorValue {
	return Object.freeze({ type: 'float32', data, dims: Object.freeze([...dims]) });
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
	assert.equal(Buffer.from(value.subarray(8, 12)).toString('ascii'), 'WAVE');
	assert.equal(view.getUint16(20, true), 3);
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
