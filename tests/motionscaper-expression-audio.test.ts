/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionSceneEvaluator } from '../src/common/editor/motion-composition-evaluation.ts';
import { createMotionExpressionAudioPreparation } from '../src/common/editor/motion-expression-audio-preparation.ts';
import type { MotionAudioSampleProvider } from '../src/common/editor/motion-audio-contract.ts';
import { motionVector } from '../src/common/editor/motion-property.ts';
import { prepareMotionMedia } from '../src/common/editor/motion-media-import.ts';
import { createMotionMediaProvider } from '../src/common/editor/motion-media-provider.ts';
import { motionWavFixture } from './helpers/motion-media-fixture.ts';
const r = (num: number, den = 1) => ({ num, den });
function fixture(source = '[audioAmplitude("sound", time, 0.25), 0, 0]', channels: 1 | 2 = 1) {
	const project = createMotionscaperProject({ id: 'amplitude', title: 'Amplitude', compositionId: 'main' });
	const layer = createMotionLayer({ id: 'visual', name: 'Visual', durationFrames: 300, content: { kind: 'null' } });
	const sha256 = 'a'.repeat(64); const asset = { kind: 'audio', id: 'sound', name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 16000, mimeType: 'audio/wav', sampleRate: 8000, channels, duration: r(1) };
	return createMotionscaperRevision({ ...project, assets: [asset], compositions: [{ ...project.compositions[0], layers: [{ ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { source, enabled: true, references: [] } } } }] }] });
}
function provider(channels: 1 | 2 = 1) {
	const reads: { start: number; count: number }[] = []; const result: MotionAudioSampleProvider = {
		async describe() { return { sampleRate: 8000, sampleCount: 8000, channels }; },
		async read({ startSample, sampleCount }) { reads.push({ start: startSample, count: sampleCount }); return Float32Array.from({ length: sampleCount * channels }, (_, index) => channels === 2 && index % 2 ? -1 : 1); },
	}; return { result, reads };
}

test('M08 prepared amplitude uses native PCM RMS with source-edge silence and deterministic cached seeking', async () => {
	const revision = fixture(); const pcm = provider(); const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: pcm.result });
	const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
	const at = (time: number) => preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(time * 4, 4) }, options));
	assert.ok(Math.abs((await at(0)).layers[0]!.state.transform.position[0] - Math.SQRT1_2) < 1e-12);
	assert.equal((await at(0.5)).layers[0]!.state.transform.position[0], 1); const before = pcm.reads.length;
	assert.equal((await at(0.5)).layers[0]!.state.transform.position[0], 1); assert.equal(pcm.reads.length, before);
	assert.ok(pcm.reads.every(({ count }) => count <= 4096)); assert.equal(preparation.revision.digest, revision.digest); preparation.dispose();
});

test('M08 fractional native sample windows and stereo mean-square channels retain exact amplitude semantics', async () => {
	const revision = fixture('[audioAmplitude("sound", 0.0000625, 0.000125), audioAmplitude("sound", 0, 0.000125), 0]', 2); const pcm = provider(2);
	const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: pcm.result }); const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
	const frame = await preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options));
	assert.deepEqual(frame.layers[0]!.state.transform.position, [1, Math.SQRT1_2, 0]); assert.ok(pcm.reads.every(({ count }) => count === 1)); preparation.dispose();
});

test('M08 dependent amplitude samples replay against immutable prepared windows and stay bounded', async () => {
	const revision = fixture('[audioAmplitude("sound", audioAmplitude("sound", 0.25, 0.01), 0.01), 0, 0]'); const pcm = provider();
	const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: pcm.result }); const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
	const frame = await preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options));
	assert.ok(Math.abs(frame.layers[0]!.state.transform.position[0] - Math.SQRT1_2) < 1e-12); assert.equal(pcm.reads.length, 2);
	const limited = createMotionExpressionAudioPreparation({ project: revision.project, provider: pcm.result, maximumRequests: 1 });
	await assert.rejects(limited.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options)), /budget/iu); limited.dispose(); preparation.dispose();
});

