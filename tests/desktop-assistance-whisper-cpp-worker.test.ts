/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';

import {
	captureAssistanceRuntimeFamilyJobGrantV1,
	type AssistanceRuntimeFamilyInputCapture,
} from '../desktop/assistance-runtime-family-file-grants.ts';
import {
	createAssistanceWhisperCppWorkerSpawnerV1,
	type AssistanceWhisperCppChild,
	type AssistanceWhisperCppSpawn,
} from '../desktop/assistance-whisper-cpp-worker.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);
const VAD_INPUT_ID = '5'.repeat(40);

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

class FakeChild extends EventEmitter implements AssistanceWhisperCppChild {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	killed = false;
	kill(_signal?: NodeJS.Signals): boolean {
		this.killed = true;
		queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
		return true;
	}
}

async function fixture(
	context: TestContext,
	maximumByteLength = 64 * 1024,
	voiceActivityBody?: unknown,
) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-whisper-worker-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'input.wav');
	const voiceActivity = join(root, 'voice-activity.json');
	const model = join(root, 'ggml-large-v3-turbo-q5_0.bin');
	const output = join(root, 'transcript.json');
	const inputBytes = floatWave(160_000);
	const modelBytes = Buffer.from('ggml-model');
	await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes),
		writeFile(output, new Uint8Array()),
		...(voiceActivityBody === undefined ? [] : [writeFile(voiceActivity,
			typeof voiceActivityBody === 'string'
				? voiceActivityBody : JSON.stringify(voiceActivityBody))]),
	]);
	const inputs: AssistanceRuntimeFamilyInputCapture[] = [{ claim: {
		claimVersion: 1 as const, claimId: INPUT_ID, jobId: JOB_ID,
		role: 'audio' as const, mediaType: 'audio/wav', byteLength: inputBytes.byteLength,
		sha256: digest(inputBytes) }, path: input }];
	if (voiceActivityBody !== undefined) {
		const bytes = await readFile(voiceActivity);
		inputs.push({ claim: { claimVersion: 1 as const, claimId: VAD_INPUT_ID, jobId: JOB_ID,
			role: 'voice-activity' as const, mediaType: 'application/json',
			byteLength: bytes.byteLength, sha256: digest(bytes) }, path: voiceActivity });
	}
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'whisper-cpp', task: 'speech-recognition',
		settingsJson: JSON.stringify({ operation: 'speech-recognition',
			inputRoles: voiceActivityBody === undefined ? ['audio'] : ['audio', 'voice-activity'],
			outputRoles: ['transcript'] }),
		inputs,
		models: [{ modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0',
			artifactRole: 'ggml-large-v3-turbo-q5_0', path: model,
			byteLength: modelBytes.byteLength, sha256: digest(modelBytes) }],
		outputs: [{ reservation: { claimVersion: 1, claimId: OUTPUT_ID, jobId: JOB_ID,
			role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
			maximumByteLength }, path: output }],
	});
	const job = Object.freeze({
		protocolVersion: 1 as const, jobId: JOB_ID, familyId: 'whisper-cpp' as const,
		task: 'speech-recognition' as const, maximumRssBytes: 8 * 1024 ** 3,
		maximumDurationMs: 60_000, grant,
		descriptor: {
			familyId: 'whisper-cpp' as const, runtimeVersion: 'v1.9.3', target: 'linux-x64' as const,
			executionProvider: 'cpu' as const, entrypoint: '/runtime/whisper-cli',
			files: [{ path: '/runtime/whisper-cli', relativePath: 'whisper-cli',
				byteLength: 1, sha256: '4'.repeat(64), executable: true }],
		},
	});
	return { job, paths: { input, voiceActivity, model, output } };
}

