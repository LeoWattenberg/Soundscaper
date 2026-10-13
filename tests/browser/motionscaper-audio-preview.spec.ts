/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Mixer from '../../src/common/editor/motion-audio-mixer.ts';
import type * as Preview from '../../src/common/editor/controller/track-audio/motion-audio-preview.ts';
import type * as Project from '../../src/motionscaper/editor-project.ts';
import type * as Property from '../../src/common/editor/motion-property.ts';
import type { MotionAudioMixer } from '../../src/common/editor/motion-audio-contract.ts';

type Fixture = typeof Mixer & typeof Preview & typeof Project & typeof Property;
interface Scope { motionAudioFixture: Fixture; audioPreview: ReturnType<typeof Preview.createMotionAudioPreview>; mixer: MotionAudioMixer;
	context: AudioContext; analyser: AnalyserNode; playbackError: string | null; maximumQueued: number }
const bundle = () => buildSync({ stdin: { contents: `export * from '../../src/common/editor/motion-audio-mixer.ts';
export * from '../../src/common/editor/controller/track-audio/motion-audio-preview.ts';
export * from '../../src/motionscaper/editor-project.ts'; export * from '../../src/common/editor/motion-property.ts';`,
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'motionAudioFixture', target: 'es2022' }).outputFiles[0]!.text;

test('M05 real AudioContext plays bounded mixed PCM and its sample clock stops on pause', async ({ page }) => {
	await page.setContent('<button type="button">Play audio</button>'); await page.addScriptTag({ content: bundle() });
	await page.evaluate(() => {
		const scope = globalThis as unknown as Scope; const motion = scope.motionAudioFixture; const rate = 48000;
		const base = motion.createMotionscaperProject({ id: 'audio', title: 'Audio', compositionId: 'main', sampleRate: rate }); const sha256 = 'a'.repeat(64);
		const asset = { id: 'tone', kind: 'audio' as const, name: 'Tone', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'audio/wav', sampleRate: rate, channels: 1, duration: { num: 1, den: 1 } };
		const placement = { id: 'sound', assetId: 'tone', startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 30, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motion.motionScalar(0.2) };
		scope.mixer = motion.createMotionAudioMixer({ project: { ...base, assets: [asset], compositions: [{ ...base.compositions[0]!, audio: [placement] }] }, provider: {
			describe: () => Promise.resolve({ sampleRate: rate, channels: 1, sampleCount: rate }),
			read: ({ startSample, sampleCount }) => Promise.resolve(Float32Array.from({ length: sampleCount }, (_, index) => Math.sin(2 * Math.PI * (startSample + index) * 440 / rate))),
		} });
		scope.context = new AudioContext({ sampleRate: rate }); scope.analyser = scope.context.createAnalyser(); scope.analyser.fftSize = 256;
		const quiet = scope.context.createGain(); quiet.gain.value = 0; scope.analyser.connect(quiet); quiet.connect(scope.context.destination);
		const createSource = scope.context.createBufferSource.bind(scope.context);
		scope.context.createBufferSource = () => { const source = createSource(); source.connect(scope.analyser); return source; };
		scope.maximumQueued = 0; scope.playbackError = null;
		scope.audioPreview = motion.createMotionAudioPreview({ mixer: scope.mixer, context: scope.context, blockSamples: 4096, maximumQueuedBlocks: 3,
			onState: (state) => { scope.maximumQueued = Math.max(scope.maximumQueued, state.queuedBlocks); }, onError: (error) => { scope.playbackError = error.message; } });
		document.querySelector('button')!.addEventListener('click', () => { void scope.audioPreview.play({ compositionId: 'main', startTime: 0, endTime: 1 }).catch((error: unknown) => { scope.playbackError = String(error); }); });
	});
	await page.getByRole('button', { name: 'Play audio' }).click();
	// Observe the live audio window in-page; cross-process backoff can miss a one-second signal.
	const ready = await page.waitForFunction(() => {
		const scope = globalThis as unknown as Scope; const samples = new Float32Array(256); scope.analyser.getFloatTimeDomainData(samples);
		const playing = { clock: scope.audioPreview.clock.now(), error: scope.playbackError, peak: Math.max(...samples.map(Math.abs)), maximumQueued: scope.maximumQueued, status: scope.audioPreview.snapshot().status };
		if (playing.error !== null || playing.maximumQueued > 3) return playing;
		return playing.clock > 30 && playing.peak > 0.15 && playing.status === 'playing' ? playing : null;
	}, undefined, { polling: 20, timeout: 5000 });
	const playing = await ready.jsonValue(); await ready.dispose();
	if (!playing) throw new Error('The live audio readiness observation is missing.');
	expect(playing.clock).toBeGreaterThan(30); expect(playing.error).toBeNull(); expect(playing.peak).toBeGreaterThan(0.15);
	expect(playing.maximumQueued).toBeLessThanOrEqual(3); expect(playing.status).toBe('playing');
	const paused = await page.evaluate(() => { const scope = globalThis as unknown as Scope; scope.audioPreview.pause(); return { clock: scope.audioPreview.clock.now(), context: scope.context.currentTime }; });
	await expect.poll(() => page.evaluate(() => (globalThis as unknown as Scope).context.currentTime)).toBeGreaterThan(paused.context + 0.05);
	const stopped = await page.evaluate(async () => {
		const scope = globalThis as unknown as Scope; const clock = scope.audioPreview.clock.now(); scope.audioPreview.dispose(); scope.mixer.dispose();
		const state = scope.context.state; await scope.context.close(); return { clock, suppliedContextState: state, queued: scope.audioPreview.snapshot().queuedBlocks };
	});
	expect(stopped.clock).toBe(paused.clock); expect(stopped.queued).toBe(0); expect(stopped.suppliedContextState).toBe('running');
});
