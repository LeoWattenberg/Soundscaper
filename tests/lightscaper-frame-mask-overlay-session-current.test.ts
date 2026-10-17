/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../src/common/editor/imaging/image-develop-frame-core.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { editableImageFixture, CORNERS, PROFILE, LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type DraftFrame = <Result>(request: Readonly<{ develop: ImageDevelopStateCurrentV1; maskOverlay?: Readonly<{ maskId: string; effectId: string }> }>,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<Result>;
type Session = Awaited<ReturnType<NonNullable<ReturnType<typeof framescaperImageDevelopAuthoringForCurrentV1>>['open']>>;
function draft(session: Session): DraftFrame {
	const native = session as Session & { withDraftFrame?: DraftFrame };
	assert.equal(typeof native.withDraftFrame, 'function', 'A selected Frame Session must lend its real rendered local draft.'); return native.withDraftFrame!;
}
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function invert(id = 'invert') { return createVideoEffect('point-curves-v1', { id, params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }); }
function range(develop: ImageDevelopStateCurrentV1) {
	return normalizeImageDevelopStateCurrentV1({ ...develop, effects: [invert()], masks: [{ schemaVersion: 1, id: 'range', kind: 'matte', inputs: [],
		nodes: [{ id: 'luma', kind: 'luminance-range', lower: 0.7, upper: 1, falloff: 0 }], outputNodeId: 'luma' }], maskBindings: [{ maskId: 'range', effectId: 'invert' }] });
}
const SELECTION = Object.freeze({ maskId: 'range', effectId: 'invert' });
/** Actual model project commands/native Blob bodies. This fixture does not
 * claim native image ingestion or an image-codec golden. */
function fixture(options: Readonly<{ cube?: boolean; processVersion?: 1 | 2 }> = {}) {
	const f = editableImageFixture({ ...options, crop: false }), commands: FramescaperImageSourceSetCommandTimelineImage[] = [];
	const selected = { selectedClipId: f.clip.id, readOnly: false }, bodies = new Map<string, Blob>(), calls: string[] = [];
	const hooks = { beforeLoad: async (_key: string): Promise<void> => undefined }, native = f.store.loadMediaAsset;
	const store = { async loadMediaAsset(key: string) {
		assert.equal(this, store); calls.push(key); await hooks.beforeLoad(key);
		const body = bodies.get(key); return body ?? Reflect.apply(native, f.store, [key]) as ReturnType<typeof native>;
	} };
	const controller = { project: f.project(), getSnapshot: () => selected,
		actions: { edit: { commit(command: FramescaperImageSourceSetCommandTimelineImage) {
			commands.push(command); controller.project = applyFramescaperProjectCommand(PROFILE, controller.project, command);
		} } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store });
	return { ...f, controller, selected, commands, bodies, calls, hooks, port: framescaperImageDevelopAuthoringForCurrentV1(controller)!,
		async brush(alpha: readonly number[]) { return withPreparedBrushMaskResourceV1({ width: alpha.length, height: 1, alpha: Uint8Array.from(alpha) }, body => {
			const bytes = body.bytes.slice(); bodies.set(body.reference.storageKey, new Blob([bytes])); return { reference: body.reference, bytes };
		}); },
	};
}
function snapshot(view: Readonly<ImageDevelopFrameViewV1>) {
	return { width: view.frame.descriptor.width, height: view.frame.descriptor.height, pixels: [...view.frame.pixels],
		...(view.maskOverlay ? { coverage: [...view.maskOverlay.coverage] } : {}) };
}

test('the actual selected Frame Session renders a dirty bound range mask without publishing its draft', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		const before = structuredClone(f.controller.project), develop = range(session.develop), result = await draft(session)({ develop, maskOverlay: SELECTION }, snapshot);
		assert.deepEqual(result, { width: 2, height: 2, pixels: [255, 0, 0, 255, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255], coverage: [0, 255, 0, 255] });
		assert.deepEqual(f.controller.project, before); assert.equal(f.commands.length, 0);
		assert.deepEqual(await draft(session)({ develop }, snapshot), { width: result.width, height: result.height, pixels: result.pixels });
	} finally { await session.closeAndJoin(); }
});

