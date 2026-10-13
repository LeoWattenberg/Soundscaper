/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../src/common/editor/imaging/image-develop-frame-core.ts';
import type { FramescaperImageDevelopAuthoringSessionCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import type { ImageBrushMaskDraftFrameRequestV1, WithImageBrushMaskDraftFrameV1 } from '../src/common/editor/image-brush-mask-resource-port-v1.ts';
import { prepareFramescaperImageDevelopSourceCurrentV1 } from '../src/framescaper/timeline-image-develop-authoring-current-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { PROFILE, LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
type Draft = <Result>(request: { develop: ImageDevelopStateCurrentV1; reference: unknown; bytes: Uint8Array; maskOverlay?: { maskId: string; effectId: string } }, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>) => Promise<Result>;
const SELECTION = Object.freeze({ maskId: 'paint', effectId: 'invert' });
function invert() { return createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }); }
function develop(base: Readonly<ImageDevelopStateCurrentV1>, key: string) {
	return normalizeImageDevelopStateCurrentV1({ ...base, effects: [invert()], masks: [{ schemaVersion: 2, id: 'paint', name: 'Local painted draft', kind: 'matte',
		inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: key }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [SELECTION] });
}
function snapshot(view: Readonly<ImageDevelopFrameViewV1>) { return { width: view.frame.descriptor.width, height: view.frame.descriptor.height, pixels: [...view.frame.pixels], ...(view.maskOverlay ? { coverage: [...view.maskOverlay.coverage] } : {}) }; }
function render(session: FramescaperImageDevelopAuthoringSessionCurrentV1) { const value = (session as typeof session & { withBrushDraftFrame?: WithImageBrushMaskDraftFrameV1 }).withBrushDraftFrame; assert.ok(value); return value; }
function observed<Value>(promise: Promise<Value>) { return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function deferred<Value>() { let resolve!: (value: Value | PromiseLike<Value>) => void; const promise = new Promise<Value>(yes => { resolve = yes; }); return { promise, resolve }; }
async function pending(promise: Promise<unknown>) { let settled = false; void promise.then(() => { settled = true; }, () => { settled = true; }); await new Promise<void>(resolve => setImmediate(resolve)); return !settled; }
function fixture(cube = false) {
	const f = editableImageFixture({ crop: false, ...(cube ? { cube: false } : {}) }), bodies = new Map([[f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)])], ...(cube ? [[LUT.storageKey, new Blob([LUT_BODY])] as const] : [])]);
	const calls: string[] = [], commands: unknown[] = [], controller = { project: f.project(), getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }), actions: { edit: { commit(command: unknown) { commands.push(command); controller.project = applyFramescaperProjectCommand(PROFILE, controller.project, command); } } } };
	const hooks: { beforeLoad?: (key: string) => Promise<void> } = {};
	const store = { async loadMediaAsset(key: string) { calls.push(key); await hooks.beforeLoad?.(key); return bodies.get(key) ?? null; } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store });
	return { ...f, bodies, calls, commands, controller, hooks, open: () => framescaperImageDevelopAuthoringForCurrentV1(controller)!.open() };
}

test('actual selected Frame Session renders an authentic uninstalled brush without native body publication', async () => {
	const f = editableImageFixture({ crop: false }), controller = { project: f.project(), getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }),
		actions: { edit: { commit: () => assert.fail('Temporary brush draft cannot publish a recipe.') } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: f.store }); const session = await framescaperImageDevelopAuthoringForCurrentV1(controller)!.open();
	try {
		const native = session as typeof session & { withBrushDraftFrame?: Draft }; assert.ok(native.withBrushDraftFrame, 'The actual Frame Session must lend an uninstalled brush draft.');
		const before = structuredClone(controller.project);
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			const develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, effects: [createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })],
				masks: [{ schemaVersion: 1, id: 'paint', kind: 'matte', inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: body.reference.storageKey }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [{ maskId: 'paint', effectId: 'invert' }] });
			const actual = await native.withBrushDraftFrame!({ develop, reference: body.reference, bytes: body.bytes, maskOverlay: { maskId: 'paint', effectId: 'invert' } }, view => ({ pixels: [...view.frame.pixels], coverage: [...view.maskOverlay!.coverage] }));
			assert.deepEqual(actual, { pixels: [255, 0, 0, 255, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255], coverage: [0, 255, 0, 255] });
		});
		assert.deepEqual(controller.project, before); assert.deepEqual(f.calls, [f.source.storageKey]);
	} finally { await session.closeAndJoin(); }
});

