/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationV2, preparePhotoDevelopPresentationViewV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const SHA = createHash('sha256').update(BODY).digest('hex');
const REFERENCE = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: BODY.byteLength, size: 2, domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const };
const recipe = () => ({ ...defaultImageDevelopStateV2(), effects: [{ id: 'lut', type: 'cube-lut-profile-v1' as const, enabled: true, params: { lut: structuredClone(REFERENCE) } }] });
const frame = (): PixelFrameV1 => ({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([64, 128, 192, 127]) });
const targets = () => ({ before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement });
function preview() {
	const source = frame();
	return { photoId: 'photo', tier: 'fit-screen' as const, descriptor: source.descriptor, byteLength: 4,
		outputSha256: createHash('sha256').update(source.pixels).digest('hex'), body: new Blob([source.pixels]) };
}
function opaque() { let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('Reason reflected'); }, getPrototypeOf() { traps++; throw Error('Reason reflected'); } }); return { reason, traps: () => traps }; }

for (const resolution of ['proxy', 'full'] as const) test(`current ${resolution} presentation uses an authenticated LUT and fixed profiles, then retires all scoped bytes`, async () => {
	const pixels: number[][] = [], backing: PixelFrameV1['pixels'][] = [], profiles: unknown[] = []; let lutReads = 0, originalReads = 0, previewReads = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); assert.deepEqual(reference, REFERENCE); lutReads++; const bytes = BODY.slice(); backing.push(bytes);
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
	const runtime = createPhotoDevelopRenderRuntimeV2({ source });
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume) => {
		originalReads++; assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 7 }); const sourceFrame = frame(); backing.push(sourceFrame.pixels);
		try { return await consume({ photoId: 'photo', revision: 7, frame: sourceFrame }); } finally { sourceFrame.pixels.fill(0); }
	};
	const owner = new PhotoLibraryDevelopPresentationV2({ withOriginalFrame, readPreview: async () => { previewReads++; return { outcome: 'ready', preview: preview(), cache: 'hit', notices: [] }; },
		loadProxy: async () => runtime, paint: (_canvas, value, options) => { backing.push(value.pixels); pixels.push([...value.pixels]); profiles.push(options.limits); return { width: 1, height: 1, byteLength: 4 }; }, clear() {} });
	owner.setView({ photoId: 'photo', develop: recipe(), revision: 7, resolution, ...targets() }); await owner.drain();
	assert.deepEqual(pixels, [[64, 128, 192, 127], [137, 0, 0, 127]]); assert.equal(lutReads, 1);
	assert.deepEqual([previewReads, originalReads], resolution === 'full' ? [0, 1] : [1, 0]);
	assert.equal(owner.snapshot().status, 'ready'); assert.equal(owner.snapshot().after?.bins.red[137], 1);
	assert.deepEqual(owner.snapshot().extent, { before: { width: 1, height: 1 }, after: { width: 1, height: 1 } });
	assert.ok(backing.every(bytes => bytes.every(byte => byte === 0)));
	assert.deepEqual(profiles, resolution === 'full' ? [PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render]
		: [{ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 }, { maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 }]);
	await owner.close();
});