test('accepted draft captures mutable recipe and exact selection synchronously before its first lazy yield', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		const before = structuredClone(f.controller.project), mutable = structuredClone(range(session.develop));
		const request: { develop: ImageDevelopStateCurrentV1; maskOverlay: { maskId: string; effectId: string } } = { develop: mutable, maskOverlay: { ...SELECTION } };
		const work = observed(draft(session)(request, snapshot));
		Object.assign(mutable.masks[0]!.nodes[0]!, { lower: 0, upper: .1 });
		request.maskOverlay.maskId = 'changed-nested-mask'; request.maskOverlay.effectId = 'changed-nested-effect';
		request.develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, effects: [], masks: [], maskBindings: [] });
		request.maskOverlay = { maskId: 'replaced-mask', effectId: 'replaced-effect' };
		const outcome = await work; assert.ok(outcome.ok);
		assert.deepEqual(outcome.value, { width: 2, height: 2,
			pixels: [255, 0, 0, 255, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255], coverage: [0, 255, 0, 255] });
		assert.deepEqual(f.controller.project, before); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('rendered coverage samples repaired adjustment input after prefix effects and follows real suffix geometry', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		const before = structuredClone(f.controller.project), base = range(session.develop), repaired = replaceImageDevelopRepairSpotsV1(base, {
			schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true, target: { x: .75, y: .25 }, source: { x: .25, y: .25 }, radius: .1, feather: 0, opacity: 1 }] });
		const develop = normalizeImageDevelopStateCurrentV1({ ...repaired, effects: [invert('prefix'), invert(),
			createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })] });
		assert.deepEqual(await draft(session)({ develop, maskOverlay: SELECTION }, snapshot), { width: 2, height: 2,
			pixels: [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255], coverage: [255, 255, 0, 255] });
		assert.deepEqual(f.controller.project, before); assert.equal(f.commands.length, 0); assert.equal(session.isCurrent(), true);
	} finally { await session.closeAndJoin(); }
});

test('every dirty draft authenticates retained disabled LUT and unused brush bodies before acquiring Original', async () => {
	const f = fixture({ cube: false }), session = await f.port.open();
	try {
		assert.deepEqual(f.calls, [LUT.storageKey]); f.calls.splice(0);
		f.bodies.set(LUT.storageKey, new Blob([new Uint8Array(LUT.byteLength)]));
		await assert.rejects(draft(session)({ develop: session.develop }, () => assert.fail('Corrupt disabled LUT cannot reach a borrower.')), /LUT/iu);
		assert.deepEqual(f.calls, [LUT.storageKey]); assert.equal(f.commands.length, 0);
		f.bodies.set(LUT.storageKey, new Blob([LUT_BODY])); f.calls.splice(0);
		const unused = await f.brush([17, 31]), bytes = unused.bytes.slice(); bytes[16] = bytes[16]! ^ 1;
		f.bodies.set(unused.reference.storageKey, new Blob([bytes]));
		const develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, masks: [{ schemaVersion: 2, id: 'unused', name: 'Unused native brush', kind: 'matte',
			inputs: [{ name: 'paint', sourceRef: unused.reference.storageKey, kind: 'alpha' }], nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }] });
		await assert.rejects(draft(session)({ develop }, () => assert.fail('Corrupt unused brush cannot reach a borrower.')));
		assert.deepEqual(f.calls, [LUT.storageKey, unused.reference.storageKey]); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('actual native brush coverage renders a dirty draft while immutable pack and resource bodies stay unchanged', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		const brush = await f.brush([0, 255]), before = structuredClone(f.controller.project), pack = f.pack.bytes.slice(), base = range(session.develop);
		const develop = normalizeImageDevelopStateCurrentV1({ ...base, masks: [{ schemaVersion: 2, id: 'range', name: 'Painted draft', kind: 'matte',
			inputs: [{ name: 'paint', sourceRef: brush.reference.storageKey, kind: 'alpha' }], nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }] });
		assert.deepEqual(await draft(session)({ develop, maskOverlay: SELECTION }, snapshot), { width: 2, height: 2,
			pixels: [255, 0, 0, 255, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 255], coverage: [0, 255, 0, 255] });
		assert.deepEqual(f.controller.project, before); assert.deepEqual(f.pack.bytes, pack); assert.equal(f.commands.length, 0);
		assert.deepEqual(new Uint8Array(await f.bodies.get(brush.reference.storageKey)!.arrayBuffer()), brush.bytes);
		assert.ok(f.calls.indexOf(brush.reference.storageKey) < f.calls.indexOf(f.source.storageKey));
	} finally { await session.closeAndJoin(); }
});

