/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAssistanceHelperRuntimeAdapter } from '../desktop/assistance-helper-runtime.ts';
import { validateAssistanceJobRequest } from '../desktop/assistance-job-protocol.ts';
import { SPEECH_RUNTIME_MODULE_ID } from '../desktop/assistance-speech-runtime.ts';

const RESULT = Object.freeze({ language: null, segments: Object.freeze([]) });

test('main grants exact digest-bound audio and model artifacts to the speech helper', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = Object.fromEntries(await Promise.all(
		['audio', 'voice-activity', 'encoder', 'decoder', 'joiner', 'tokens'].map(async (role) => {
			const path = join(root, `${role}.bin`);
			await writeFile(path, `${role}-bytes`);
			return [role, path];
		}),
	)) as Record<string, string>;
	const requests: unknown[] = [];
	const runtime = createAssistanceHelperRuntimeAdapter({
		mintJobId: () => 'ab'.repeat(20),
		host: {
			start(request) {
				requests.push(request);
				return { jobId: 'ab'.repeat(20), completed: Promise.resolve(RESULT), cancel: () => Promise.resolve() };
			},
			dispose() {},
		},
	});

	assert.deepEqual(await runtime.recognize({
		modelId: 'parakeet-tdt-0.6b-v2',
		audioPath: paths.audio!,
		voiceActivityPath: paths['voice-activity']!,
		model: {
			encoder: paths.encoder!, decoder: paths.decoder!, joiner: paths.joiner!, tokens: paths.tokens!,
		},
		language: 'en', threads: 4,
	}), RESULT);
	const admitted = validateAssistanceJobRequest(requests[0]);
	assert.equal(admitted.grant.operation, 'recognize');
	if (admitted.grant.operation !== 'recognize') return;
	assert.equal(admitted.grant.modelId, 'parakeet-tdt-0.6b-v2');
	assert.equal(admitted.grant.voiceActivity?.role, 'voice-activity');
	assert.deepEqual(
		[admitted.grant.audio, admitted.grant.voiceActivity!, ...Object.values(admitted.grant.model)]
			.map(({ role }) => role),
		['audio', 'voice-activity', 'encoder', 'decoder', 'joiner', 'tokens'],
	);
	for (const file of [admitted.grant.audio, admitted.grant.voiceActivity!,
		...Object.values(admitted.grant.model)]) {
		const bytes = await readFile(file.path);
		assert.equal(file.bytes, bytes.byteLength);
		assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
		assert.ok(file.identity.dev >= 0 && file.identity.ino >= 0);
	}
});

test('main grants exact digest-bound selected audio and Silero model to the VAD helper', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-vad-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const audioPath = join(root, 'selected.wav');
	const modelPath = join(root, 'silero_vad.onnx');
	await Promise.all([writeFile(audioPath, 'wave'), writeFile(modelPath, 'model')]);
	let request: unknown = null;
	const runtime = createAssistanceHelperRuntimeAdapter({
		mintJobId: () => 'ef'.repeat(20),
		host: {
			start(value) {
				request = value;
				return { jobId: 'ef'.repeat(20), completed: Promise.resolve({
					sampleRate: 16_000, segments: [{ startSample: 512, sampleCount: 1_024 }],
				}), cancel: () => Promise.resolve() };
			},
			dispose() {},
		},
	});

	assert.deepEqual(await runtime.detect({
		modelId: 'silero-vad-v6', audioPath, model: { model: modelPath },
	}), { sampleRate: 16_000, segments: [{ startSample: 512, sampleCount: 1_024 }] });
	const admitted = validateAssistanceJobRequest(request);
	assert.equal(admitted.grant.operation, 'detect-voice-activity');
	if (admitted.grant.operation !== 'detect-voice-activity') return;
	assert.equal(admitted.grant.modelId, 'silero-vad-v6');
	assert.equal(admitted.grant.audio.role, 'audio');
	assert.equal(admitted.grant.model.role, 'vad-model');
	for (const file of [admitted.grant.audio, admitted.grant.model]) {
		const contents = await readFile(file.path);
		assert.equal(file.bytes, contents.byteLength);
		assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
	}
});