function successfulSpawn(
	seen: Array<{ executable: string; args: readonly string[]; shell: boolean | undefined }>,
): AssistanceWhisperCppSpawn {
	return (executable, args, options) => {
		const child = new FakeChild();
		seen.push({ executable, args: [...args], shell: options.shell });
		queueMicrotask(() => {
			child.stderr.end("whisper-cli: saving output to '-'\n");
			child.stdout.end(JSON.stringify({
				result: { language: 'en' },
				transcription: [
					{ offsets: { from: 0, to: 1250 }, text: ' Hello' },
					{ offsets: { from: 1250, to: 2500 }, text: ' world.' },
				],
			}));
			child.emit('close', 0, null);
		});
		return child;
	};
}

test('the Whisper worker runs one authenticated CPU-only greedy CLI and publishes normalized JSON', async (context) => {
	const { job, paths } = await fixture(context);
	const seen: Array<{ executable: string; args: readonly string[]; shell: boolean | undefined }> = [];
	const progress: number[] = [];
	const spawnWorker = createAssistanceWhisperCppWorkerSpawnerV1({ spawn: successfulSpawn(seen) });
	const worker = spawnWorker(job, { onProgress: (value) => progress.push(value) });
	const result = await worker.completion as { outputs: readonly { sha256: string }[] };
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.executable, '/runtime/whisper-cli');
	assert.equal(seen[0]?.shell, false);
	assert.deepEqual(seen[0]?.args, [
		'--model', paths.model, '--file', paths.input,
		'--output-json', '--output-file', '-', '--no-prints', '--no-gpu',
		'--temperature', '0', '--temperature-inc', '0', '--no-fallback',
		'--language', 'auto', '--threads', '4',
	]);
	const body = await readFile(paths.output);
	assert.deepEqual(JSON.parse(body.toString()), {
		language: 'en',
		segments: [
			{ startSeconds: 0, endSeconds: 1.25, text: ' Hello' },
			{ startSeconds: 1.25, endSeconds: 2.5, text: ' world.' },
		],
	});
	assert.equal(result.outputs[0]?.sha256, digest(body));
	assert.deepEqual(progress, [0, 1]);
});

test('the Whisper worker slices reviewed VAD ranges and restores selection-relative timing', async (context) => {
	const { job, paths } = await fixture(context, 64 * 1024, {
		sampleRate: 16_000,
		segments: [
			{ startSample: 16_000, sampleCount: 48_000 },
			{ startSample: 96_000, sampleCount: 48_000 },
		],
	});
	const seen: Array<{ executable: string; args: readonly string[]; shell: boolean | undefined }> = [];
	const worker = createAssistanceWhisperCppWorkerSpawnerV1({
		spawn: successfulSpawn(seen),
	})(job, { onProgress: () => undefined });
	await worker.completion;

	assert.equal(seen.length, 2);
	const firstFileIndex = seen[0]!.args.indexOf('--file') + 1;
	const secondFileIndex = seen[1]!.args.indexOf('--file') + 1;
	assert.notEqual(seen[0]!.args[firstFileIndex], paths.input);
	assert.equal(seen[0]!.args[firstFileIndex], seen[1]!.args[secondFileIndex],
		'one worker-owned bounded segment file is reused');
	assert.deepEqual(JSON.parse(await readFile(paths.output, 'utf8')), {
		language: 'en',
		segments: [
			{ startSeconds: 1, endSeconds: 2.25, text: ' Hello' },
			{ startSeconds: 2.25, endSeconds: 3.5, text: ' world.' },
			{ startSeconds: 6, endSeconds: 7.25, text: ' Hello' },
			{ startSeconds: 7.25, endSeconds: 8.5, text: ' world.' },
		],
	});
});

