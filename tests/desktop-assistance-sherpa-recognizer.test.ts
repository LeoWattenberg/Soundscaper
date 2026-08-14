/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assembleWordsFromTokens,
	createSherpaRecognizerFactory,
	sherpaResultToRecognition,
} from '../desktop/assistance-sherpa-recognizer.ts';
import { ingestRecognitionResult } from '../src/common/editor/assistance/transcript-ingest.ts';

/**
 * The opening of the shipped test clip as the real model decoded it: sub-word
 * tokens, a timestamp and duration each, and an empty words array.
 */
const MEASURED = Object.freeze({
	text: "Well, I don't wish to see it",
	tokens: [' Well', ',', ' I', ' don', "'", 't', ' w', 'ish', ' to', ' see', ' it'],
	timestamps: [0.4, 0.64, 0.72, 0.88, 1.04, 1.04, 1.04, 1.2, 1.36, 1.52, 1.68],
	durations: [0.24, 0.08, 0.16, 0.16, 0, 0, 0.16, 0.16, 0.16, 0.16, 0.08],
	lang: 'en',
});

test('sub-word tokens are assembled into words on the leading-space boundary', () => {
	const words = assembleWordsFromTokens(MEASURED);

	assert.deepEqual(words.map(({ text }) => text), [
		'Well,', 'I', "don't", 'wish', 'to', 'see', 'it',
	], 'punctuation stays attached to the word it followed');

	const [first] = words;
	assert.equal(first?.startSeconds, 0.4);
	assert.equal(first?.endSeconds, 0.72, 'a word ends at its last token plus that token duration');

	const contraction = words.find(({ text }) => text === "don't");
	assert.equal(contraction?.startSeconds, 0.88, 'the apostrophe does not start a new word');
	assert.equal(contraction?.endSeconds, 1.04);
});

test('a decode with no durations still yields ordered words', () => {
	const words = assembleWordsFromTokens({
		tokens: [' one', ' two'],
		timestamps: [0, 1],
	});

	assert.deepEqual(words.map(({ text, startSeconds, endSeconds }) => [text, startSeconds, endSeconds]), [
		['one', 0, 0],
		['two', 1, 1],
	]);
});

test('misaligned runtime output is refused rather than zipped together', () => {
	assert.throws(
		() => assembleWordsFromTokens({ tokens: [' a', ' b'], timestamps: [0] }),
		/timestamp per token mismatch/iu,
	);
	assert.throws(
		() => assembleWordsFromTokens({ tokens: [' a'], timestamps: [0], durations: [0.1, 0.2] }),
		/duration per token mismatch/iu,
	);
});

test('an offline decode becomes exactly one segment', () => {
	const recognition = sherpaResultToRecognition(MEASURED, 2.5);

	assert.equal(recognition.language, 'en');
	assert.equal(recognition.segments.length, 1, 'segmenting utterances is voice-activity detection work');
	const [segment] = recognition.segments;
	assert.equal(segment?.startSeconds, 0.4);
	assert.equal(segment?.endSeconds, 2.5, 'the segment covers the submitted range');
	assert.equal(segment?.text, "Well, I don't wish to see it");
	assert.equal(segment?.words?.length, 7);
	assert.equal(segment?.speaker, null);
});

test('an unreported language comes back as null rather than blank', () => {
	// The runtime returns lang: '' for models that identify no language, which
	// the recognition contract refuses as a language value.
	assert.equal(sherpaResultToRecognition({ ...MEASURED, lang: '' }, 2.5).language, null);
	assert.equal(sherpaResultToRecognition({ ...MEASURED, lang: '  ' }, 2.5).language, null);
	assert.equal(sherpaResultToRecognition({ ...MEASURED, lang: 'en' }, 2.5).language, 'en');
	assert.equal(sherpaResultToRecognition({ text: '', tokens: [], timestamps: [], lang: '' }, 1).language, null);
});

test('a decode that recognized nothing produces no segments', () => {
	assert.deepEqual(sherpaResultToRecognition({ text: '', tokens: [], timestamps: [] }, 5).segments, []);
	assert.throws(() => sherpaResultToRecognition(MEASURED, Number.NaN), /finite, non-negative duration/iu);
});

test('the decoded result conforms onto the project sample grid', () => {
	const recognition = sherpaResultToRecognition(MEASURED, 2.5);
	const { transcript, conformedBoundaries } = ingestRecognitionResult(recognition, {
		sourceId: 'source-1', sampleRate: 48_000, modelId: 'parakeet-tdt-0.6b-v2',
	});

	assert.equal(conformedBoundaries, 0, 'the measured decode needs no conforming');
	assert.deepEqual(
		transcript.segments[0]?.words.slice(0, 3).map(({ text, startFrame, endFrame }) => (
			[text, startFrame, endFrame]
		)),
		[
			['Well,', 19_200, 34_560],
			['I', 34_560, 42_240],
			["don't", 42_240, 49_920],
		],
		'0.4 s lands on sample 19200 and 0.88 s on 42240 at 48 kHz',
	);
});

test('the factory refuses a fused decoder-joiner export', async () => {
	const runtime = { OfflineRecognizer: class {}, readWave: () => ({ samples: new Float32Array(), sampleRate: 16_000 }) };
	const factory = createSherpaRecognizerFactory(runtime);

	await assert.rejects(
		factory.create({
			audioPath: '/media/a.wav',
			model: { encoder: '/e', decoder: '/d', joiner: '', tokens: '/t' },
		}),
		/needs a separate joiner model/iu,
	);
});

test('a runtime without an offline recognizer is refused', () => {
	assert.throws(() => createSherpaRecognizerFactory({}), /does not expose an offline recognizer/iu);
	assert.throws(() => createSherpaRecognizerFactory(null), /does not expose an offline recognizer/iu);
	assert.throws(
		() => createSherpaRecognizerFactory({ default: { OfflineRecognizer: 1 } }),
		/does not expose an offline recognizer/iu,
	);
});

test('a CommonJS namespace is unwrapped to the module it carries', () => {
	// A dynamic import of this package yields a namespace whose interop default
	// holds the API, so both shapes have to resolve to the same factory.
	const module = {
		OfflineRecognizer: class {
			createStream() { return { acceptWaveform: () => undefined }; }

			decode() { /* no decoding needed for the shape check */ }

			getResult() { return MEASURED; }
		},
		readWave: () => ({ samples: new Float32Array(16_000), sampleRate: 16_000 }),
	};

	assert.doesNotThrow(() => createSherpaRecognizerFactory(module));
	assert.doesNotThrow(() => createSherpaRecognizerFactory({ default: module }));
});

test('the factory drives the runtime and returns a conformable result', async () => {
	const calls: string[] = [];
	const runtime = {
		OfflineRecognizer: class {
			createStream() {
				calls.push('createStream');
				return { acceptWaveform: () => calls.push('acceptWaveform') };
			}

			decode() { calls.push('decode'); }

			getResult() { return MEASURED; }
		},
		readWave: (path: string) => {
			calls.push(`readWave:${path}`);
			return { samples: new Float32Array(40_000), sampleRate: 16_000 };
		},
	};

	const recognizer = await createSherpaRecognizerFactory(runtime).create({
		audioPath: '/media/episode.wav',
		model: { encoder: '/e', decoder: '/d', joiner: '/j', tokens: '/t' },
	});
	const result = await recognizer.recognize('/media/episode.wav');

	assert.deepEqual(calls, [
		'readWave:/media/episode.wav', 'createStream', 'acceptWaveform', 'decode',
	]);
	assert.equal(result.segments[0]?.endSeconds, 2.5, 'the segment spans the 40000-sample clip');
});
