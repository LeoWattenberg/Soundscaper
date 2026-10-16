/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSherpaRecognizerFactory } from '../desktop/assistance-sherpa-recognizer.ts';
import { createSherpaVadFactory } from '../desktop/assistance-sherpa-vad.ts';
import { createSherpaDiarizerFactory } from '../desktop/assistance-sherpa-diarizer.ts';
import type { SherpaAccelerationOptions } from '../desktop/assistance-sherpa-acceleration.ts';

const KINDS = ['recognizer', 'vad', 'diarizer'] as const;
type Kind = typeof KINDS[number];
interface HarnessOptions {
	readonly fail?: 'construct' | 'run';
	readonly failure?: Error;
	readonly cpuFails?: boolean;
	readonly malformed?: boolean;
	readonly sampleRate?: number;
	readonly onRun?: () => void;
	readonly cleanupFails?: boolean;
}

function harness(kind: Kind, options: HarnessOptions = {}, acceleration: SherpaAccelerationOptions = {
	executionProviders: ['webgpu', 'cpu'],
}) {
	const events: string[] = [];
	const configured: string[] = [];
	const failure = options.failure ?? new Error('GPU unavailable');
	const native = (stage: 'construct' | 'run', provider: string): void => {
		events.push(`${stage}:${provider}`);
		if (stage === 'run') options.onRun?.();
		if (options.fail === stage && (provider !== 'cpu' || options.cpuFails)) throw failure;
	};
	const readWave = () => ({ sampleRate: options.sampleRate ?? 16_000, samples: new Float32Array(16_000) });
	const cleanup = (provider: string): void => {
		events.push(`dispose:${provider}`);
		if (options.cleanupFails) throw new Error('cleanup failed');
	};
	if (kind === 'recognizer') {
		const factory = createSherpaRecognizerFactory({
			readWave,
			OfflineRecognizer: class {
				readonly provider: string;
				constructor(config: { modelConfig: { provider: string } }) {
					this.provider = config.modelConfig.provider;
					configured.push(this.provider);
					native('construct', this.provider);
				}
				createStream() { return { acceptWaveform: () => {} }; }
				decode() { native('run', this.provider); }
				getResult() {
					return { text: ' one', tokens: [' one'], timestamps: options.malformed ? [] : [0], durations: [0.1] };
				}
				free() { cleanup(this.provider); }
			},
		}, acceleration);
		return { events, configured, async run(signal?: AbortSignal) {
			const recognizer = await factory.create({ audioPath: '/audio.wav',
				model: { encoder: '/e', decoder: '/d', joiner: '/j', tokens: '/t' }, signal });
			try { return await recognizer.recognize('/audio.wav'); }
			finally { recognizer.dispose?.(); }
		} };
	}
	if (kind === 'vad') {
		const factory = createSherpaVadFactory({
			readWave,
			Vad: class {
				readonly provider: string;
				queued = false;
				constructor(config: { provider: string }) {
					this.provider = config.provider; configured.push(this.provider); native('construct', this.provider);
				}
				acceptWaveform() { native('run', this.provider); }
				isEmpty() { return !this.queued; }
				front() { return { start: options.malformed ? 16_000 : 0, samples: new Float32Array(512) }; }
				pop() { this.queued = false; }
				flush() { this.queued = true; }
				clear() { events.push(`clear:${this.provider}`); }
				free() { cleanup(this.provider); }
			},
		}, acceleration);
		return { events, configured, run: (signal?: AbortSignal) => factory.detect({
			audioPath: '/audio.wav', model: { model: '/vad' }, signal,
		}) };
	}
	const factory = createSherpaDiarizerFactory({
		readWave,
		OfflineSpeakerDiarization: class {
			readonly sampleRate = 16_000;
			readonly provider: string;
			constructor(config: { segmentation: { provider: string }; embedding: { provider: string } }) {
				assert.equal(config.embedding.provider, config.segmentation.provider, 'both diarization neural models use the selected provider');
				this.provider = config.segmentation.provider; configured.push(this.provider); native('construct', this.provider);
			}
			process() {
				native('run', this.provider);
				return [{ start: 0, end: 0.5, speaker: options.malformed ? -1 : 0 }];
			}
			free() { cleanup(this.provider); }
		},
	}, acceleration);
	return { events, configured, run: (signal?: AbortSignal) => factory.diarize({ audioPath: '/audio.wav',
		models: { segmentation: '/segmentation', embedding: '/embedding' }, signal }) };
}

