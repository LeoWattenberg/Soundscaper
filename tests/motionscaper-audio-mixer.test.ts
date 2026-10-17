/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionAudioMixer } from '../src/common/editor/motion-audio-mixer.ts';
import type { MotionAudioSampleProvider } from '../src/common/editor/motion-audio-contract.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
const base = createMotionscaperProject({ id: 'audio', title: 'Audio', compositionId: 'main', sampleRate: 8000 });
const sha256 = 'a'.repeat(64);
const asset = { kind: 'audio' as const, id: 'sound', name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'audio/wav', sampleRate: 8000, channels: 1, duration: r(2) };
const placement = { id: 'placement', assetId: 'sound', startFrame: r(0), inFrame: r(0), outFrame: r(300), sourceStart: r(0), timeScale: r(1), enabled: true, gain: motionScalar(1) };
const project = { ...base, assets: [asset], compositions: [{ ...base.compositions[0]!, audio: [placement] }] };
const request = { compositionId: 'main', startSample: 100, sampleRate: 8000, sampleCount: 16, channels: 1 as const };
function provider(sample: (index: number, channel: number) => number, sampleRate = 8000, channels: 1 | 2 = 1) {
	const reads: Array<readonly [number, number]> = []; let active = 0; let peak = 0;
	const value: MotionAudioSampleProvider = {
		describe: () => Promise.resolve({ sampleRate, channels, sampleCount: sampleRate * 2 }),
		async read({ startSample, sampleCount }, signal) {
			signal?.throwIfAborted(); active++; peak = Math.max(peak, active); reads.push([startSample, sampleCount]); await Promise.resolve(); active--;
			return Float32Array.from({ length: sampleCount * channels }, (_, index) => sample(startSample + Math.floor(index / channels), index % channels));
		},
	};
	return { value, reads, peak: () => peak };
}

test('M05 audio mixing preserves gain, exact fractional sample starts, stereo mapping and revision identity', async () => {
	const source = provider((index) => index / 16000); const mixer = createMotionAudioMixer({ project: { ...project, revision: 7 }, provider: source.value });
	const block = await mixer.mixBlock({ ...request, startSample: r(201, 2), channels: 2 });
	assert.equal(block.revision, 7); assert.equal(block.revisionDigest, mixer.revision.digest); assert.deepEqual(block.startSample, r(201, 2));
	for (let index = 0; index < 16; index++) { assert.ok(Math.abs(block.interleaved[index * 2]! - (100.5 + index) / 16000) < 1e-6); assert.equal(block.interleaved[index * 2], block.interleaved[index * 2 + 1]); }
	const repeat = await mixer.mixBlock({ ...request, startSample: r(201, 2), channels: 2 }); assert.deepEqual(repeat.interleaved, block.interleaved); assert.equal(source.reads.length, 1); mixer.dispose();
});

test('M05 nested reverse and animated time remap use the composition evaluator at every output sample', async () => {
	const source = provider((index) => index / 16000);
	const nested = { ...createMotionLayer({ id: 'nested', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } }), sourceStart: r(1), timeScale: r(-1) };
	const mixer = createMotionAudioMixer({ project: { ...project, compositions: [{ ...base.compositions[0]!, layers: [nested] }, { ...project.compositions[0]!, id: 'child', audio: [{ ...placement, gain: motionScalar(0.5) }] }] }, provider: source.value });
	const block = await mixer.mixBlock(request);
	for (let index = 0; index < 16; index++) assert.ok(Math.abs(block.interleaved[index]! - (7900 - index) / 32000) < 1e-6); mixer.dispose();
	const remap = { ...nested, timeRemap: { ...motionScalar(0), curve: { anchors: [{ position: r(0), value: 1 }, { position: r(30), value: 0 }], segments: [{ kind: 'linear' as const }] } } };
	const mapped = createMotionAudioMixer({ project: { ...project, compositions: [{ ...base.compositions[0]!, layers: [remap] }, { ...project.compositions[0]!, id: 'child', audio: [{ ...placement, gain: motionScalar(0.5) }] }] }, provider: source.value });
	const result = await mapped.mixBlock(request); assert.deepEqual(result.interleaved, block.interleaved); mapped.dispose();
});

