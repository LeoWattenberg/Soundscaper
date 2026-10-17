/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createFramescaperSelectedProjectBinThumbnailTimelineImage, createFramescaperSelectedVisualPreviewSessionTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-preview.ts';
import { createFramescaperSelectedTimelineFilmstripTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-filmstrip.ts';
import { imageGeometryForVideoEffectV1 } from '../src/common/editor/video-image-geometry-v1.ts';
import { planImageGeometryV1 } from '../src/common/editor/imaging/image-geometry-plan-v1.ts';
import { imageDevelopHandoffRecipeSha256V1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { editableImageFixture, PROFILE, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';

for (const cube of [undefined, false, true]) test(`real selected bin and filmstrip evaluate saved natural crop with Cube ${String(cube)}`, async () => {
	const f = editableImageFixture({ cube }), signal = new AbortController().signal;
	const thumbnail = await createFramescaperSelectedProjectBinThumbnailTimelineImage({ profile: PROFILE, project: f.imageProject(true), store: f.store as never,
		clipId: f.clip.id, width: 1, height: 2, signal }); assert.ok(thumbnail);
	assert.deepEqual([...thumbnail.pixels], cube ? [137,0,0,255,137,0,0,255] : [0,255,0,255,255,255,255,255]);
	const frames = await createFramescaperSelectedTimelineFilmstripTimelineImage({ profile: PROFILE, project: f.imageProject(), store: f.store as never,
		width: 2, height: 2, signal, frames: [{ key: 'cell', clipId: f.clip.id, sourceId: f.source.id, timelineSample: 0, sourceUrl: 'owned-source' }] });
	assert.ok(frames); assert.deepEqual([...frames[0]!.pixels], cube ? Array.from({ length: 4 }, () => [137,0,0,255]).flat() : [0,255,0,255,0,255,0,255,255,255,255,255,255,255,255,255]);
	assert.deepEqual([...f.original], [...new TextEncoder().encode('exact orientation-canonical immutable photo original')]);
});

test('selected timeline preview dispatches editable source pictures to the current exact route', async t => {
	const writes = dom(t);
	const f = editableImageFixture({ cube: true });
	const session = await createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: f.imageProject(), store: f.store as never,
		width: 2, height: 2, signal: new AbortController().signal }); assert.ok(session);
	try {
		assert.equal(session.exactPlaying, true); assert.equal(typeof session.renderExact, 'function');
		await session.renderExact!({ timelineSample: 0, signal: new AbortController().signal, mediaLayers: [] });
		// Natural 1×2 crop is contained, then centred in the 2×2 canvas.
		assert.deepEqual(writes.at(-1), [0,0,0,255,137,0,0,255,0,0,0,255,137,0,0,255]);
	}
	finally { if (session.close) await session.close(); else session.dispose(); }
});

function dom(t: TestContext) {
	const descriptors = ['document', 'ImageData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	const writes: number[][] = [];
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
		return { width: 2, height: 2, getContext() { return { clearRect() {}, drawImage() {},
			getImageData() { return { data: new Uint8ClampedArray(16) }; },
			putImageData(image: { data: Uint8ClampedArray }) { writes.push(Array.from(image.data)); } }; } };
	} } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	} });
	t.after(() => { for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	return writes;
}

for (const processVersion of [1, 2] as const) test(`Photo${processVersion} current host retains natural saved crop pixels`, async () => {
	const f = editableImageFixture({ processVersion });
	const thumbnail = await createFramescaperSelectedProjectBinThumbnailTimelineImage({ profile: PROFILE, project: f.imageProject(true), store: f.store as never,
		clipId: f.clip.id, width: 1, height: 2, signal: new AbortController().signal }); assert.ok(thumbnail);
	assert.deepEqual([...thumbnail.pixels], [0,255,0,255,255,255,255,255]);
});

for (const host of ['bin', 'filmstrip', 'timeline'] as const) test(`${host} refuses a tampered disabled recipe LUT before publishing pixels`, async t => {
	if (host === 'timeline') dom(t);
	const f = editableImageFixture({ cube: false }); let calls = 0;
	const store = { async loadMediaAsset(key: string) { calls++;
		return key === f.source.storageKey ? new Blob([new Uint8Array(f.pack.bytes)]) : new Blob([new Uint8Array(LUT_BODY.byteLength)]); } };
	const signal = new AbortController().signal;
	const work = host === 'bin'
		? createFramescaperSelectedProjectBinThumbnailTimelineImage({ profile: PROFILE, project: f.imageProject(true), store: store as never, clipId: f.clip.id, width: 1, height: 2, signal })
		: host === 'filmstrip'
			? createFramescaperSelectedTimelineFilmstripTimelineImage({ profile: PROFILE, project: f.imageProject(), store: store as never, width: 2, height: 2, signal,
				frames: [{ key: 'cell', clipId: f.clip.id, sourceId: f.source.id, timelineSample: 0, sourceUrl: 'owned-source' }] })
			: createFramescaperSelectedVisualPreviewSessionTimelineImage({ profile: PROFILE, project: f.imageProject(), store: store as never, width: 2, height: 2, signal });
	// The exact timeline resource route authenticates its disabled recipe during
	// frame resolve; bin and filmstrip materialize before returning.
	if (host === 'timeline') {
		const session = await work as Awaited<ReturnType<typeof createFramescaperSelectedVisualPreviewSessionTimelineImage>>; assert.ok(session);
		try { await assert.rejects(session.renderExact!({ timelineSample: 0, signal, mediaLayers: [] })); }
		finally { await session.close!(); }
	} else await assert.rejects(work);
	assert.ok(calls >= 2); assert.deepEqual([...f.original], [...new TextEncoder().encode('exact orientation-canonical immutable photo original')]);
});

test('closing current materialization joins an accepted held recipe resource, preserves refusal and rejects later readers', async () => {
	const f = editableImageFixture({ cube: true }), entered = deferred(), held = deferred(), stop = new AbortController(), reason = Symbol('cancel');
	const store = { async loadMediaAsset(key: string) {
		if (key === f.source.storageKey) return new Blob([new Uint8Array(f.pack.bytes)]);
		entered.resolve(); await held.promise; return new Blob([LUT_BODY]);
	} };
	const reader = await openFramescaperCurrentImageFrameSource(store, f.source, stop.signal);
	const work = reader.readFrame(0, stop.signal); let settled = false, closed = false;
	void work.then(() => { settled = true; }, () => { settled = true; });
	await entered.promise; stop.abort(reason); const closing = reader.closeAndJoin().then(() => { closed = true; });
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(settled, false); assert.equal(closed, false);
	held.resolve(); await assert.rejects(work, error => error === reason); await closing;
	await assert.rejects(reader.readFrame(0), /closed/u);
});

test('bound masks, oversized recipe working planes and foreign body accessors refuse before body I/O', async () => {
	const mask = { schemaVersion: 1 as const, id: 'mask', kind: 'mask' as const, inputs: [], nodes: [{ id: 'rectangle', kind: 'vector-shape' as const, shape: 'rectangle' as const, x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'rectangle' };
	const f = editableImageFixture({ cube: false }), develop = { ...f.source.develop, masks: [mask], maskBindings: [{ effectId: 'saved-profile', maskId: 'mask' }] };
	const bound = { ...f.source, develop, provenance: { ...f.source.provenance, developSha256: imageDevelopHandoffRecipeSha256V1(develop) } };
	await assert.rejects(openFramescaperCurrentImageFrameSource(f.store, bound), /bound masks/u); assert.deepEqual(f.calls, []);
	const large = editableImageFixture({ crop: false });
	const shrink = { id: 'later-crop', type: 'develop-geometry-v1', enabled: true, params: { cropWidth: .5 } };
	const expanded = { ...large.source.develop, effects: [shrink], geometry: { ...large.source.develop.geometry, rotationDegrees: 30 } };
	const rotated = planImageGeometryV1({ schemaVersion: 1, ...expanded.geometry, perspective: null }, 4_096, 4_096);
	const dimensions = planImageGeometryV1(imageGeometryForVideoEffectV1(shrink, rotated.width, rotated.height), rotated.width, rotated.height);
	await assert.rejects(openFramescaperCurrentImageFrameSource(large.store, { ...large.source, canonical: { ...large.source.canonical, width: 4_096, height: 4_096 },
		develop: expanded, developed: { width: dimensions.width, height: dimensions.height }, provenance: { ...large.source.provenance, developSha256: imageDevelopHandoffRecipeSha256V1(expanded) } }), /working byte/u);
	assert.deepEqual(large.calls, []); let getters = 0;
	const store = { get loadMediaAsset() { getters++; throw Error('Foreign authority'); } };
	await assert.rejects(openFramescaperCurrentImageFrameSource(store as never, f.source), /data body reader/u); assert.equal(getters, 0);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