test('main grants exact audio, segmentation, and embedding files to the diarization helper', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-diarization-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const audioPath = join(root, 'selected.wav');
	const segmentationPath = join(root, 'pyannote.onnx');
	const embeddingPath = join(root, 'eres2net.onnx');
	await Promise.all([
		writeFile(audioPath, 'wave'),
		writeFile(segmentationPath, 'segmentation'),
		writeFile(embeddingPath, 'embedding'),
	]);
	let request: unknown = null;
	const runtime = createAssistanceHelperRuntimeAdapter({
		mintJobId: () => '12'.repeat(20),
		host: {
			start(value) {
				request = value;
				return { jobId: '12'.repeat(20), completed: Promise.resolve({
					sampleRate: 16_000,
					turns: [{ startSample: 1_600, sampleCount: 8_000, speakerId: 0 }],
				}), cancel: () => Promise.resolve() };
			},
			dispose() {},
		},
	});

	assert.deepEqual(await runtime.diarize({
		audioPath,
		modelIds: {
			segmentation: 'pyannote-segmentation-3.0',
			embedding: 'speech-3d-speaker-eres2net',
		},
		models: { segmentation: segmentationPath, embedding: embeddingPath },
	}), {
		sampleRate: 16_000,
		turns: [{ startSample: 1_600, sampleCount: 8_000, speakerId: 0 }],
	});
	const admitted = validateAssistanceJobRequest(request);
	assert.equal(admitted.grant.operation, 'diarize-speakers');
	if (admitted.grant.operation !== 'diarize-speakers') return;
	assert.deepEqual(admitted.grant.modelIds, {
		segmentation: 'pyannote-segmentation-3.0',
		embedding: 'speech-3d-speaker-eres2net',
	});
	assert.deepEqual([admitted.grant.audio.role, admitted.grant.models.segmentation.role,
		admitted.grant.models.embedding.role], ['audio', 'segmentation-model', 'embedding-model']);
	for (const file of [admitted.grant.audio, ...Object.values(admitted.grant.models)]) {
		const contents = await readFile(file.path);
		assert.equal(file.bytes, contents.byteLength);
		assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
	}
});

test('runtime status is answered by the helper rather than loading sherpa in main', async () => {
	let request: unknown = null;
	const runtime = createAssistanceHelperRuntimeAdapter({
		mintJobId: () => 'cd'.repeat(20),
		host: {
			start(value) {
				request = value;
				return {
					jobId: 'cd'.repeat(20),
					completed: Promise.resolve({
						available: false, reason: 'not installed', moduleId: SPEECH_RUNTIME_MODULE_ID,
					}),
					cancel: () => Promise.resolve(),
				};
			},
			dispose() {},
		},
	});
	assert.equal((await runtime.status()).available, false);
	assert.deepEqual(validateAssistanceJobRequest(request).grant, {
		operation: 'status', moduleId: SPEECH_RUNTIME_MODULE_ID,
	});
	const registration = await readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.doesNotMatch(registration, /assistance-sherpa-recognizer|createSpeechRuntimeAdapter/u);
	assert.match(registration, /assistance-helper-process\.js/u);
});

test('a missing or non-file grant is refused before any helper job starts', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	let starts = 0;
	const runtime = createAssistanceHelperRuntimeAdapter({
		host: {
			start() { starts += 1; throw new Error('must not start'); },
			dispose() {},
		},
	});
	await assert.rejects(runtime.recognize({
		audioPath: join(root, 'missing.wav'),
		model: { encoder: root, decoder: root, joiner: root, tokens: root },
	}), /ENOENT|regular file/iu);
	assert.equal(starts, 0);
});

