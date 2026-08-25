/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSherpaVadFactory } from '../desktop/assistance-sherpa-vad.ts';
import { normalizeVoiceActivityResult } from '../desktop/assistance-vad-runtime.ts';

test('Sherpa VAD measures exact speech sample ranges from authenticated 16 kHz audio', async () => {
	const configurations: unknown[] = [];
	const accepted: number[] = [];
	let flushed = false;
	let cleared = false;
	const queued = [
		{ start: 512, samples: new Float32Array(800) },
		{ start: 2_048, samples: new Float32Array(1_024) },
	];
	const runtime = {
		readWave: (path: string) => {
			assert.equal(path, '/private/selected.wav');
			return { sampleRate: 16_000, samples: new Float32Array(4_096) };
		},
		Vad: class {
			constructor(config: unknown, bufferSeconds: number) {
				configurations.push({ config, bufferSeconds });
			}
			acceptWaveform(samples: Float32Array) { accepted.push(samples.length); }
			isEmpty() { return queued.length === 0; }
			front() { return queued[0]; }
			pop() { queued.shift(); }
			flush() { flushed = true; }
			clear() { cleared = true; }
		},
	};
	const progress: unknown[] = [];
	const detector = createSherpaVadFactory(runtime);

	const result = await detector.detect({
		audioPath: '/private/selected.wav',
		modelId: 'silero-vad-v6',
		model: { model: '/private/silero_vad.onnx' },
		onProgress: (value) => progress.push(value),
	});

	assert.deepEqual(result, {
		sampleRate: 16_000,
		segments: [
			{ startSample: 512, sampleCount: 800 },
			{ startSample: 2_048, sampleCount: 1_024 },
		],
	});
	assert.deepEqual(accepted, Array(8).fill(512));
	assert.deepEqual(progress.at(-1), { completed: 4_096, total: 4_096 });
	assert.equal(flushed, true);
	assert.equal(cleared, true);
	assert.deepEqual(configurations, [{
		config: {
			sileroVad: {
				model: '/private/silero_vad.onnx', threshold: 0.5,
				minSilenceDuration: 0.5, minSpeechDuration: 0.25,
				windowSize: 512, maxSpeechDuration: 30,
			},
			sampleRate: 16_000, numThreads: 2, provider: 'cpu', debug: 0,
		},
		bufferSeconds: 60,
	}]);
});

test('Sherpa VAD rejects non-16 kHz input instead of changing timing authority', async () => {
	const detector = createSherpaVadFactory({
		readWave: () => ({ sampleRate: 48_000, samples: new Float32Array(8) }),
		Vad: class { constructor() { throw new Error('must not construct'); } },
	});
	await assert.rejects(detector.detect({
		audioPath: '/private/selected.wav', model: { model: '/private/silero.onnx' },
	}), /16 kHz/iu);
});

test('voice-activity result admission rejects overlapping or out-of-order segments', () => {
	assert.throws(() => normalizeVoiceActivityResult({
		sampleRate: 16_000,
		segments: [
			{ startSample: 100, sampleCount: 100 },
			{ startSample: 199, sampleCount: 10 },
		],
	}), /ordered and disjoint/iu);
});
