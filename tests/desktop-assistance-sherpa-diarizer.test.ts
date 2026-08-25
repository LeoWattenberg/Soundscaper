/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSherpaDiarizerFactory } from '../desktop/assistance-sherpa-diarizer.ts';
import { normalizeSpeakerDiarizationResult } from '../desktop/assistance-diarization-runtime.ts';

test('Sherpa diarization measures ordered speaker turns from authenticated 16 kHz audio', async () => {
	const configurations: unknown[] = [];
	const processed: Float32Array[] = [];
	const runtime = {
		readWave: (path: string) => {
			assert.equal(path, '/private/selected.wav');
			return { sampleRate: 16_000, samples: new Float32Array(64_000) };
		},
		OfflineSpeakerDiarization: class {
			readonly sampleRate = 16_000;
			constructor(config: unknown) { configurations.push(config); }
			process(samples: Float32Array) {
				processed.push(samples);
				return [
					{ start: 1.5, end: 2.75, speaker: 1 },
					{ start: 0.25, end: 1.75, speaker: 0 },
				];
			}
		},
	};
	const progress: unknown[] = [];
	const diarizer = createSherpaDiarizerFactory(runtime);

	const result = await diarizer.diarize({
		audioPath: '/private/selected.wav',
		models: {
			segmentation: '/private/pyannote.onnx',
			embedding: '/private/eres2net.onnx',
		},
		onProgress: (value) => progress.push(value),
	});

	assert.deepEqual(result, {
		sampleRate: 16_000,
		turns: [
			{ startSample: 4_000, sampleCount: 24_000, speakerId: 0 },
			{ startSample: 24_000, sampleCount: 20_000, speakerId: 1 },
		],
	});
	assert.equal(processed.length, 1);
	assert.equal(processed[0]?.length, 64_000);
	assert.deepEqual(progress, [
		{ completed: 0, total: 64_000 },
		{ completed: 64_000, total: 64_000 },
	]);
	assert.deepEqual(configurations, [{
		segmentation: {
			pyannote: { model: '/private/pyannote.onnx' },
			numThreads: 2, debug: 0, provider: 'cpu',
		},
		embedding: {
			model: '/private/eres2net.onnx',
			numThreads: 2, debug: 0, provider: 'cpu',
		},
		clustering: { numClusters: 0, threshold: 0.5 },
		minDurationOn: 0.3,
		minDurationOff: 0.5,
	}]);
});

test('speaker diarization admits overlapping speakers but rejects unstable ordering', () => {
	assert.deepEqual(normalizeSpeakerDiarizationResult({
		sampleRate: 16_000,
		turns: [
			{ startSample: 100, sampleCount: 200, speakerId: 0 },
			{ startSample: 150, sampleCount: 100, speakerId: 1 },
		],
	}), {
		sampleRate: 16_000,
		turns: [
			{ startSample: 100, sampleCount: 200, speakerId: 0 },
			{ startSample: 150, sampleCount: 100, speakerId: 1 },
		],
	});
	assert.throws(() => normalizeSpeakerDiarizationResult({
		sampleRate: 16_000,
		turns: [
			{ startSample: 150, sampleCount: 100, speakerId: 1 },
			{ startSample: 100, sampleCount: 200, speakerId: 0 },
		],
	}), /ordered/iu);
});

test('Sherpa diarization rejects native timing outside selected audio', async () => {
	const diarizer = createSherpaDiarizerFactory({
		readWave: () => ({ sampleRate: 16_000, samples: new Float32Array(16_000) }),
		OfflineSpeakerDiarization: class {
			readonly sampleRate = 16_000;
			process() { return [{ start: 0.75, end: 1.01, speaker: 0 }]; }
		},
	});
	await assert.rejects(diarizer.diarize({
		audioPath: '/private/selected.wav',
		models: { segmentation: '/private/segment.onnx', embedding: '/private/embed.onnx' },
	}), /exceeds the selected audio/iu);
});

test('Sherpa diarization observes cancellation around its synchronous native call', async () => {
	const controller = new AbortController();
	const diarizer = createSherpaDiarizerFactory({
		readWave: () => ({ sampleRate: 16_000, samples: new Float32Array(16_000) }),
		OfflineSpeakerDiarization: class {
			readonly sampleRate = 16_000;
			process() {
				controller.abort(new Error('cancelled after native call'));
				return [];
			}
		},
	});
	await assert.rejects(diarizer.diarize({
		audioPath: '/private/selected.wav',
		models: { segmentation: '/private/segment.onnx', embedding: '/private/embed.onnx' },
		signal: controller.signal,
	}), /cancelled after native call/iu);
});