test('unbound or accessor-backed overlay selections refuse before native Original acquisition', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		const develop = range(session.develop); let getters = 0;
		await assert.rejects(draft(session)({ develop, maskOverlay: { maskId: 'range', effectId: 'absent' } }, () => undefined), /binding/u);
		await assert.rejects(draft(session)({ develop, maskOverlay: { maskId: 'range', get effectId() { getters++; return 'invert'; } } }, () => undefined), /data property/u);
		assert.equal(getters, 0); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('unchanged Source1 rendering charges real canonical and rendered planes before loading its pack', async () => {
	const f = fixture(), { develop: _develop, developed: _developed, provenance: _provenance, ...packed } = f.source;
	// Valid scalar Source1 metadata: canonical-only work fits, rendering does not.
	// No body is acquired, so this is a preflight witness, not a native pack claim.
	const source = normalizeFramescaperImageSourceV1({ ...packed, schemaVersion: 1, assetByteLength: 160 * 1024 * 1024,
		canonical: { ...packed.canonical, width: 1600, height: 1600 } });
	f.controller.project = applyFramescaperProjectCommand(PROFILE, f.controller.project, { type: 'image-source/set', sourceId: source.id, expectedSource: f.source, source });
	const session = await f.port.open();
	try { await assert.rejects(draft(session)({ develop: session.develop }, () => undefined), /512 MiB/u); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0); }
	finally { await session.closeAndJoin(); }
});