for (const kind of KINDS) {
	for (const provider of ['coreml', 'webgpu'] as const) test(`Sherpa ${kind} selects authenticated ${provider} for every neural model`, async () => {
		const fixture = harness(kind, {}, { executionProviders: [provider, 'cpu'] });
		await fixture.run();
		assert.deepEqual(fixture.configured, [provider]);
		assert.ok(fixture.events.includes(`run:${provider}`));
		assert.equal(fixture.events.at(-1), `dispose:${provider}`);
	});

	for (const fail of ['construct', 'run'] as const) test(`Sherpa ${kind} retries native ${fail} failure on CPU after GPU quiesces`, async () => {
		const fixture = harness(kind, { fail });
		await fixture.run();
		assert.deepEqual(fixture.configured, ['webgpu', 'cpu']);
		if (fail === 'run') assert.ok(fixture.events.indexOf('dispose:webgpu') < fixture.events.indexOf('construct:cpu'));
		assert.equal(fixture.events.at(-1), 'dispose:cpu');
	});

	test(`Sherpa ${kind} preserves CPU execution errors`, async () => {
		const failure = new Error('CPU device failure');
		const fixture = harness(kind, { fail: 'run', cpuFails: true, failure });
		await assert.rejects(fixture.run(), (error) => error === failure);
		assert.deepEqual(fixture.configured, ['webgpu', 'cpu']);
	});

	test(`Sherpa ${kind} does not retry malformed native results`, async () => {
		const fixture = harness(kind, { malformed: true });
		await assert.rejects(fixture.run(), /mismatch|exceeds|invalid/iu);
		assert.deepEqual(fixture.configured, ['webgpu']);
	});

	test(`Sherpa ${kind} does not retry input validation or aborted native calls`, async () => {
		const invalid = harness(kind, { sampleRate: 48_000 });
		await assert.rejects(invalid.run(), /16 kHz/iu);
		assert.ok(!invalid.configured.includes('cpu'));
		const controller = new AbortController();
		const cancelled = harness(kind, { fail: 'run', onRun: () => { controller.abort(new Error('cancelled')); } });
		await assert.rejects(cancelled.run(controller.signal), /cancelled/iu);
		assert.deepEqual(cancelled.configured, ['webgpu']);
	});

	test(`Sherpa ${kind} does not start CPU inference when GPU cleanup fails`, async () => {
		const fixture = harness(kind, { fail: 'run', cleanupFails: true });
		await assert.rejects(fixture.run(), /cleanup failed/iu);
		assert.deepEqual(fixture.configured, ['webgpu']);
	});
}

test('Sherpa VAD restarts a failed GPU attempt with fresh output and monotone progress', async () => {
	const progress: number[] = [];
	const events: string[] = [];
	const detector = createSherpaVadFactory({
		readWave: () => ({ sampleRate: 16_000, samples: new Float32Array(2_048) }),
		Vad: class {
			readonly provider: string;
			calls = 0;
			queued = false;
			constructor(config: { provider: string }) { this.provider = config.provider; events.push(`create:${this.provider}`); }
			acceptWaveform() {
				this.calls += 1;
				if (this.provider === 'webgpu' && this.calls === 4) throw new Error('GPU lost after partial inference');
			}
			isEmpty() { return !this.queued; }
			front() { return { start: 512, samples: new Float32Array(512) }; }
			pop() { this.queued = false; }
			flush() { this.queued = true; }
			clear() {}
			free() { events.push(`free:${this.provider}`); }
		},
	}, { executionProviders: ['webgpu', 'cpu'] });
	const result = await detector.detect({ audioPath: '/audio.wav', model: { model: '/vad' },
		onProgress: ({ completed }) => { progress.push(completed); } });
	assert.deepEqual(result.segments, [{ startSample: 512, sampleCount: 512 }]);
	assert.deepEqual(events, ['create:webgpu', 'free:webgpu', 'create:cpu', 'free:cpu']);
	assert.deepEqual(progress, [512, 1_024, 1_536, 1_536, 1_536, 1_536, 2_048]);
});

test('Sherpa recognition replays reviewed VAD ranges after GPU failure without duplicate results or decreasing progress', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-gpu-range-retry-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const activityPath = join(root, 'activity.json');
	await writeFile(activityPath, JSON.stringify({ sampleRate: 16_000,
		segments: [0, 16_000, 32_000].map((startSample) => ({ startSample, sampleCount: 16_000 })) }));
	const events: string[] = [];
	const progress: number[] = [];
	const factory = createSherpaRecognizerFactory({
		readWave: () => ({ sampleRate: 16_000, samples: new Float32Array(48_000) }),
		OfflineRecognizer: class {
			readonly provider: string;
			calls = 0;
			constructor(config: { modelConfig: { provider: string } }) {
				this.provider = config.modelConfig.provider; events.push(`create:${this.provider}`);
			}
			createStream() { return { acceptWaveform() {}, free() { events.push('free:stream'); } }; }
			decode() {
				this.calls += 1;
				if (this.provider === 'webgpu' && this.calls === 3) throw new Error('GPU lost on final range');
			}
			getResult() { return { text: ' one', tokens: [' one'], timestamps: [0], durations: [0.1], lang: 'en' }; }
			free() { events.push(`free:${this.provider}`); }
		},
	}, { executionProviders: ['webgpu', 'cpu'] });
	const recognizer = await factory.create({ audioPath: '/audio.wav',
		model: { encoder: '/e', decoder: '/d', joiner: '/j', tokens: '/t' },
		onProgress: ({ completed }) => { progress.push(completed); } });
	try {
		const result = await recognizer.recognize('/audio.wav', activityPath);
		assert.deepEqual(result.segments.map(({ startSeconds }) => startSeconds), [0, 1, 2]);
		assert.deepEqual(progress, [1, 2, 2, 2, 3]);
		assert.ok(events.indexOf('free:webgpu') < events.indexOf('create:cpu'));
		assert.equal(events.filter((event) => event === 'free:stream').length, 6);
	} finally { recognizer.dispose?.(); }
	assert.equal(events.at(-1), 'free:cpu');
});
