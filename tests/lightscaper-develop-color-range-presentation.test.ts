/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationV2, preparePhotoDevelopPresentationViewV2,
	type PhotoDevelopPresentationViewV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { maskedDevelop, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PIXELS = [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 128, 128, 128, 128];
const OUTPUT = [0, 255, 255, 255, 119, 119, 233, 255, 0, 0, 0, 0, 127, 127, 127, 128];
const COVERAGE = [255, 47, 0, 131];
const OVERLAY = COVERAGE.flatMap(alpha => [255, 48, 48, alpha]);
const recipe = () => normalizeImageDevelopStateV1OrV2(maskedDevelop([createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } })],
	{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'range', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 }], outputNodeId: 'range' }));
const targets = () => ({ before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement, overlay: {} as HTMLCanvasElement });
type OverlayView = PhotoDevelopPresentationViewV2 & { readonly maskOverlay: Readonly<{ maskId: string; effectId: string }>; readonly overlay: HTMLCanvasElement };
function view(target: ReturnType<typeof targets>, resolution: 'proxy' | 'full' = 'proxy'): OverlayView {
	return { photoId: 'photo', revision: 7, resolution, develop: recipe(), maskOverlay: { maskId: 'mask', effectId: 'invert' }, ...target };
}
function preview() {
	const frame = rgbaFrame(PIXELS);
	return { photoId: 'photo', tier: 'fit-screen' as const, descriptor: frame.descriptor, byteLength: frame.pixels.byteLength,
		outputSha256: createHash('sha256').update(frame.pixels).digest('hex'), body: new Blob([frame.pixels]) };
}
const actual = createPhotoDevelopRenderRuntimeV2();

for (const resolution of ['proxy', 'full'] as const) test(`actual ${resolution} color overlay paints with After and becomes ready only after the real borrowed scope joins`, async () => {
	const target = targets(), entered = deferred<void>(), release = deferred<void>();
	const painted = new Map<HTMLCanvasElement, number[]>(), backings: PixelFrameV1['pixels'][] = [], cleared: HTMLCanvasElement[] = [];
	const hold: PhotoLibraryDevelopProxyRuntimeV2['withProxy'] = (request, consume) => actual[resolution === 'full' ? 'withFullResolution' : 'withProxy'](request, async output => {
		assert.ok(output.maskOverlay); assert.deepEqual([...output.maskOverlay.coverage], COVERAGE);
		backings.push(output.frame.pixels, output.maskOverlay.coverage); const result = await consume(output);
		entered.resolve(); await release.promise; return result;
	});
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = { withProxy: hold, withFullResolution: hold };
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => ({ outcome: 'ready', preview: preview(), cache: 'hit', notices: [] }),
		withOriginalFrame: async (_request, consume) => { const frame = rgbaFrame(PIXELS); backings.push(frame.pixels);
			try { return await consume({ photoId: 'photo', revision: 7, frame }); } finally { frame.pixels.fill(0); } },
		loadProxy: async () => runtime, paint: (canvas, frame) => { painted.set(canvas, [...frame.pixels]); backings.push(frame.pixels);
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear(canvas) { cleared.push(canvas); } });
	try {
		owner.setView(view(target, resolution)); await Promise.race([entered.promise, owner.drain()]);
		assert.deepEqual(painted.get(target.before), PIXELS); assert.deepEqual(painted.get(target.after), OUTPUT); assert.deepEqual(painted.get(target.overlay), OVERLAY);
		assert.equal(owner.snapshot().status, 'pending'); assert.equal(owner.snapshot().extent, null); assert.equal(await remainsPending(owner.drain()), true);
		release.resolve(); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual(owner.snapshot().extent, { before: { width: 4, height: 1 }, after: { width: 4, height: 1 } });
		assert.ok(backings.every(bytes => bytes.every(byte => byte === 0))); assert.equal(Object.hasOwn(owner.snapshot(), 'maskOverlay'), false);
		await owner.close(); assert.deepEqual(cleared, [target.before, target.after, target.overlay]);
	} finally { release.resolve(); await owner.close(); }
});

test('replacement retires the real held color output and all three targets before publishing the new unoverlaid view', async () => {
	const first = targets(), second = targets(), entered = deferred<void>(), release = deferred<void>(), clears: HTMLCanvasElement[] = [], states: string[] = [];
	let calls = 0, oldPixels: PixelFrameV1['pixels'] | undefined, oldCoverage: Uint8Array | undefined;
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = { withFullResolution: actual.withFullResolution, withProxy(request, consume) {
		const ordinal = ++calls; return actual.withProxy(request, async output => {
			if (ordinal === 1) { oldPixels = output.frame.pixels; oldCoverage = output.maskOverlay?.coverage; entered.resolve(); await release.promise; }
			return consume(output);
		});
	} };
	const paints: HTMLCanvasElement[] = [];
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => ({ outcome: 'ready', preview: preview(), cache: 'hit', notices: [] }), loadProxy: async () => runtime,
		paint(canvas, frame) { paints.push(canvas); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear(canvas) { clears.push(canvas); } });
	owner.subscribe(snapshot => states.push(snapshot.status));
	try {
		owner.setView(view(first)); await Promise.race([entered.promise, owner.drain()]);
		const pausing = owner.pause(); owner.setView({ photoId: 'photo', develop: recipe(), before: second.before, after: second.after });
		assert.equal(await remainsPending(pausing), true); assert.equal(calls, 1); assert.equal(oldCoverage?.[0], 255);
		release.resolve(); await pausing; await owner.drain(); assert.equal(calls, 2); assert.equal(owner.snapshot().status, 'ready');
		assert.ok(oldPixels?.every(byte => byte === 0)); assert.ok(oldCoverage?.every(byte => byte === 0));
		assert.equal(paints.includes(first.after), false); assert.equal(paints.includes(first.overlay), false);
		assert.deepEqual(clears.slice(0, 3), [first.before, first.after, first.overlay]); assert.equal(states.filter(state => state === 'ready').length, 1);
		await owner.close(); assert.deepEqual(clears.slice(-2), [second.before, second.after]);
	} finally { release.resolve(); await owner.close(); }
});

test('overlay selection and a distinct target are admitted together before source acquisition, without accessor execution', () => {
	const target = targets(), selection = { maskId: 'mask', effectId: 'invert' }, request = { ...view(target), maskOverlay: selection };
	const prepared = preparePhotoDevelopPresentationViewV2(request); selection.maskId = 'changed'; selection.effectId = 'changed';
	assert.deepEqual((prepared as OverlayView).maskOverlay, { maskId: 'mask', effectId: 'invert' });
	for (const invalid of [{ ...request, overlay: undefined }, { ...request, maskOverlay: undefined }, { ...request, overlay: target.before },
		{ ...request, overlay: target.after }]) assert.throws(() => preparePhotoDevelopPresentationViewV2(invalid));
	let getters = 0;
	assert.throws(() => preparePhotoDevelopPresentationViewV2({ ...view(target), get maskOverlay() { getters++; return { maskId: 'mask', effectId: 'invert' }; } }));
	assert.equal(getters, 0);
});