test('M08 amplitude readers refuse stale revisions, forged capabilities and excess native work before reads', async () => {
	const revision = fixture(); const pcm = provider(); const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: pcm.result, maximumNativeSamples: 100 });
	const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
	assert.throws(() => evaluator.evaluate({ compositionId: 'main', time: r(0) }, { preparedAudio: { revisionDigest: revision.digest, settingsDigest: 'b'.repeat(64) } }), /capability|prepared/iu);
	await assert.rejects(preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(1, 2) }, options)), /budget/iu); assert.equal(pcm.reads.length, 0);
	const changed = createMotionscaperRevision({ ...revision.project, revision: revision.revision + 1 }); const stale = createMotionSceneEvaluator(changed.project, { revisionDigest: changed.digest });
	await assert.rejects(preparation.evaluate((options) => stale.evaluate({ compositionId: 'main', time: r(0) }, options)), /revision/iu); assert.equal(pcm.reads.length, 0); preparation.dispose();
});

test('M08 amplitude cancellation releases the sole preparation slot and evicts bounded cached windows', async () => {
	const revision = fixture(); const pcm = provider(); const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: pcm.result, maximumCacheEntries: 2 });
	const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest }); const controller = new AbortController(); controller.abort();
	await assert.rejects(preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options), controller.signal), { name: 'AbortError' });
	for (let frame = 0; frame < 8; frame++) await preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(frame, 8) }, options));
	assert.equal(preparation.snapshot().cacheEntries, 2); assert.equal(preparation.snapshot().inFlight, false); assert.ok(preparation.snapshot().cacheBytes <= 1024 * 1024); preparation.dispose();
	await assert.rejects(preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options)), /disposed/iu);
});


test('M08 retained WAV decoding produces the same audio-driven value as direct native PCM energy', async () => {
	const bytes = motionWavFixture(2); const imported = await prepareMotionMedia(new Blob([bytes]), { id: 'sound', name: 'Stereo.wav' });
	const source = fixture('[audioAmplitude("sound", 0.04, 0.02), 0, 0]'); const revision = createMotionscaperRevision({ ...source.project, assets: [imported.asset] });
	const media = createMotionMediaProvider({ loadAsset: () => Promise.resolve(bytes) }); const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: media });
	try {
		const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
		const frame = await preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(1) }, options));
		let energy = 0; for (let index = 1440; index < 2400; index++) energy += ((index % 127 - 63) / 128) ** 2;
		assert.equal(frame.layers[0]!.state.transform.position[0], Math.sqrt(energy / 960));
	} finally { preparation.dispose(); media.dispose(); }
});

test('M08 in-flight amplitude cancellation preserves sole-read admission and permits a later retry', async () => {
	const revision = fixture(); let started!: () => void; const began = new Promise<void>((resolve) => { started = resolve; }); let wait = true;
	const pcm = provider(); const blocking: MotionAudioSampleProvider = { ...pcm.result, read(request, signal) {
		if (!wait) return pcm.result.read(request, signal); started();
		return new Promise<Float32Array>((_resolve, reject) => { signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); });
	} };
	const preparation = createMotionExpressionAudioPreparation({ project: revision.project, provider: blocking }); const evaluator = createMotionSceneEvaluator(revision.project, { revisionDigest: revision.digest });
	const controller = new AbortController(); const read = () => preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options), controller.signal);
	const pending = read(); await began; await assert.rejects(read(), /in flight/iu); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(preparation.snapshot().inFlight, false); assert.equal(preparation.snapshot().cacheEntries, 0); wait = false;
	await preparation.evaluate((options) => evaluator.evaluate({ compositionId: 'main', time: r(0) }, options)); preparation.dispose();
});