test('M05 source-rate conversion rejects aliased high-frequency energy while preserving passband amplitude', async () => {
	const high = provider((index) => Math.sin(2 * Math.PI * index * 12000 / 48000), 48000);
	const highMixer = createMotionAudioMixer({ project: { ...project, assets: [{ ...asset, sampleRate: 48000 }] }, provider: high.value });
	const block = await highMixer.mixBlock({ ...request, startSample: 1000, sampleCount: 256 });
	assert.ok(Math.max(...block.interleaved.map(Math.abs)) < 0.002); highMixer.dispose();
	const low = provider((index) => Math.sin(2 * Math.PI * index * 1000 / 48000), 48000);
	const lowMixer = createMotionAudioMixer({ project: { ...project, assets: [{ ...asset, sampleRate: 48000 }] }, provider: low.value });
	const pass = await lowMixer.mixBlock({ ...request, startSample: 1000, sampleCount: 256 });
	assert.ok(Math.max(...pass.interleaved.map(Math.abs)) > 0.98); lowMixer.dispose();
});

test('M05 source reads and cache stay bounded across long seeks, source boundaries produce silence', async () => {
	const source = provider(() => 0.25); const mixer = createMotionAudioMixer({ project, provider: source.value, maximumCacheBytes: 32768 });
	for (const startSample of [0, 3000, 6000, 9000, 12000]) { await mixer.mixBlock({ ...request, startSample }); assert.ok(mixer.snapshot().cacheBytes <= 32768); }
	assert.equal(source.peak(), 1); assert.ok(source.reads.every(([start, count]) => start >= 0 && count <= 4096));
	const boundary = await mixer.mixBlock({ ...request, startSample: -2, sampleCount: 4 }); assert.deepEqual([...boundary.interleaved], [0, 0, 0.25, 0.25]);
	const outside = await mixer.mixBlock({ ...request, startSample: 16000 }); assert.ok(outside.interleaved.every((value) => value === 0)); mixer.dispose();
});

test('M05 mixing cancellation and concurrent-request admission release the sole read slot for retry', async () => {
	const source = provider(() => 0.25); let started!: () => void; const loading = new Promise<void>((resolve) => { started = resolve; }); let first = true;
	const mixer = createMotionAudioMixer({ project, provider: { ...source.value, read: async (read, signal) => {
		if (!first) return source.value.read(read, signal); first = false; started();
		return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
	} } });
	const cancellation = new AbortController(); const pending = mixer.mixBlock(request, cancellation.signal); await loading;
	await assert.rejects(mixer.mixBlock(request), /in flight/iu); cancellation.abort(); await assert.rejects(pending, { name: 'AbortError' });
	assert.ok((await mixer.mixBlock(request)).interleaved.every((value) => value === 0.25)); mixer.dispose();
	await assert.rejects(mixer.mixBlock(request), /disposed|Abort/iu);
});

test('M05 splitting output blocks preserves exact PCM at native-window boundaries and animated gain', async () => {
	const source = provider((index, channel) => Math.sin(index / 17) * (channel === 0 ? 0.5 : 0.25), 8000, 2);
	const gain = { ...motionScalar(0), curve: { anchors: [{ position: r(0), value: 0 }, { position: r(30), value: 1 }], segments: [{ kind: 'linear' as const }] } };
	const mixer = createMotionAudioMixer({ project: { ...project, assets: [{ ...asset, channels: 2 }], compositions: [{ ...project.compositions[0]!, audio: [{ ...placement, gain }, { ...placement, id: 'quiet', gain: motionScalar(0.25) }] }] }, provider: source.value });
	const whole = await mixer.mixBlock({ ...request, startSample: r(4095, 2), sampleCount: 64 });
	const first = await mixer.mixBlock({ ...request, startSample: r(4095, 2), sampleCount: 31 });
	const second = await mixer.mixBlock({ ...request, startSample: r(4157, 2), sampleCount: 33 });
	assert.deepEqual([...first.interleaved, ...second.interleaved], [...whole.interleaved]);
	assert.ok(whole.interleaved.some((value) => Math.abs(value) > 0.05)); mixer.dispose();
});

test('M05 audio workload and source-rate limits fail before allocating native PCM windows', async () => {
	const source = provider(() => 1);
	const workload = createMotionAudioMixer({ project, provider: source.value, maximumEvaluatedOccurrences: 3 });
	await assert.rejects(workload.mixBlock(request), /evaluation work budget/iu); assert.equal(source.reads.length, 0); workload.dispose();
	const fast = createMotionAudioMixer({ project: { ...project, compositions: [{ ...project.compositions[0]!, audio: [{ ...placement, timeScale: r(33) }] }] }, provider: source.value });
	await assert.rejects(fast.mixBlock(request), /32:1 resampling budget/iu); assert.equal(source.reads.length, 0); fast.dispose();
});
