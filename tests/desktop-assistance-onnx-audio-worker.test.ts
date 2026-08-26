/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	assertAssistanceOnnxAudioModelBindingV1,
} from '../desktop/assistance-operation-family-execution.ts';
import {
	createAssistanceOnnxRuntimeWorkerAdapterV1,
	type AssistanceOnnxRuntimeModuleV1,
} from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from '../desktop/assistance-runtime-family-worker-entry.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);

type AudioTask = 'audio-tagging' | 'beat-tracking';

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

function taskSpec(task: AudioTask) {
	return task === 'audio-tagging' ? Object.freeze({
		sampleRate: 32_000, modelId: 'panns-cnn10', version: '1.0.0',
		artifactRole: 'panns-cnn10', outputRole: 'audio-tags' as const,
		outputMediaType: 'application/vnd.soundscaper.audio-tags+json',
	}) : Object.freeze({
		sampleRate: 22_050, modelId: 'beat-this-small0', version: '1.1.0',
		artifactRole: 'beat-this-small0', outputRole: 'beat-grid' as const,
		outputMediaType: 'application/vnd.soundscaper.beat-grid+json',
	});
}

async function fixture(
	context: TestContext,
	task: AudioTask,
	samples: Float32Array,
	overrides: Readonly<Record<string, string>> = {},
) {
	const spec = { ...taskSpec(task), ...overrides };
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-onnx-audio-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const wave = encodeWav([samples], {
		sampleRate: spec.sampleRate, bitDepth: 32, float: true, dither: false,
	});
	const input = join(root, 'audio.wav');
	const model = join(root, `${spec.artifactRole}.onnx`);
	const output = join(root, 'result.json');
	const modelBytes = Buffer.from('onnx-network');
	await Promise.all([
		writeFile(input, wave), writeFile(model, modelBytes), writeFile(output, new Uint8Array()),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task,
		settingsJson: JSON.stringify({ inputRoles: ['audio'], operation: task,
			outputRoles: [spec.outputRole], schemaVersion: 1 }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'audio', mediaType: 'audio/wav', byteLength: wave.byteLength,
			sha256: digest(wave) }, path: input }],
		models: [{ modelId: spec.modelId, version: spec.version,
			artifactRole: spec.artifactRole, path: model,
			byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: spec.outputRole, mediaType: spec.outputMediaType,
			maximumByteLength: 64 * 1024 }, path: output }],
	});
	return Object.freeze({
		job: Object.freeze({
			protocolVersion: 1 as const, jobId: JOB_ID,
			familyId: 'onnxruntime-node' as const, task,
			maximumRssBytes: 8 * 1024 ** 3, maximumDurationMs: 60_000, grant,
			descriptor: Object.freeze({
				familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
				target: 'linux-x64' as const, executionProvider: 'cpu' as const,
				entrypoint: '/runtime/onnxruntime-node/index.js',
				files: Object.freeze([{ path: '/runtime/onnxruntime-node/index.js',
					relativePath: 'index.js', byteLength: 1, sha256: '4'.repeat(64),
					executable: false }]),
			}),
		}),
		output,
	});
}

test('PANNs Cnn10 runs exact one-second CPU windows and publishes excitement tags', async (context) => {
	const samples = new Float32Array(32_001);
	samples[0] = 0.25;
	samples[32_000] = 0.75;
	const value = await fixture(context, 'audio-tagging', samples);
	const seen: Array<Readonly<{ dims: readonly number[]; first: number; last: number }>> = [];
	const runtime = fakeRuntime(['waveform'], ['clipwise_probabilities', 'embedding'], async (feeds) => {
		const waveform = feeds.waveform!;
		const data = waveform.data as Float32Array;
		seen.push({ dims: waveform.dims, first: data[0]!, last: data[data.length - 1]! });
		const probabilities = new Float32Array(527);
		probabilities[16] = seen.length === 1 ? 0.25 : 0.5;
		probabilities[18] = seen.length === 1 ? 0.75 : 0.125;
		probabilities[63] = 0.25;
		probabilities[66] = 1;
		probabilities[67] = 0.5;
		return {
			clipwise_probabilities: tensorValue(probabilities, [1, 527]),
			embedding: tensorValue(new Float32Array(512), [1, 512]),
		};
	});
	const progress: number[] = [];
	await runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job, onProgress: (ratio) => progress.push(ratio),
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	});

	assert.deepEqual(seen, [
		{ dims: [1, 32_000], first: 0.25, last: 0 },
		{ dims: [1, 32_000], first: 0.75, last: 0 },
	]);
	assert.deepEqual(JSON.parse(await readFile(value.output, 'utf8')), {
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: [
			{ startSample: 0, scores: { laughter: 0.75, applause: 0.5, cheering: 1 } },
			{ startSample: 32_000, scores: { laughter: 0.5, applause: 0.5, cheering: 1 } },
		],
	});
	assert.equal(progress[0], 0);
	assert.equal(progress.at(-1), 1);
});