test('zero or invalid VAD is handled before whisper.cpp can inspect whole audio', async (context) => {
	const zero = await fixture(context, 64 * 1024, { sampleRate: 16_000, segments: [] });
	let spawns = 0;
	const spawn: AssistanceWhisperCppSpawn = () => { spawns += 1; throw new Error('must not spawn'); };
	await createAssistanceWhisperCppWorkerSpawnerV1({ spawn })(zero.job, {
		onProgress: () => undefined,
	}).completion;
	assert.deepEqual(JSON.parse(await readFile(zero.paths.output, 'utf8')), {
		language: null, segments: [],
	});
	assert.equal(spawns, 0);

	const outOfRange = await fixture(context, 64 * 1024, { sampleRate: 16_000,
		segments: [{ startSample: 159_000, sampleCount: 2_000 }] });
	await assert.rejects(createAssistanceWhisperCppWorkerSpawnerV1({ spawn })(outOfRange.job, {
		onProgress: () => undefined,
	}).completion, /exceeds.*audio/iu);
	const malformed = await fixture(context, 64 * 1024, '{not-json');
	await assert.rejects(createAssistanceWhisperCppWorkerSpawnerV1({ spawn })(malformed.job, {
		onProgress: () => undefined,
	}).completion, /malformed.*JSON/iu);
	assert.equal(spawns, 0);
});

test('malformed or oversized CLI output is refused before the reservation is populated', async (context) => {
	const { job, paths } = await fixture(context, 32);
	const spawn: AssistanceWhisperCppSpawn = () => {
		const child = new FakeChild();
		queueMicrotask(() => {
			child.stdout.end('{"oversized":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}');
			child.emit('close', 0, null);
		});
		return child;
	};
	const worker = createAssistanceWhisperCppWorkerSpawnerV1({ spawn })(job, {
		onProgress: () => undefined,
	});
	await assert.rejects(worker.completion, /output.*bound|stdout/iu);
	assert.equal((await readFile(paths.output)).byteLength, 0);
});

test('termination kills and quiesces the exact CLI child', async (context) => {
	const { job } = await fixture(context);
	const children: FakeChild[] = [];
	const spawn: AssistanceWhisperCppSpawn = () => {
		const child = new FakeChild();
		children.push(child);
		return child;
	};
	const worker = createAssistanceWhisperCppWorkerSpawnerV1({ spawn })(job, {
		onProgress: () => undefined,
	});
	for (let attempt = 0; children.length === 0 && attempt < 100; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	const child = children[0];
	assert.ok(child);
	await worker.terminate();
	assert.equal(child.killed, true);
	await assert.rejects(worker.completion, /abort|terminated|cancel/iu);
});

test('termination escalates to SIGKILL when the CLI ignores SIGTERM', async (context) => {
	const { job } = await fixture(context);
	const signals: NodeJS.Signals[] = [];
	let spawned = false;
	const spawn: AssistanceWhisperCppSpawn = () => {
		spawned = true;
		const child = new FakeChild();
		child.kill = (signal: NodeJS.Signals = 'SIGTERM') => {
			signals.push(signal);
			if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, signal));
			return true;
		};
		return child;
	};
	const worker = createAssistanceWhisperCppWorkerSpawnerV1({
		spawn, terminationGraceMs: 5,
	})(job, { onProgress: () => undefined });
	for (let attempt = 0; !spawned && attempt < 100; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	assert.equal(spawned, true);
	await within(worker.terminate(), 100);
	await assert.rejects(worker.completion, /abort|terminated|cancel/iu);
	assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return await Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			setTimeout(() => reject(new Error('The whisper.cpp worker did not terminate.')), milliseconds);
		}),
	]);
}

function floatWave(sampleCount: number): Uint8Array {
	const bytes = new Uint8Array(44 + sampleCount * 4);
	const view = new DataView(bytes.buffer);
	for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
		for (let index = 0; index < value.length; index += 1) {
			bytes[offset + index] = value.charCodeAt(index);
		}
	}
	view.setUint32(4, bytes.byteLength - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 16_000, true);
	view.setUint32(28, 64_000, true);
	view.setUint16(32, 4, true);
	view.setUint16(34, 32, true);
	view.setUint32(40, sampleCount * 4, true);
	return bytes;
}
