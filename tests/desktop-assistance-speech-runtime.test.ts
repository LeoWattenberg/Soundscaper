/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSpeechRuntimeAdapter,
	normalizeRecognition,
	SPEECH_RUNTIME_MODULE_ID,
	type SpeechRecognitionRequest,
} from '../desktop/assistance-speech-runtime.ts';
import { ingestRecognitionResult } from '../src/common/editor/assistance/transcript-ingest.ts';

const REQUEST: SpeechRecognitionRequest = Object.freeze({
	audioPath: '/media/episode.wav',
	model: Object.freeze({
		encoder: '/models/blobs/sha256-encoder',
		decoder: '/models/blobs/sha256-decoder',
		joiner: '/models/blobs/sha256-joiner',
		tokens: '/models/blobs/sha256-tokens',
	}),
	language: 'en',
});

const RESULT = Object.freeze({
	language: 'en',
	segments: [
		{
			startSeconds: 0,
			endSeconds: 2,
			words: [
				{ text: 'So', startSeconds: 0, endSeconds: 0.5 },
				{ text: 'um', startSeconds: 0.6, endSeconds: 1 },
			],
		},
	],
});

function missingModule(): Promise<unknown> {
	const error = new Error("Cannot find package 'sherpa-onnx-node'");
	(error as Error & { code?: string }).code = 'ERR_MODULE_NOT_FOUND';
	return Promise.reject(error);
}

function factoryReturning(result: unknown, calls: string[] = []) {
	return () => ({
		create: async (request: SpeechRecognitionRequest) => {
			calls.push(request.audioPath);
			return { recognize: async () => result as never, dispose: () => calls.push('disposed') };
		},
	});
}

test('a missing runtime is reported as a capability, not a crash', { timeout: 10_000 }, async () => {
	const adapter = createSpeechRuntimeAdapter({ load: missingModule });

	const status = await adapter.status();
	assert.equal(status.available, false);
	assert.equal(status.moduleId, SPEECH_RUNTIME_MODULE_ID);
	assert.match(status.reason ?? '', /not installed/iu);

	await assert.rejects(adapter.recognize(REQUEST), /not installed/iu);
});

test('an unrelated load failure is reported with its own cause', { timeout: 10_000 }, async () => {
	const adapter = createSpeechRuntimeAdapter({
		load: () => Promise.reject(new Error('native binding is corrupt')),
	});

	assert.match((await adapter.status()).reason ?? '', /failed to load: native binding is corrupt/iu);
});

test('the load outcome is resolved once and cached', { timeout: 10_000 }, async () => {
	let loads = 0;
	const adapter = createSpeechRuntimeAdapter({
		load: () => { loads += 1; return missingModule(); },
	});

	await adapter.status();
	await adapter.status();
	await adapter.recognize(REQUEST).catch(() => undefined);

	assert.equal(loads, 1, 'a missing optional dependency does not appear later in the same process');
});

test('an available runtime recognizes and disposes its recognizer', { timeout: 10_000 }, async () => {
	const calls: string[] = [];
	const adapter = createSpeechRuntimeAdapter({
		load: () => Promise.resolve({}),
		createFactory: factoryReturning(RESULT, calls),
	});

	assert.equal((await adapter.status()).available, true);
	const result = await adapter.recognize(REQUEST);

	assert.equal(result.segments.length, 1);
	assert.deepEqual(calls, ['/media/episode.wav', 'disposed']);
});

test('an available runtime with no wired factory says so plainly', { timeout: 10_000 }, async () => {
	const adapter = createSpeechRuntimeAdapter({ load: () => Promise.resolve({}) });

	await assert.rejects(adapter.recognize(REQUEST), /no speech recognizer factory is wired/iu);
});

test('a request missing its model paths is refused before loading anything', { timeout: 10_000 }, async () => {
	const adapter = createSpeechRuntimeAdapter({
		load: () => { throw new Error('must not load'); },
	});

	await assert.rejects(adapter.recognize({ ...REQUEST, audioPath: '' }), /needs an audio path/iu);
	await assert.rejects(
		adapter.recognize({ ...REQUEST, model: { ...REQUEST.model, tokens: '' } }),
		/needs the model tokens path/iu,
	);
});

test('runtime output is validated rather than trusted', () => {
	assert.deepEqual(normalizeRecognition(RESULT).segments.length, 1);

	assert.throws(() => normalizeRecognition(null), /must be an object/iu);
	assert.throws(() => normalizeRecognition({ segments: 'nope' }), /array of segments/iu);
	assert.throws(
		() => normalizeRecognition({ segments: [{ startSeconds: -1, endSeconds: 1 }] }),
		/startSeconds must be a finite, non-negative number/iu,
	);
	assert.throws(
		() => normalizeRecognition({ segments: [{ startSeconds: 0, endSeconds: Number.NaN }] }),
		/endSeconds must be a finite, non-negative number/iu,
	);
	assert.throws(() => normalizeRecognition({ segments: [], language: '' }), /non-empty string or null/iu);
});

test('a recognized result flows into the transcript domain unchanged', { timeout: 10_000 }, async () => {
	const adapter = createSpeechRuntimeAdapter({
		load: () => Promise.resolve({}),
		createFactory: factoryReturning(RESULT),
	});

	const recognition = await adapter.recognize(REQUEST);
	const { transcript } = ingestRecognitionResult(recognition, {
		sourceId: 'source-1', sampleRate: 48_000, modelId: 'parakeet-tdt-0.6b-v2',
	});

	assert.equal(transcript.language, 'en');
	assert.deepEqual(
		transcript.segments[0]?.words.map(({ text, startFrame }) => [text, startFrame]),
		[['So', 0], ['um', 28_800]],
		'the adapter and the ingest boundary agree on the wire shape',
	);
});
