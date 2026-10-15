/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopRepairSpotsDialogCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopRepairSpotsDialogCurrentV1.tsx';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import { validateImageRepairSpotsCurrentV1, withImageRepairSpotsDisplayCurrentV1 } from '../src/common/editor/imaging/image-repair-spots-native-current-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

/** Only the canvas/Original capability boundary is modeled here. The separate
 * owning test authenticates actual DNG bytes through the pinned native WASM. */
function nativeBoundary(painted: number[][]) {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(value: { data: Uint8ClampedArray }) { painted.push([...value.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } };
}
function nativeFrame() {
	return { descriptor: { schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const },
		pixels: new Uint16Array([0, 0, 0, 65535, 16384, 16384, 16384, 65535, 65535, 65535, 65535, 65535]) };
}
async function dialog() {
	const painted: number[][] = [], restore = nativeBoundary(painted), applied: Readonly<ImageDevelopStateV3>[] = [], backings: Uint16Array[] = [];
	const entered = deferred<void>(), release = deferred<void>(), retirements = new Set<() => Promise<void>>();
	let develop: ImageDevelopStateCurrentV1 = defaultImageDevelopStateV2(), holding = false, closes = 0;
	const original: PhotoLibraryDevelopOriginalPortV1 = { async withFrame(request, consume, options) {
		assert.equal(this, original); assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 7 });
		const frame = nativeFrame(); backings.push(frame.pixels);
		try { if (holding) { holding = false; entered.resolve(); await release.promise; } options?.signal?.throwIfAborted(); return await consume({ photoId: 'photo', revision: 7, frame }); }
		finally { frame.pixels.fill(0); }
	} };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopRepairSpotsDialogCurrentV1 photoId="photo" revision={7} develop={develop} original={original}
		locale="en" isCurrent={() => true} onApply={value => { applied.push(value); }} onClose={() => { closes++; }}
		registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />);
	const control = (name: string) => { const node = mounted.dom.container.querySelectorAll('input,select').find(value => value.getAttribute('aria-label') === name); assert.ok(node, name); return node; };
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').filter(value => value.textContent === name).at(-1); assert.ok(node, name); return node; };
	const change = async (name: string, value: string | boolean) => { await act(async () => { reactProps(control(name)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); await settle(); }); };
	const click = async (name: string) => { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); };
	const ready = async () => { await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.one('canvas').getAttribute('data-state') === 'ready'; }, 'Current native Original paint'); };
	const add = async () => { await change('Target X', String(2.5 / 3)); await change('Target Y', '.5'); await change('Source X', String(.5 / 3));
		await change('Source Y', '.5'); await change('Radius', '.4'); await change('Feather', '0'); await click('Add spot'); };
	return { ...mounted, painted, applied, backings, entered, release, ready, control, button, change, click, add, closes: () => closes,
		hold() { holding = true; }, async replace(value: ImageDevelopStateCurrentV1) { develop = value; await mounted.render(); },
		async dispose() {
			release.resolve(); const results = await Promise.allSettled([mounted.dispose(), ...[...retirements].map(retire => retire())]); restore();
			const errors = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
			if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Current repair fixture retirement failed.');
		},
	};
}

