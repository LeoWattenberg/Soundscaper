/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAssistanceOnnxKokoroWorkerAdapterV1 } from '../desktop/assistance-onnx-kokoro-worker.ts';
import { createAssistanceOnnxRuntimeWorkerAdapterV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import { runAssistanceRuntimeFamilyWorkerJobV1 } from '../desktop/assistance-runtime-family-worker-entry.ts';
import type { AssistanceOnnxRuntimeModuleV1, AssistanceOnnxTensorV1 } from '../desktop/assistance-onnx-runtime-worker.ts';
import { KOKORO_VOICES_BY_LANGUAGE } from '../src/common/editor/assistance/kokoro-voices-v1.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);
const MODEL_ID = 'kokoro-82m-v1.0';
const VERSION = '1.0.0';

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(t: { after(callback: () => Promise<void>): void }, options: {
	language?: string;
	voice?: string;
	voiceRole?: string;
	text?: string;
	maximumByteLength?: number;
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-kokoro-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const language = options.language ?? 'a';
	const voice = options.voice ?? 'af_heart';
	const text = new TextEncoder().encode(options.text ?? 'Hello!');
	// A representative slice of the pinned tokenizer.json model.vocab, including pad ID 0.
	const vocabulary = new TextEncoder().encode(JSON.stringify({ model: {
		vocab: { '$': 0, h: 50, 'ɑ': 69, '!': 5 },
	} }));
	const network = new TextEncoder().encode('network');
	const voiceBytes = new Uint8Array(510 * 256 * Float32Array.BYTES_PER_ELEMENT);
	// First four Float32 values of af_heart.bin style row 3 at the pinned revision.
	voiceBytes.set(Buffer.from('58fd78be43c5673e5bdcb93b9dda03be', 'hex'), 3 * 256 * 4);
	const inputPath = join(root, 'text.txt');
	const outputPath = join(root, 'speech.wav');
	const modelFiles = [
		{ artifactRole: 'network', path: join(root, 'model.onnx'), bytes: network },
		{ artifactRole: 'vocabulary', path: join(root, 'tokenizer.json'), bytes: vocabulary },
		{ artifactRole: options.voiceRole ?? `voice-${voice}`, path: join(root, `${voice}.bin`), bytes: voiceBytes },
	];
	await Promise.all([
		writeFile(inputPath, text), writeFile(outputPath, new Uint8Array()),
		...modelFiles.map(({ path, bytes }) => writeFile(path, bytes)),
	]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'onnxruntime-node', task: 'text-to-speech',
		settingsJson: JSON.stringify({ schemaVersion: 1, operation: 'text-to-speech',
			inputRoles: ['text'], outputRoles: ['synthesized-audio'], language, voice, speed: 1 }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'text', mediaType: 'text/plain', byteLength: text.byteLength, sha256: sha256(text) },
			path: inputPath }],
		models: modelFiles.map(({ artifactRole, path, bytes }) => ({
			modelId: MODEL_ID, version: VERSION, artifactRole, path,
			byteLength: bytes.byteLength, sha256: sha256(bytes),
		})),
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'synthesized-audio', mediaType: 'audio/wav',
			maximumByteLength: options.maximumByteLength ?? 1_024 }, path: outputPath }],
	});
	return { outputPath, job: {
		protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'onnxruntime-node' as const,
		task: 'text-to-speech' as const, maximumRssBytes: 8 * 1024 ** 3,
		maximumDurationMs: 60_000, grant, descriptor: {
			familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
			target: 'linux-x64' as const, executionProvider: 'cpu' as const,
			entrypoint: '/runtime/onnxruntime-node/index.js',
			files: [{ path: '/runtime/onnxruntime-node/index.js', relativePath: 'index.js',
				byteLength: 1, sha256: '4'.repeat(64), executable: false }],
		},
	} };
}

function runtime(onRun: (feeds: Readonly<Record<string, AssistanceOnnxTensorV1>>) => void): AssistanceOnnxRuntimeModuleV1 {
	class Tensor implements AssistanceOnnxTensorV1 {
		constructor(readonly type: string, readonly data: Uint8Array | Float32Array | BigInt64Array,
			readonly dims: readonly number[]) {}
	}
	return { Tensor, InferenceSession: { create: async () => ({
		inputNames: ['input_ids', 'style', 'speed'], outputNames: ['waveform'],
		run: async (feeds) => {
			onRun(feeds);
			return { waveform: new Tensor('float32', Float32Array.from([0, 0.5, -0.5]), [1, 3]) };
		},
	}) } };
}

