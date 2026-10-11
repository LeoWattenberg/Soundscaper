/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionCompositionLinkAudioSource } from '../src/common/editor/motion-link-audio-rendering.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import type { MotionAudioSampleProvider } from '../src/common/editor/motion-audio-contract.ts';
const r = (num: number, den = 1) => ({ num, den });
function fixture(revision = 1) {
	const base = createMotionscaperProject({ id: 'audio-link', title: 'Linked Audio', compositionId: 'main', sampleRate: 8000, durationFrames: 30 });
	const asset = { id: 'sound', kind: 'audio' as const, name: 'Sound', byteLength: 1, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'audio/wav', sampleRate: 8000, channels: 1, duration: r(2) };
	const nested = { ...createMotionLayer({ id: 'nested', name: 'Reverse', durationFrames: 30, content: { kind: 'precomp', compositionId: 'child' } }), sourceStart: r(1), timeScale: r(-1) };
	const placement = { id: 'audio', assetId: 'sound', startFrame: r(0), inFrame: r(0), outFrame: r(60), sourceStart: r(0), timeScale: r(1), enabled: true, gain: motionScalar(0.5) };
	return createMotionCompositionOffer('main', createMotionscaperRevision({ ...base, revision, assets: [asset], compositions: [{ ...base.compositions[0]!, layers: [nested] }, { ...base.compositions[0]!, id: 'child', durationFrames: 60, audio: [placement] }] }));
}
function provider(): MotionAudioSampleProvider { return { describe: () => Promise.resolve({ sampleRate: 8000, channels: 1, sampleCount: 16000 }), read: ({ startSample, sampleCount }, signal) => { signal?.throwIfAborted(); return Promise.resolve(Float32Array.from({ length: sampleCount }, (_, index) => (startSample + index) / 16000)); } }; }
test('M10 linked PCM source pins revision and exact fractional source-time windows through nested reverse and channel mapping', async () => {
	const offer = fixture(7); let acquired = 0, released = 0;
	const source = createMotionCompositionLinkAudioSource(offer, { acquire: async saved => { acquired++; assert.equal(saved.revision.digest, offer.revision.digest); return { provider: provider(), async release() { released++; } }; } });
	assert.equal(source.nativeSampleRate, 8000); assert.deepEqual(source.duration, r(1)); assert.equal(acquired, 0);
	const request = { sourceTime: r(201, 16000), sampleRate: 8000, sampleCount: 32, channels: 2 as const };
	const whole = await source.read(request); assert.equal(whole.identity.revisionDigest, offer.revision.digest); assert.deepEqual(whole.sourceTime, request.sourceTime);
	for (let index = 0; index < 32; index++) { assert.ok(Math.abs(whole.interleaved[index * 2]! - (7899.5 - index) / 32000) < 1e-6); assert.equal(whole.interleaved[index * 2], whole.interleaved[index * 2 + 1]); }
	const tail = await source.read({ ...request, sourceTime: r(233, 16000), sampleCount: 16 }); const head = await source.read({ ...request, sampleCount: 16 }); assert.deepEqual([...head.interleaved, ...tail.interleaved], [...whole.interleaved]);
	const next = createMotionCompositionLinkAudioSource(fixture(8), { acquire: async () => ({ provider: provider(), async release() {} }) }); assert.notEqual(next.identity.revisionDigest, source.identity.revisionDigest); assert.equal((await source.read(request)).identity.revisionDigest, offer.revision.digest);
	assert.equal(acquired, 1); await source.dispose(); await source.dispose(); await next.dispose(); assert.equal(released, 1);
});
test('M10 linked audio windows expose boundary silence and bounded native cache without whole-composition decoding', async () => {
	let reads = 0, largest = 0; const native = provider();
	const source = createMotionCompositionLinkAudioSource(fixture(), { maximumCacheBytes: 32768, acquire: async () => ({ provider: { ...native, async read(request, signal) { reads++; largest = Math.max(largest, request.sampleCount); return native.read(request, signal); } }, async release() {} }) });
	const before = await source.read({ sourceTime: r(-1, 8000), sampleRate: 8000, sampleCount: 3, channels: 1 }); assert.equal(before.interleaved[0], 0); assert.ok(before.interleaved[1]! > 0);
	const end = await source.read({ sourceTime: r(7999, 8000), sampleRate: 8000, sampleCount: 3, channels: 1 }); assert.ok(end.interleaved[0]! > 0); assert.deepEqual([...end.interleaved.slice(1)], [0, 0]);
	for (const time of [r(3, 4), r(1, 4), r(1, 2), r(1, 8)]) { await source.read({ sourceTime: time, sampleRate: 16000, sampleCount: 16, channels: 1 }); assert.ok(source.snapshot().cacheBytes <= 32768); }
	assert.ok(reads > 0); assert.ok(largest <= 4096); await source.dispose();
});
test('M10 malformed linked PCM windows refuse before lease acquisition and disposal cancels the sole in-flight read', async () => {
	let acquired = 0, released = 0, begin!: () => void; const started = new Promise<void>(resolve => { begin = resolve; });
	const source = createMotionCompositionLinkAudioSource(fixture(), { acquire: async () => { acquired++; return { provider: { ...provider(), async read(_request, signal) { begin(); return new Promise<Float32Array>((_resolve, reject) => { signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); }); } }, async release() { released++; } }; } });
	const request = { sourceTime: 0, sampleRate: 8000, sampleCount: 8, channels: 1 as const };
	await assert.rejects(source.read({ ...request, sampleCount: 4097 }), /sample count/iu); await assert.rejects(source.read({ ...request, channels: 3 as 1 }), /layout/iu); assert.equal(acquired, 0);
	const pending = source.read(request); await started; await assert.rejects(source.read(request), /in flight/iu); const rejected = assert.rejects(pending, { name: 'AbortError' }); await source.dispose(); await rejected; assert.equal(released, 1); await assert.rejects(source.read(request), /disposed/iu);
});
test('M10 a cancelled linked lease acquisition releases its closure and permits a later exact retry', async () => {
	const cancellation = new AbortController(); let released = 0, acquired = 0;
	const source = createMotionCompositionLinkAudioSource(fixture(), { acquire: async () => { if (acquired++ === 0) cancellation.abort(); return { provider: provider(), async release() { released++; } }; } });
	const request = { sourceTime: r(1, 2), sampleRate: 8000, sampleCount: 2, channels: 1 as const };
	await assert.rejects(source.read(request, cancellation.signal), { name: 'AbortError' }); assert.equal(released, 1);
	assert.ok((await source.read(request)).interleaved[0]! > 0); await source.dispose(); assert.equal(released, 2);
});

