/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperVideoExportStrategy } from '../src/framescaper/video-export-strategy.ts';
import type { VideoKeyframeVideoEncoderRequest } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { editableImageFixture, PROFILE, LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';

for (const mode of ['buffer', 'sink'] as const) test(`current editable image ${mode} export encodes actual saved Cube pixels instead of the canonical original`, async () => {
	const f = editableImageFixture({ cube: true, crop: false }), { strategy, request, seen } = exportHarness(f, f.store);
	await encode(strategy, request, mode);
	assert.deepEqual(seen, [Array.from({ length: 4 }, () => [137,0,0,255]).flat()]);
});

for (const mode of ['buffer', 'sink'] as const) test(`current ${mode} export joins a held original read before preserving opaque cancellation`, async () => {
	const f = editableImageFixture({ cube: true }), entered = deferred(), held = deferred(), stop = new AbortController(), reason = Symbol('abort');
	const store = { async loadMediaAsset(key: string) { assert.equal(key, f.source.storageKey); entered.resolve(); await held.promise; return new Blob([new Uint8Array(f.pack.bytes)]); } };
	const { strategy, request, seen } = exportHarness(f, store, stop.signal); let settled = false;
	const pending = encode(strategy, request, mode); void pending.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; stop.abort(reason); await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false);
	held.resolve(); await assert.rejects(pending, error => error === reason); assert.deepEqual(seen, []);
	assert.deepEqual([...f.original], [...new TextEncoder().encode('exact orientation-canonical immutable photo original')]);
});

for (const mode of ['buffer', 'sink'] as const) test(`current ${mode} export authenticates a disabled recipe LUT before encoder publication`, async () => {
	const f = editableImageFixture({ cube: false }), before = structuredClone(f.source), calls: string[] = [];
	const store = { async loadMediaAsset(key: string) { calls.push(key); return new Blob([key === f.source.storageKey ? new Uint8Array(f.pack.bytes) : new Uint8Array(LUT_BODY.byteLength)]); } };
	const { strategy, request } = exportHarness(f, store); await assert.rejects(encode(strategy, request, mode), /digest|SHA|LUT/iu);
	assert.deepEqual(calls, [f.source.storageKey, LUT.storageKey]); assert.deepEqual(f.source, before);
});

function exportHarness(f: ReturnType<typeof editableImageFixture>, store: typeof f.store, signal = new AbortController().signal) {
	const project = f.project(), seen: number[][] = [];
	const produce = async (request: VideoKeyframeVideoEncoderRequest) => { const pixels = new Uint8Array(request.producer.byteLength);
		await request.producer.produce(request.frameSource.frame(0), pixels, { signal: request.signal! }); seen.push([...pixels]); };
	const identity = { byteLength: 3, videoEncoder: 'ffmpeg' as const, codec: 'h264', format: 'mp4' as const, extension: '.mp4', mimeType: 'video/mp4', frameCount: 1, rgbaChunkCount: 1, outputChunkCount: 1 } as const;
	const strategy = createFramescaperVideoExportStrategy(PROFILE, {
		encodeOffline: async () => { throw Error('Unexpected video decoder route'); }, encodeOfflineToSink: async () => { throw Error('Unexpected video decoder route'); },
		encodePicture: async (_owner, request) => { await produce(request); return { ...identity, bytes: Uint8Array.of(1,2,3) }; },
		encodePictureToSink: async (_owner, request, sink) => { await produce(request); await sink.open(3); await sink.write(Uint8Array.of(1,2,3)); return { ...identity, output: await sink.close() }; },
	}, store);
	const canonicalProject = project as unknown as Readonly<Record<string, unknown>>;
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: {}, audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false,
		canvas: { width: 2, height: 2, frameRate: { num: 1, den: 1 }, fit: 'contain', backgroundColor: '#00000000' } }); assert.ok(plan);
	const request = { canonicalProject, exportProject, plan, timingBySourceId: new Map(), timingViewsBySourceId: new Map(), videoBlobs: new Map(), audioMix: null,
		editorFfmpeg: {}, webCodecs: null, signal, assertCurrent() {}, maximumOutputBytes: 1024 };
	return { strategy, request, seen };
}
function encode(strategy: ReturnType<typeof createFramescaperVideoExportStrategy>, request: ReturnType<typeof exportHarness>['request'], mode: 'buffer' | 'sink') {
	return mode === 'buffer' ? strategy.encode(request)
		: strategy.encodeToSink(request, { open: async () => {}, write: async () => {}, close: async () => 'saved', abort: async () => {} });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