test('temporary brush captures mutable body, reference, recipe graph and exact selection before the first yield', async () => {
	const f = fixture(), session = await f.open();
	try {
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			const mutableDevelop = structuredClone(develop(session.develop, body.reference.storageKey)), reference = { ...body.reference }, bytes = body.bytes.slice(), selection: { maskId: string; effectId: string } = { ...SELECTION };
			const request: { develop: ImageDevelopStateCurrentV1; reference: typeof reference; bytes: Uint8Array<ArrayBuffer>; maskOverlay: typeof selection } = { develop: mutableDevelop, reference, bytes, maskOverlay: selection };
			const work = render(session)(request, snapshot);
			bytes.fill(0); reference.sha256 = '0'.repeat(64); Object.assign(mutableDevelop.masks[0]!.inputs[0]!, { sourceRef: 'changed' });
			selection.maskId = 'changed'; selection.effectId = 'changed'; request.develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, effects: [], masks: [], maskBindings: [] }); request.maskOverlay = { maskId: 'replacement', effectId: 'replacement' };
			assert.deepEqual(await work, { width: 2, height: 2, pixels: [255, 0, 0, 255, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255], coverage: [0, 255, 0, 255] });
		}); assert.equal(f.commands.length, 0); assert.deepEqual(f.calls, [f.source.storageKey]);
	} finally { await session.closeAndJoin(); }
});

test('temporary alpha samples repaired effect input and travels through actual suffix geometry with literal full output', async () => {
	const f = fixture(), session = await f.open(), before = structuredClone(f.controller.project), pack = f.pack.bytes.slice();
	try {
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			const repaired = replaceImageDevelopRepairSpotsV1(develop(session.develop, body.reference.storageKey), { schemaVersion: 1, spots: [{ id: 'repair', mode: 'clone', enabled: true,
				target: { x: .75, y: .25 }, source: { x: .25, y: .25 }, radius: .1, feather: 0, opacity: 1 }] });
			const draft = normalizeImageDevelopStateCurrentV1({ ...repaired, effects: [invert(), createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })] });
			assert.deepEqual(await render(session)({ develop: draft, reference: body.reference, bytes: body.bytes, maskOverlay: SELECTION }, snapshot),
				{ width: 2, height: 2, pixels: [0, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255], coverage: [255, 0, 255, 0] });
		}); assert.deepEqual(f.controller.project, before); assert.deepEqual(f.pack.bytes, pack); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('body header/hash, selected declaration and overlay binding refuse before acquiring Original', async () => {
	const f = fixture(), session = await f.open();
	try {
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			for (const corruption of ['header', 'hash'] as const) { const bytes = body.bytes.slice(); bytes[corruption === 'header' ? 0 : 16] = 91;
				await assert.rejects(render(session)({ develop: develop(session.develop, body.reference.storageKey), reference: body.reference, bytes }, () => assert.fail()), /header|SHA256/u); }
			await assert.rejects(render(session)({ develop: session.develop, reference: body.reference, bytes: body.bytes }, () => assert.fail()), /not declared/u);
			await assert.rejects(render(session)({ develop: develop(session.develop, body.reference.storageKey), reference: body.reference, bytes: body.bytes, maskOverlay: { ...SELECTION, effectId: 'absent' } }, () => assert.fail()), /binding/u);
		}); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('temporary replacement cannot conceal a corrupt same-key retained native brush or disabled LUT', async () => {
	for (const corrupt of ['brush', 'lut'] as const) {
		const f = fixture(true); let session: FramescaperImageDevelopAuthoringSessionCurrentV1 | undefined;
		try {
			await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
				f.bodies.set(body.reference.storageKey, new Blob([new Uint8Array(body.bytes)]));
				const base = f.source.develop, saved = normalizeImageDevelopStateCurrentV1({ ...base, masks: develop(base, body.reference.storageKey).masks });
				f.controller.project = applyFramescaperProjectCommand(PROFILE, f.controller.project, prepareFramescaperImageDevelopSourceCurrentV1(f.controller.project, f.clip.id, saved));
				session = await f.open(); f.calls.splice(0);
				const key = corrupt === 'brush' ? body.reference.storageKey : LUT.storageKey; f.bodies.set(key, new Blob([new Uint8Array(corrupt === 'brush' ? body.reference.byteLength : LUT.byteLength)]));
				await assert.rejects(render(session)({ develop: develop(session.develop, body.reference.storageKey), reference: body.reference, bytes: body.bytes, maskOverlay: SELECTION }, () => assert.fail()));
				assert.ok(f.calls.includes(key)); assert.ok(!f.calls.includes(f.source.storageKey)); assert.equal(f.commands.length, 0);
			});
		} finally { await session?.closeAndJoin(); }
	}
});