test('complete prepared requests are detached before waits and strict legacy admission never upgrades', async () => {
	const barrier = deferred<void>(), develop = recipe(), sourceTargets = targets(), request = { photoId: 'photo', develop, ...sourceTargets };
	const prepared = preparePhotoDevelopPresentationViewV2(request); develop.effects[0]!.enabled = false; develop.effects[0]!.params.lut.size = 3; request.photoId = 'mutated';
	let received = ''; const owner = new PhotoLibraryDevelopPresentationV2({ beforePresent: barrier.promise,
		readPreview: async id => { received = id; return { outcome: 'missing' }; }, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(), clear() {} });
	owner.setView(prepared); barrier.resolve(); await owner.drain(); assert.equal(received, 'photo');
	assert.equal(prepared.develop.effects[0]?.enabled, true); assert.equal(prepared.develop.processVersion, 2);
	assert.equal(preparePhotoDevelopPresentationViewV2({ ...request, develop: defaultImageDevelopStateV1() }).develop.processVersion, 1);
	for (const changed of [{ ...request, resolution: 'other' }, { ...request, resolution: 'full', revision: -1 }, { ...request, extra: true }, { ...request, photoId: {} },
		{ ...request, develop: { ...recipe(), processVersion: 1 } }]) assert.throws(() => preparePhotoDevelopPresentationViewV2(changed));
	let accessors = 0; assert.throws(() => preparePhotoDevelopPresentationViewV2({ ...request, get develop() { accessors++; return recipe(); } })); assert.equal(accessors, 0);
	await owner.close();
});

test('every borrowed callable is captured with its original receiver without reading function metadata', async () => {
	let traps = 0, loads = 0; const guarded = <T extends (...args: never[]) => unknown>(method: T): T => new Proxy(method, { get() { traps++; throw Error('Function metadata read'); } });
	const runtime = createPhotoDevelopRenderRuntimeV2(), ports = { async readPreview() { assert.equal(this, ports); return { outcome: 'ready' as const, preview: preview(), cache: 'hit' as const, notices: [] }; },
		async loadProxy() { assert.equal(this, ports); loads++; return runtime; }, paint: (_canvas: HTMLCanvasElement, value: PixelFrameV1) => ({ width: 1, height: 1, byteLength: value.pixels.byteLength }), clear() { assert.equal(this, ports); } };
	ports.readPreview = guarded(ports.readPreview); ports.loadProxy = guarded(ports.loadProxy); ports.paint = guarded(ports.paint); ports.clear = guarded(ports.clear);
	const owner = new PhotoLibraryDevelopPresentationV2(ports); ports.loadProxy = () => { throw Error('Replacement used'); };
	owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...targets() }); await owner.drain();
	assert.equal(owner.snapshot().status, 'ready'); assert.equal(loads, 1); await owner.close(); assert.equal(traps, 0);
});

test('ready waits for the complete original scope; post-consumer revision refusal clears both targets', async () => {
	for (const refuse of [false, true]) {
		const painted = deferred<void>(), release = deferred<void>(), failure = opaque(), sourceFrame = frame(), cleared: HTMLCanvasElement[] = [], states: string[] = [], target = targets();
		const owner = new PhotoLibraryDevelopPresentationV2({ withOriginalFrame: async (_request, consume) => {
			try { const result = await consume({ photoId: 'photo', revision: 7, frame: sourceFrame }); painted.resolve(); await release.promise; if (refuse) throw failure.reason; return result; }
			finally { sourceFrame.pixels.fill(0); }
		}, readPreview: async () => { throw Error('No derivative'); }, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(),
		paint: () => ({ width: 1, height: 1, byteLength: 4 }), clear(canvas) { cleared.push(canvas); } });
		owner.subscribe(value => states.push(value.status)); owner.setView({ photoId: 'photo', revision: 7, resolution: 'full', develop: defaultImageDevelopStateV1(), ...target });
		await painted.promise; assert.equal(owner.snapshot().status, 'pending'); assert.equal(await remainsPending(owner.drain()), true);
		release.resolve(); await owner.drain(); assert.equal(owner.snapshot().status, refuse ? 'failed' : 'ready');
		if (refuse) { assert.equal(states.includes('ready'), false); assert.deepEqual(cleared, [target.before, target.after]); }
		assert.ok(sourceFrame.pixels.every(byte => byte === 0)); await owner.close(); assert.equal(failure.traps(), 0);
	}
});