test('Current repair dialog paints native word Original at the display boundary and true linear edge diagnostics', async () => {
	const f = await dialog();
	try {
		await f.ready(); assert.deepEqual(f.painted.at(-1), [0, 0, 0, 255, 137, 137, 137, 255, 255, 255, 255, 255]);
		await f.change('Visualize spots', true); await f.ready();
		assert.deepEqual(f.painted.at(-1), [235, 235, 235, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
		await f.change('Edge threshold', '.25'); await f.ready();
		assert.deepEqual(f.painted.at(-1), [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
		await f.change('Visualize spots', false); await f.ready();
		assert.deepEqual(f.painted.at(-1), [0, 0, 0, 255, 137, 137, 137, 255, 255, 255, 255, 255]);
		assert.equal(f.applied.length, 0); assert.ok(f.backings.every(value => value.every(word => word === 0)));
	} finally { await f.dispose(); }
});

test('Current native Apply emits scalar repairs and replacement with Reset state retires the old authoring draft', async () => {
	const f = await dialog();
	try {
		await f.ready(); await f.add(); await f.click('Apply repairs');
		assert.equal(f.applied.length, 1); assert.equal(f.applied[0]!.repairs.spots.length, 1);
		await f.replace(f.applied[0]!); await f.ready();
		assert.equal(f.control('Spot').options.length, 2); assert.equal(f.dom.container.querySelectorAll('circle').length, 2);
		const staleApply = reactProps(f.button('Apply repairs')).onClick!;
		await f.replace(defaultImageDevelopStateV2()); await f.ready();
		assert.equal(f.control('Spot').options.length, 1); assert.equal(f.dom.container.querySelectorAll('circle').length, 0);
		await act(async () => { staleApply({}); await settle(); });
		assert.equal(f.applied.length, 1); assert.equal(f.dom.find('[role="alert"]'), null);
		assert.ok(f.backings.every(value => value.every(word => word === 0)));
	} finally { await f.dispose(); }
});

test('Close joins a held Current native Apply before dismissing and never publishes its cancelled draft', async () => {
	const f = await dialog();
	try {
		await f.ready(); await f.add(); f.hold(); await f.click('Apply repairs'); await f.entered.promise;
		await f.click('Close'); assert.equal(f.closes(), 0); assert.equal(f.applied.length, 0);
		assert.ok(f.backings.at(-1)?.some(word => word !== 0)); f.release.resolve();
		await waitFor(async () => { await act(async () => { await settle(); }); return f.closes() === 1; }, 'joined native repair Close');
		assert.equal(f.applied.length, 0); assert.ok(f.backings.every(value => value.every(word => word === 0)));
	} finally { await f.dispose(); }
});

test('native diagnostic callback cancellation joins and physically clears its display body before opaque rejection', async () => {
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke();
	const frame = nativeFrame(), before = frame.pixels.slice(); let borrowed: Uint8Array | Uint8ClampedArray | undefined;
	const operation = withImageRepairSpotsDisplayCurrentV1({ frame, visualize: true, threshold: .02, signal: stop.signal }, async display => {
		assert.ok(display.pixels instanceof Uint8Array); borrowed = display.pixels; entered.resolve(); await release.promise;
	});
	const outcome = operation.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered.promise; stop.abort(reason.proxy); assert.equal(await remainsPending(operation), true); assert.ok(borrowed?.some(value => value !== 0));
		release.resolve(); const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason.proxy), true);
		assert.ok(borrowed?.every(value => value === 0)); assert.deepEqual(frame.pixels, before);
	} finally { release.resolve(); await Promise.allSettled([operation]); }
});

test('Current repair policy preserves bounded native subviews and charges the whole physical backing before allocation', async () => {
	const allocation = new Uint16Array(20).fill(23), pixels = allocation.subarray(4, 16); pixels.set(nativeFrame().pixels);
	const frame = { ...nativeFrame(), pixels }, before = allocation.slice();
	await validateImageRepairSpotsCurrentV1(frame, { schemaVersion: 1, spots: [] });
	const display = await withImageRepairSpotsDisplayCurrentV1({ frame, visualize: false, threshold: .02 }, output => [...output.pixels]);
	assert.deepEqual(display, [0, 0, 0, 255, 137, 137, 137, 255, 255, 255, 255, 255]); assert.deepEqual(allocation, before);
	// Virtual allocation: only this twelve-word view is initialized or read.
	const backing = new ArrayBuffer(768 * 1024 * 1024), oversized = new Uint16Array(backing, 16, 12); oversized.set(nativeFrame().pixels);
	const huge = { ...nativeFrame(), pixels: oversized }; let consumed = false;
	await assert.rejects(validateImageRepairSpotsCurrentV1(huge, { schemaVersion: 1, spots: [] }), /physical backing|768/u);
	for (const visualize of [false, true]) await assert.rejects(withImageRepairSpotsDisplayCurrentV1({ frame: huge, visualize, threshold: .02 }, () => { consumed = true; }), /physical backing|768/u);
	assert.equal(consumed, false); assert.deepEqual(oversized, nativeFrame().pixels);
});