test('recognition carries progress and AbortSignal to the supervised helper run', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = Object.fromEntries(await Promise.all(
		['audio', 'encoder', 'decoder', 'joiner', 'tokens'].map(async (role) => {
			const path = join(root, `${role}.bin`);
			await writeFile(path, role);
			return [role, path];
		}),
	)) as Record<string, string>;
	const controller = new AbortController();
	const progress: unknown[] = [];
	let receivedOptions: unknown = null;
	const runtime = createAssistanceHelperRuntimeAdapter({
		host: {
			start(_request, options) {
				receivedOptions = options;
				return {
					jobId: 'ab'.repeat(20), completed: Promise.resolve(RESULT),
					cancel: () => Promise.resolve(),
				};
			},
			dispose() {},
		},
	});
	await runtime.recognize({
		audioPath: paths.audio!,
		model: {
			encoder: paths.encoder!, decoder: paths.decoder!, joiner: paths.joiner!, tokens: paths.tokens!,
		},
		signal: controller.signal,
		onProgress: (value) => progress.push(value),
	});
	assert.deepEqual(receivedOptions, {
		signal: controller.signal,
		onProgress: (receivedOptions as { onProgress: unknown }).onProgress,
	});
	(receivedOptions as { onProgress: (value: unknown) => void }).onProgress({ completed: 1, total: 2 });
	assert.deepEqual(progress, [{ completed: 1, total: 2 }]);
});

test('a signal aborted before grant capture refuses without reading into helper admission', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = Object.fromEntries(await Promise.all(
		['audio', 'encoder', 'decoder', 'joiner', 'tokens'].map(async (role) => {
			const path = join(root, `${role}.bin`);
			await writeFile(path, role);
			return [role, path];
		}),
	)) as Record<string, string>;
	let starts = 0;
	const runtime = createAssistanceHelperRuntimeAdapter({
		host: {
			start() {
				starts += 1;
				throw new Error('An aborted grant must not reach the helper.');
			},
			dispose() {},
		},
	});
	const controller = new AbortController();
	const reason = new DOMException('Grant capture was cancelled.', 'AbortError');
	controller.abort(reason);
	await assert.rejects(runtime.recognize({
		audioPath: paths.audio!,
		model: {
			encoder: paths.encoder!, decoder: paths.decoder!, joiner: paths.joiner!, tokens: paths.tokens!,
		},
		signal: controller.signal,
	}), (error: unknown) => error === reason);
	assert.equal(starts, 0);
});

test('abort during grant hashing destroys every open stream before helper admission', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-speech-grants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = Object.fromEntries(await Promise.all(
		['audio', 'encoder', 'decoder', 'joiner', 'tokens'].map(async (role) => {
			const path = join(root, `${role}.bin`);
			await writeFile(path, role);
			return [role, path];
		}),
	)) as Record<string, string>;
	const rejectedReads = new Map<string, (reason?: unknown) => void>();
	const destroyed = new Map<string, Error | undefined>();
	let captureCount = 0;
	let captureStarted!: () => void;
	const allCapturesStarted = new Promise<void>((resolve) => { captureStarted = resolve; });
	let starts = 0;
	const runtime = createAssistanceHelperRuntimeAdapter({
		openFileReadStream: (path) => ({
			async *[Symbol.asyncIterator]() {
				captureCount += 1;
				if (captureCount === 5) captureStarted();
				await new Promise<never>((_resolve, reject) => { rejectedReads.set(path, reject); });
			},
			destroy(error?: Error) {
				destroyed.set(path, error);
				rejectedReads.get(path)?.(error);
			},
		}),
		host: {
			start() {
				starts += 1;
				throw new Error('A cancelled grant must not reach the helper.');
			},
			dispose() {},
		},
	});
	const controller = new AbortController();
	const reason = new DOMException('Stop capturing grants.', 'AbortError');
	const recognition = runtime.recognize({
		audioPath: paths.audio!,
		model: {
			encoder: paths.encoder!, decoder: paths.decoder!, joiner: paths.joiner!, tokens: paths.tokens!,
		},
		signal: controller.signal,
	});
	await allCapturesStarted;
	controller.abort(reason);
	await assert.rejects(recognition, (error: unknown) => error === reason);
	assert.equal(starts, 0);
	assert.equal(destroyed.size, 5);
	for (const error of destroyed.values()) assert.equal(error, reason);
});