test('pause joins held LUT cleanup and retains distinct opaque failure through all later retirement', async () => {
	const entered = deferred<void>(), release = deferred<void>(), failure = opaque(); let reads = 0; const bytes = BODY.slice();
	const runtime = createPhotoDevelopRenderRuntimeV2({ source: { async withBytes(_ref, consume) { try { await consume(bytes); entered.resolve(); await release.promise; throw failure.reason; } finally { bytes.fill(0); } } } });
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => { reads++; return { outcome: 'ready', preview: preview(), cache: 'hit', notices: [] }; }, loadProxy: async () => runtime,
		paint: () => ({ width: 1, height: 1, byteLength: 4 }), clear() {} });
	owner.setView({ photoId: 'photo', develop: recipe(), ...targets() }); await entered.promise;
	const paused = owner.pause(), observed = paused.then(() => assert.fail('Cleanup fulfilled'), error => { assert.equal(error, failure.reason); });
	assert.equal(await remainsPending(paused), true); release.resolve(); await observed; assert.ok(bytes.every(byte => byte === 0));
	owner.setView({ photoId: 'later', develop: recipe(), ...targets() }); await settle(); assert.equal(reads, 1);
	try { await owner.close(); assert.fail('Sticky failure lost'); } catch (error) { assert.equal(error, failure.reason); } assert.equal(failure.traps(), 0);
});

test('native cancellation after renderer consumer settlement clears targets and blocks ready', async () => {
	const entered = deferred<void>(), release = deferred<void>(), target = targets(), cleared: HTMLCanvasElement[] = [];
	const actual = createPhotoDevelopRenderRuntimeV2();
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = { withFullResolution: actual.withFullResolution, async withProxy(request, consume) {
		const result = await actual.withProxy(request, consume); entered.resolve(); await release.promise; return result;
	} };
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => ({ outcome: 'ready', preview: preview(), cache: 'hit', notices: [] }), loadProxy: async () => runtime,
		paint: () => ({ width: 1, height: 1, byteLength: 4 }), clear(canvas) { cleared.push(canvas); } });
	owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...target }); await entered.promise;
	const paused = owner.pause(); release.resolve(); await paused; assert.equal(owner.snapshot().status, 'idle'); assert.deepEqual(cleared, [target.before, target.after]); await owner.close();
});

test('Close installs its exact cached join before native abort callbacks can reenter retirement', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let nested: Promise<void> | undefined;
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async (_id, _tier, options) => {
		options?.signal?.addEventListener('abort', () => { nested = owner.close(); }, { once: true }); entered.resolve(); await release.promise; return { outcome: 'missing' };
	}, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(), clear() {} });
	owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...targets() }); await entered.promise;
	const closing = owner.close(); assert.equal(nested, closing); assert.equal(owner.close(), closing); assert.equal(await remainsPending(closing), true);
	release.resolve(); await closing; assert.equal(owner.snapshot().status, 'idle');
});

test('original identity/revision mismatches refuse before any canvas publication', async () => {
	for (const changed of [{ photoId: 'other', revision: 7 }, { photoId: 'photo', revision: 8 }]) {
		let paints = 0; const source = frame();
		const owner = new PhotoLibraryDevelopPresentationV2({ withOriginalFrame: async (_request, consume) => {
			try { return await consume({ ...changed, frame: source }); } finally { source.pixels.fill(0); }
		}, readPreview: async () => { throw Error('No derivative'); }, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(),
		paint: () => { paints++; return { width: 1, height: 1, byteLength: 4 }; }, clear() {} });
		owner.setView({ photoId: 'photo', revision: 7, resolution: 'full', develop: recipe(), ...targets() }); await owner.drain();
		assert.equal(paints, 0); assert.equal(owner.snapshot().status, 'failed'); assert.ok(source.pixels.every(value => value === 0)); await owner.close();
	}
});