test('selected suffix projection scratch is bounded before even the canonical pack is acquired', async () => {
	const f = fixture(), { develop: _develop, developed: _developed, provenance: _provenance, ...packed } = f.source;
	// This valid scalar preflight fixture never asserts custody of a body matching
	// its deliberately large declared canonical extent.
	const source = normalizeFramescaperImageSourceV1({ ...packed, schemaVersion: 1,
		canonical: { ...packed.canonical, width: 4096, height: 2048 } });
	f.controller.project = applyFramescaperProjectCommand(PROFILE, f.controller.project, { type: 'image-source/set', sourceId: source.id, expectedSource: f.source, source });
	const session = await f.port.open();
	try {
		const develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, effects: [invert(), createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })],
			masks: [{ schemaVersion: 1, id: 'range', kind: 'matte', inputs: [], nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }],
			maskBindings: [{ maskId: 'range', effectId: 'invert' }] });
		await assert.rejects(draft(session)({ develop, maskOverlay: SELECTION }, () => undefined), /64 MiB/u); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('native preabort preserves its opaque reason before reflecting a hostile local draft request', async () => {
	const f = fixture(), session = await f.port.open(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy); let traps = 0;
	try {
		const request = new Proxy({}, { ownKeys() { traps++; throw new Error('Late draft reflection'); } });
		const work = Reflect.apply(draft(session), session, [request, () => undefined, { signal: stop.signal }]) as Promise<unknown>, outcome = await observed(work);
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(traps, 0); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('Close joins held native draft resource acquisition and prevents Apply, concurrent readers and preview release', async () => {
	const f = fixture(), session = await f.port.open(), entered = deferred<void>(), release = deferred<void>(); let closing: Promise<void> | undefined;
	const brush = await f.brush([0, 255]), develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, masks: [{ schemaVersion: 1, id: 'unused', kind: 'matte',
		inputs: [{ name: 'paint', sourceRef: brush.reference.storageKey, kind: 'alpha' }], nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }] });
	f.hooks.beforeLoad = async key => { if (key === brush.reference.storageKey) { entered.resolve(); await release.promise; } };
	const work = observed(draft(session)({ develop }, () => assert.fail('Closed draft cannot deliver pixels.')));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		assert.throws(() => session.apply(develop), /join before Apply/u); await assert.rejects(session.withOriginalFrame(() => undefined), /already pending/u);
		await assert.rejects(draft(session)({ develop }, () => undefined), /already pending/u);
		closing = session.closeAndJoin(); assert.equal(session.closeAndJoin(), closing); assert.equal(await remainsPending(closing), true);
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), true); release.resolve(); assert.equal((await work).ok, false); await closing;
		assert.deepEqual(f.calls, [brush.reference.storageKey]); assert.equal(f.commands.length, 0); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false);
		assert.deepEqual(new Uint8Array(await f.bodies.get(brush.reference.storageKey)!.arrayBuffer()), brush.bytes);
	} finally { release.resolve(); await work; await closing; await session.closeAndJoin(); }
});

test('opaque caller cancellation outranks concurrent project drift during an accepted native resource read', async () => {
	const f = fixture(), session = await f.port.open(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const brush = await f.brush([255]), develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, masks: [{ schemaVersion: 1, id: 'unused', kind: 'matte',
		inputs: [{ name: 'paint', sourceRef: brush.reference.storageKey, kind: 'alpha' }], nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }] });
	f.hooks.beforeLoad = async key => { if (key === brush.reference.storageKey) { entered.resolve(); await release.promise; } };
	const work = observed(draft(session)({ develop }, () => assert.fail('Cancelled draft cannot deliver pixels.'), { signal: stop.signal }));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true); stop.abort(reason.proxy);
		f.controller.project = { ...f.controller.project, name: 'Valid same-revision drift' }; release.resolve(); const outcome = await work;
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, reason.proxy)); assert.deepEqual(f.calls, [brush.reference.storageKey]); assert.equal(f.commands.length, 0);
	} finally { release.resolve(); await work; await session.closeAndJoin(); }
});

test('a held rendered borrower keeps actual pixels and coverage live until Close joins and physically retires both', async () => {
	const f = fixture(), session = await f.port.open(), entered = deferred<void>(), release = deferred<void>(); let pixels: Uint8Array | undefined, coverage: Uint8Array | undefined, closing: Promise<void> | undefined;
	const work = observed(draft(session)({ develop: range(session.develop), maskOverlay: SELECTION }, async view => {
		pixels = view.frame.pixels; coverage = view.maskOverlay!.coverage; entered.resolve(); await release.promise;
	}));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		assert.deepEqual([...coverage!], [0, 255, 0, 255]); assert.ok(pixels!.some(byte => byte !== 0)); closing = session.closeAndJoin();
		assert.equal(await remainsPending(closing), true); assert.equal(videoPreviewAuthoringPausedV1(f.controller), true); assert.ok(pixels!.some(byte => byte !== 0));
		release.resolve(); assert.equal((await work).ok, false); await closing; assert.ok(pixels!.every(byte => byte === 0)); assert.ok(coverage!.every(byte => byte === 0));
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); assert.equal(f.commands.length, 0);
	} finally { release.resolve(); await work; await closing; await session.closeAndJoin(); }
});