test('Kokoro voice catalogue covers all nine published groups and 54 voices', () => {
	assert.deepEqual(Object.keys(KOKORO_VOICES_BY_LANGUAGE), ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z']);
	assert.equal(Object.values(KOKORO_VOICES_BY_LANGUAGE).flat().length, 54);
	for (const [language, voices] of Object.entries(KOKORO_VOICES_BY_LANGUAGE)) {
		assert.ok(voices.length > 0);
		assert.ok(voices.every((voice) => voice.startsWith(language)));
	}
});

test('the unmirrored Kokoro source candidate pins every published voice and never claims installability', async () => {
	const candidate = JSON.parse(await readFile(new URL(
		'../config/assistance-kokoro-model-source-candidate.json', import.meta.url), 'utf8')) as {
		status: string;
		onnxSource: { artifacts: { fileName: string; sha256: string; byteLength: number }[] };
	};
	assert.equal(candidate.status, 'upstream-pinned-unmirrored');
	const expected = Object.values(KOKORO_VOICES_BY_LANGUAGE).flat().map((voice) => `${voice}.bin`);
	const actual = candidate.onnxSource.artifacts
		.filter(({ fileName }) => fileName.endsWith('.bin')).map(({ fileName }) => fileName);
	assert.deepEqual(actual.sort(), expected.sort());
	assert.ok(candidate.onnxSource.artifacts
		.filter(({ fileName }) => fileName.endsWith('.bin'))
		.every(({ byteLength }) => byteLength === 510 * 256 * Float32Array.BYTES_PER_ELEMENT));
	assert.ok(candidate.onnxSource.artifacts.some(({ fileName }) => fileName === 'model.onnx'));
	const tokenizer = candidate.onnxSource.artifacts.find(({ fileName }) => fileName === 'tokenizer.json');
	assert.equal(tokenizer?.byteLength, 3_497);
	assert.equal(tokenizer?.sha256,
		'77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34');
	for (const artifact of candidate.onnxSource.artifacts) {
		assert.match(artifact.sha256, /^[a-f\d]{64}$/u);
		assert.ok(Number.isSafeInteger(artifact.byteLength) && artifact.byteLength > 0);
	}
});

test('Kokoro adapter consumes offline phonemes and publishes authenticated mono WAV', async (t) => {
	const { job, outputPath } = await fixture(t);
	let seen: Readonly<Record<string, AssistanceOnnxTensorV1>> | undefined;
	const adapter = createAssistanceOnnxRuntimeWorkerAdapterV1({
		loadRuntime: async () => runtime((feeds) => { seen = feeds; }),
		phonemizeKokoro: async () => ['hɑ!'],
	});
	const result = await runAssistanceRuntimeFamilyWorkerJobV1({ job, execute: adapter });
	assert.deepEqual(Array.from(seen!.input_ids!.data as BigInt64Array), [0n, 50n, 69n, 5n, 0n]);
	assert.deepEqual(seen!.input_ids!.dims, [1, 5]);
	assert.deepEqual(seen!.style!.dims, [1, 256]);
	const style = seen!.style!.data as Float32Array;
	assert.ok(Math.abs(style[0]! - (-0.24315392971038818)) < 1e-7);
	assert.ok(Math.abs(style[1]! - 0.2263384312391281) < 1e-7);
	assert.ok(Math.abs(style[2]! - 0.005672020372003317) < 1e-7);
	assert.ok(Math.abs(style[3]! - (-0.12876363098621368)) < 1e-7);
	assert.deepEqual(Array.from(seen!.speed!.data as Float32Array), [1]);
	const wav = await readFile(outputPath);
	assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
	assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
	assert.equal(wav.readUInt32LE(24), 24_000);
	assert.equal(wav.readUInt16LE(22), 1);
	assert.equal(wav.readUInt16LE(34), 16);
	assert.equal(wav.readInt16LE(46), 16_384);
	assert.equal(wav.readInt16LE(48), -16_384);
	assert.equal(result.outputs[0]?.sha256, sha256(wav));
});

test('every published language group admits its own selected voice and phonemizer request', async (t) => {
	for (const [language, voices] of Object.entries(KOKORO_VOICES_BY_LANGUAGE)) {
		const voice = voices[0]!;
		const { job, outputPath } = await fixture(t, { language, voice });
		const requests: unknown[] = [];
		await runAssistanceRuntimeFamilyWorkerJobV1({
			job,
			execute: createAssistanceOnnxKokoroWorkerAdapterV1(
				async () => runtime(() => {}),
				async (request) => { requests.push(request); return ['hɑ!']; },
			),
		});
		assert.equal((requests[0] as { language: string }).language, language);
		assert.equal((requests[0] as { voice: string }).voice, voice);
		assert.equal((await readFile(outputPath)).toString('ascii', 0, 4), 'RIFF');
	}
});

test('Kokoro rejects voice mismatch before loading ONNX and fails closed without G2P', async (t) => {
	const mismatch = await fixture(t, { language: 'j', voice: 'af_heart' });
	let loaded = false;
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: mismatch.job,
		execute: createAssistanceOnnxKokoroWorkerAdapterV1(async () => {
			loaded = true;
			return runtime(() => {});
		}, async () => ['hɑ!']),
	}), /voice|language/iu);
	assert.equal(loaded, false);

	const missing = await fixture(t);
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: missing.job,
		execute: createAssistanceOnnxKokoroWorkerAdapterV1(async () => runtime(() => {})),
	}), /phonemizer|unavailable|G2P/iu);
});

test('Kokoro rejects substituted voice grant and an output exceeding its reservation', async (t) => {
	const substituted = await fixture(t, { voiceRole: 'voice-af_bella' });
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: substituted.job,
		execute: createAssistanceOnnxKokoroWorkerAdapterV1(
			async () => runtime(() => {}), async () => ['hɑ!']),
	}), /voice|artifact/iu);

	const bounded = await fixture(t, { maximumByteLength: 45 });
	await assert.rejects(runAssistanceRuntimeFamilyWorkerJobV1({
		job: bounded.job,
		execute: createAssistanceOnnxKokoroWorkerAdapterV1(
			async () => runtime(() => {}), async () => ['hɑ!']),
	}), /reservation|bound|exceed/iu);
});