test('borrowed renderer methods are pinned at acquisition before a held original body admits its consumer', async () => {
	const entered = deferred<void>(), release = deferred<void>(), actual = createPhotoDevelopRenderRuntimeV2(); let rendered = 0;
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = { withProxy: actual.withProxy, withFullResolution(request, consume) { rendered++; return actual.withFullResolution(request, consume); } };
	const owner = new PhotoLibraryDevelopPresentationV2({ withOriginalFrame: async (_request, consume) => { entered.resolve(); await release.promise; return consume({ photoId: 'photo', revision: 7, frame: frame() }); },
		readPreview: async () => { throw Error('No derivative'); }, loadProxy: async () => runtime, paint: () => ({ width: 1, height: 1, byteLength: 4 }), clear() {} });
	owner.setView({ photoId: 'photo', revision: 7, resolution: 'full', develop: defaultImageDevelopStateV1(), ...targets() }); await entered.promise;
	runtime.withFullResolution = () => { throw Error('Replaced runtime capability used'); }; release.resolve(); await owner.drain();
	assert.equal(rendered, 1); assert.equal(owner.snapshot().status, 'ready'); await owner.close();
});

test('pause behind the external barrier admits no source, original or runtime work', async () => {
	const gate = deferred<void>(); let reads = 0, originals = 0, loads = 0;
	const owner = new PhotoLibraryDevelopPresentationV2({ beforePresent: gate.promise,
		readPreview: async () => { reads++; return { outcome: 'missing' }; }, withOriginalFrame: async () => { originals++; throw Error('No original demand'); },
		loadProxy: async () => { loads++; return createPhotoDevelopRenderRuntimeV2(); }, clear() {} });
	owner.setView({ photoId: 'photo', resolution: 'full', revision: 7, develop: recipe(), ...targets() }); await settle();
	const pausing = owner.pause(); gate.resolve(); await pausing; assert.deepEqual([reads, originals, loads], [0, 0, 0]); await owner.close();
});

test('a failed original scope and distinct canvas retirement failures retain every exact opaque identity', async () => {
	const primary = opaque(), cleanup = opaque(), target = targets();
	const owner = new PhotoLibraryDevelopPresentationV2({ withOriginalFrame: async (_request, consume) => { await consume({ photoId: 'photo', revision: 7, frame: frame() }); throw primary.reason; },
		readPreview: async () => { throw Error('No derivative'); }, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(),
		paint: () => ({ width: 1, height: 1, byteLength: 4 }), clear(canvas) { if (canvas === target.before) throw cleanup.reason; } });
	owner.setView({ photoId: 'photo', revision: 7, resolution: 'full', develop: defaultImageDevelopStateV1(), ...target });
	try { await owner.drain(); assert.fail('Cleanup evidence lost'); } catch (error) { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary.reason, cleanup.reason]); }
	try { await owner.close(); assert.fail('Sticky evidence lost'); } catch (error) { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary.reason, cleanup.reason]); }
	assert.deepEqual([primary.traps(), cleanup.traps()], [0, 0]);
});

test('a view queued during Pause keeps its canvas retirement authority after the preceding scope joins', async () => {
	const entered = deferred<void>(), release = deferred<void>(), first = targets(), second = targets(), events: string[] = []; let reads = 0;
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => { if (++reads === 1) { entered.resolve(); await release.promise; return { outcome: 'missing' }; }
		return { outcome: 'ready', preview: preview(), cache: 'hit', notices: [] };
	}, loadProxy: async () => createPhotoDevelopRenderRuntimeV2(), paint(canvas) { events.push(canvas === second.before ? 'paint-before' : 'paint-after'); return { width: 1, height: 1, byteLength: 4 }; },
	clear(canvas) { if (canvas === second.before) events.push('clear-before'); if (canvas === second.after) events.push('clear-after'); } });
	owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...first }); await entered.promise;
	const paused = owner.pause(); owner.setView({ photoId: 'photo', develop: defaultImageDevelopStateV1(), ...second });
	assert.equal(reads, 1); release.resolve(); await paused; await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
	await owner.close(); assert.deepEqual(events.slice(-4), ['paint-before', 'paint-after', 'clear-before', 'clear-after']);
});
