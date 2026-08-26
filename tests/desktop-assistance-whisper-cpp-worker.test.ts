/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';

import { captureAssistanceRuntimeFamilyJobGrantV1 } from '../desktop/assistance-runtime-family-file-grants.ts';
import {
	createAssistanceWhisperCppWorkerSpawnerV1,
	type AssistanceWhisperCppChild,
	type AssistanceWhisperCppSpawn,
} from '../desktop/assistance-whisper-cpp-worker.ts';

const JOB_ID = '1'.repeat(40);
const INPUT_ID = '2'.repeat(40);
const OUTPUT_ID = '3'.repeat(40);

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

class FakeChild extends EventEmitter implements AssistanceWhisperCppChild {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	killed = false;
	kill(): boolean {
		this.killed = true;
		queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
		return true;
	}
}

async function fixture(context: TestContext, maximumByteLength = 64 * 1024) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-whisper-worker-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'input.wav');
	const model = join(root, 'ggml-large-v3-turbo-q5_0.bin');
	const output = join(root, 'transcript.json');
	const inputBytes = Buffer.from('RIFF-wave');
	const modelBytes = Buffer.from('ggml-model');
	await Promise.all([writeFile(input, inputBytes), writeFile(model, modelBytes),
		writeFile(output, new Uint8Array())]);
	const grant = await captureAssistanceRuntimeFamilyJobGrantV1({
		jobId: JOB_ID, familyId: 'whisper-cpp', task: 'speech-recognition',
		settingsJson: JSON.stringify({ operation: 'speech-recognition', inputRoles: ['audio'],
			outputRoles: ['transcript'] }),
		inputs: [{ claim: { claimVersion: 1, claimId: INPUT_ID, jobId: JOB_ID,
			role: 'audio', mediaType: 'audio/wav', byteLength: inputBytes.byteLength,
			sha256: digest(inputBytes) }, path: input }],
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
	return { job, paths: { input, model, output } };
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