for (const processVersion of [1, 2, 3] as const) for (const target of ['frame', 'coverage'] as const) test(`process${processVersion} held rendered ${target} transfer refuses physical retirement`, async () => {
	const f = fixture({ processVersion: processVersion === 3 ? 2 : processVersion }), session = await f.port.open(), entered = deferred<void>(), release = deferred<void>();
	let backing: ArrayBuffer | undefined; const pack = f.pack.bytes.slice(), base = range(session.develop), develop = processVersion === 3
		? normalizeImageDevelopStateCurrentV1({ ...base, processVersion: 3, repairs: { schemaVersion: 1, spots: [] } }) : base;
	const work = observed(draft(session)({ develop, maskOverlay: SELECTION }, async view => {
		backing = target === 'frame' ? view.frame.pixels.buffer : view.maskOverlay!.coverage.buffer; entered.resolve(); await release.promise;
	}));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true); assert.ok(backing);
		const moved = structuredClone(backing, { transfer: [backing] }); assert.ok(moved.byteLength > 0); release.resolve(); const outcome = await work;
		assert.ok(!outcome.ok); assert.ok(outcome.error instanceof TypeError || outcome.error instanceof AggregateError);
		assert.deepEqual(f.pack.bytes, pack); assert.equal(f.commands.length, 0);
	} finally { release.resolve(); await work; await session.closeAndJoin(); }
});

test('a revoked opaque consumer failure and a distinct transferred-backing retirement failure both survive', async () => {
	const f = fixture(), session = await f.port.open(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	try {
		const outcome = await observed(draft(session)({ develop: range(session.develop), maskOverlay: SELECTION }, view => {
			structuredClone(view.maskOverlay!.coverage.buffer, { transfer: [view.maskOverlay!.coverage.buffer] }); throw opaque.proxy;
		}));
		assert.ok(!outcome.ok); assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.cause, opaque.proxy));
		assert.ok(outcome.error.errors.some((error: unknown) => Object.is(error, opaque.proxy)));
		assert.ok(outcome.error.errors.some((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof TypeError));
		assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('opaque cancellation triggered inside hostile scalar admission wins before any native body is read', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		for (const target of ['request', 'options'] as const) {
			const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let traps = 0;
			const fail = () => { traps++; stop.abort(opaque.proxy); throw new Error('Hostile scalar reflection failed.'); };
			const request = target === 'request' ? new Proxy({ develop: session.develop }, { ownKeys: fail }) : { develop: session.develop };
			const options = target === 'options' ? new Proxy({ signal: stop.signal }, { ownKeys: fail }) : { signal: stop.signal };
			const outcome = await observed(Reflect.apply(draft(session), session, [request, () => undefined, options]) as Promise<unknown>);
			assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(traps, 1); assert.deepEqual(f.calls, []); assert.equal(f.commands.length, 0);
		}
	} finally { await session.closeAndJoin(); }
});

test('raw Original borrowing excludes draft work and later draft success leaves publication to the existing Apply command', async () => {
	const f = fixture(), session = await f.port.open(), entered = deferred<void>(), release = deferred<void>(), before = structuredClone(f.controller.project), pack = f.pack.bytes.slice();
	const raw = observed(session.withOriginalFrame(async frame => { assert.deepEqual([...frame.pixels], CORNERS); entered.resolve(); await release.promise; }));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), raw.then(() => false)]), true);
		await assert.rejects(draft(session)({ develop: range(session.develop), maskOverlay: SELECTION }, () => undefined), /already pending/u);
		release.resolve(); assert.equal((await raw).ok, true); const develop = range(session.develop); await draft(session)({ develop, maskOverlay: SELECTION }, snapshot);
		assert.deepEqual(f.controller.project, before); assert.deepEqual(f.pack.bytes, pack); assert.equal(f.commands.length, 0);
		session.apply(develop); assert.equal(f.commands.length, 1); assert.equal(f.commands[0]!.source?.schemaVersion, 3);
	} finally { release.resolve(); await raw; await session.closeAndJoin(); }
});