test('Beat This runs pinned padded log-mel chunks and publishes the deterministic beat grid', async (context) => {
	const value = await fixture(context, 'beat-tracking', new Float32Array(1_024));
	const seen: Array<Readonly<{ dims: readonly number[]; finite: boolean }>> = [];
	const runtime = fakeRuntime(['log_mel_spectrogram'], ['beat_logits', 'downbeat_logits'],
		async (feeds) => {
			const spectrogram = feeds.log_mel_spectrogram!;
			seen.push({ dims: spectrogram.dims, finite: spectrogram.data.every(Number.isFinite) });
			const beat = new Float32Array(15).fill(-10);
			const downbeat = new Float32Array(15).fill(-10);
			beat[7] = 2;
			return { beat_logits: tensorValue(beat, [1, 15]),
				downbeat_logits: tensorValue(downbeat, [1, 15]) };
		});
	await runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	});

	assert.deepEqual(seen, [{ dims: [1, 15, 128], finite: true }]);
	assert.deepEqual(JSON.parse(await readFile(value.output, 'utf8')), {
		schemaVersion: 1, sampleRate: 22_050,
		points: [{ sample: 441, kind: 'beat', confidence: null }], tempoProposal: null,
	});
});

test('ONNX audio adapters reject substitutions, foreign graphs, and malformed tensors', async (context) => {
	const substituted = await fixture(context, 'audio-tagging', new Float32Array(32_000), {
		modelId: 'substitute-tagger',
	});
	let loaded = false;
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: substituted.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => {
			loaded = true;
			return fakeRuntime([], [], async () => ({}));
		} }),
	}), /PANNs|model|exact/iu);
	assert.equal(loaded, false);

	const wrongGraph = await fixture(context, 'beat-tracking', new Float32Array(1_024));
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: wrongGraph.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(['audio'], ['scores'], async () => ({})),
		}),
	}), /graph|input|output|signature/iu);

	const nan = await fixture(context, 'audio-tagging', new Float32Array(32_000));
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: nan.job,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({
			loadRuntime: async () => fakeRuntime(
				['waveform'], ['clipwise_probabilities', 'embedding'], async () => ({
					clipwise_probabilities: tensorValue(
						Float32Array.of(Number.NaN, ...new Float32Array(526)), [1, 527],
					),
					embedding: tensorValue(new Float32Array(512), [1, 512]),
				}),
			),
		}),
	}), /finite|probabilit|tensor/iu);
});

test('PANNs cancellation is observed between authenticated inference batches', async (context) => {
	const value = await fixture(context, 'audio-tagging', new Float32Array(64_000));
	const controller = new AbortController();
	let calls = 0;
	const runtime = fakeRuntime(['waveform'], ['clipwise_probabilities', 'embedding'], async () => {
		calls += 1;
		controller.abort(new DOMException('cancelled', 'AbortError'));
		return { clipwise_probabilities: tensorValue(new Float32Array(527), [1, 527]),
			embedding: tensorValue(new Float32Array(512), [1, 512]) };
	});
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: value.job, signal: controller.signal,
		execute: createAssistanceOnnxRuntimeWorkerAdapterV1({ loadRuntime: async () => runtime }),
	}), { name: 'AbortError' });
	assert.equal(calls, 1);
});

test('main-side ONNX audio identity admission is closed before model lookup', () => {
	assert.doesNotThrow(() => assertAssistanceOnnxAudioModelBindingV1('audio-tagging', {
		modelId: 'panns-cnn10', version: '1.0.0',
		artifactSha256s: ['a'.repeat(64)],
	}));
	for (const modelId of ['beat-this-small0', 'beat-this-final0']) {
		assert.doesNotThrow(() => assertAssistanceOnnxAudioModelBindingV1('beat-tracking', {
			modelId, version: '1.1.0', artifactSha256s: ['b'.repeat(64)],
		}));
	}
	assert.throws(() => assertAssistanceOnnxAudioModelBindingV1('audio-tagging', {
		modelId: 'other', version: '1.0.0', artifactSha256s: ['a'.repeat(64)],
	}), /PANNs|exact|identity/iu);
	assert.throws(() => assertAssistanceOnnxAudioModelBindingV1('beat-tracking', {
		modelId: 'beat-this-small0', version: '1.0.0',
		artifactSha256s: ['a'.repeat(64)],
	}), /Beat This|1\.1\.0|identity/iu);
});

function tensorValue(data: Float32Array, dims: readonly number[]): TensorValue {
	return Object.freeze({ type: 'float32', data, dims: Object.freeze([...dims]) });
}

function fakeRuntime(
	inputNames: readonly string[],
	outputNames: readonly string[],
	run: (feeds: Readonly<Record<string, TensorValue>>) => Promise<Readonly<Record<string, TensorValue>>>,
): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements TensorValue {
		constructor(
			readonly type: 'uint8' | 'float32' | 'int64',
			readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[],
		) {}
	}
	return Object.freeze({
		Tensor,
		InferenceSession: Object.freeze({
			create: async (_path: string, options: Readonly<Record<string, unknown>>) => {
				assert.deepEqual(options.executionProviders, ['cpu']);
				return Object.freeze({ inputNames, outputNames, run });
			},
		}),
	});
}

interface TensorValue {
	readonly type: string;
	readonly data: Uint8Array | Float32Array | BigInt64Array;
	readonly dims: readonly number[];
}