test('ordinary installed-only draft remains strict and refuses temporary body fields and absent native resources', async () => {
	const f = fixture(), session = await f.open();
	try {
		await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(255) }, async body => {
			const request = { develop: develop(session.develop, body.reference.storageKey), reference: body.reference, bytes: body.bytes };
			await assert.rejects(Reflect.apply(session.withDraftFrame!, session, [request, () => assert.fail()]) as Promise<unknown>, /unsupported|unknown|field/iu);
			await assert.rejects(session.withDraftFrame!({ develop: request.develop }, () => assert.fail()), /missing|stale/iu);
		}); assert.ok(!f.calls.includes(f.source.storageKey)); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('Close joins held temporary rendered planes, blocks overlapping work/Apply, then retires pixels and coverage', async () => {
	const f = fixture(), session = await f.open(), entered = deferred<void>(), release = deferred<void>(); let closing: Promise<void> | undefined;
	try {
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			let pixels: Uint8Array | undefined, coverage: Uint8Array | undefined; const request = { develop: develop(session.develop, body.reference.storageKey), reference: body.reference, bytes: body.bytes, maskOverlay: SELECTION };
			const work = observed(render(session)(request, async view => { pixels = view.frame.pixels; coverage = view.maskOverlay!.coverage; entered.resolve(); await release.promise; }));
			assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
			assert.throws(() => session.apply(request.develop), /join before Apply/u); await assert.rejects(session.withOriginalFrame(() => undefined), /already pending/u); await assert.rejects(render(session)(request, () => undefined), /already pending/u);
			closing = session.closeAndJoin(); assert.equal(await pending(closing), true); assert.equal(videoPreviewAuthoringPausedV1(f.controller), true); assert.deepEqual([...coverage!], [0, 255, 0, 255]);
			release.resolve(); assert.equal((await work).ok, false); await closing; assert.ok(pixels!.every(byte => byte === 0)); assert.ok(coverage!.every(byte => byte === 0)); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false);
		}); assert.equal(f.commands.length, 0);
	} finally { release.resolve(); await closing; await session.closeAndJoin(); }
});

for (const target of ['frame', 'coverage'] as const) test(`temporary brush ${target} physical transfer preserves opaque primary and retirement failure`, async () => {
	const f = fixture(), session = await f.open(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	try {
		await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
			const outcome = await observed(render(session)({ develop: develop(session.develop, body.reference.storageKey), reference: body.reference, bytes: body.bytes, maskOverlay: SELECTION }, view => {
				const backing = target === 'frame' ? view.frame.pixels.buffer : view.maskOverlay!.coverage.buffer; structuredClone(backing, { transfer: [backing] }); throw opaque.proxy;
			})); assert.ok(!outcome.ok); assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.cause, opaque.proxy));
			assert.ok(outcome.error.errors.some((error: unknown) => Object.is(error, opaque.proxy))); assert.ok(outcome.error.errors.some((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof TypeError));
		}); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('hostile request cancellation retains exact opaque reason before native body or Original reads', async () => {
	const f = fixture(), session = await f.open(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let traps = 0;
	try {
		const request = new Proxy({}, { ownKeys() { traps++; stop.abort(opaque.proxy); throw new Error('Hostile brush reflection'); } });
		const outcome = await observed(render(session)(request as ImageBrushMaskDraftFrameRequestV1, () => undefined, { signal: stop.signal }));
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(traps, 1); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});