test('M10 linked audio renders retained digest-verified native PCM after receiver storage closes and reopens', async () => {
	const [{ motionWavFixture }, { prepareMotionMedia }, { createMotionMediaProvider }, { openFramescaperCompositionLinkRepository }, { createInstrumentedIndexedDB }] = await Promise.all([
		import('./helpers/motion-media-fixture.ts'), import('../src/common/editor/motion-media-import.ts'), import('../src/common/editor/motion-media-provider.ts'),
		import('../src/framescaper/editor-composition-link-repository.ts'), import('./helpers/instrumented-indexeddb.js'),
	]);
	const bytes = motionWavFixture(2); const { asset } = await prepareMotionMedia(new Blob([bytes]), { id: 'retained-audio', name: 'Stereo.wav' });
	const base = createMotionscaperProject({ id: 'retained-project', title: 'Retained', compositionId: 'main', sampleRate: 48000, durationFrames: 30 });
	const placement = { id: 'sound', assetId: asset.id, startFrame: r(0), inFrame: r(0), outFrame: r(30), sourceStart: r(1000, 48000), timeScale: r(1), enabled: true, gain: motionScalar(0.5) };
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision({ ...base, assets: [asset], compositions: [{ ...base.compositions[0]!, audio: [placement] }] }));
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory; const store = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	await store.receive('frame', 'linked-audio', offer, { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() }) }); await store.close();
	const reopened = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' }); let source: ReturnType<typeof createMotionCompositionLinkAudioSource> | null = null;
	try {
		const state = await reopened.load('frame', 'linked-audio'); assert.ok(state);
		source = createMotionCompositionLinkAudioSource(state.accepted, { acquire: async () => {
			const provider = createMotionMediaProvider({ loadAsset: async asset => { const retained = await reopened.readAsset(asset); if (!retained) throw new Error('Retained audio missing.'); return new Uint8Array(await new Response(retained.stream()).arrayBuffer()); } });
			return { provider, async release() { provider.dispose(); } };
		} });
		const block = await source.read({ sourceTime: r(1030, 48000), sampleRate: 48000, sampleCount: 64, channels: 2 });
		for (let index = 0; index < 64; index++) { const expected = ((2030 + index) % 127 - 63) / 256; assert.equal(block.interleaved[index * 2], expected || 0); assert.equal(block.interleaved[index * 2 + 1], -expected || 0); }
		assert.equal(block.identity.revisionDigest, offer.revision.digest);
	} finally { await source?.dispose(); await reopened.close(); }
});
