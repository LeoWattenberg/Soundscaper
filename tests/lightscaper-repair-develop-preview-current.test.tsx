/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopPreviewCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopPreviewCurrentV1.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const INPUT = [255, 255, 255, 255, 0, 0, 0, 255], AFTER = [255, 255, 255, 255, 255, 255, 255, 255];
const state = () => replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'spot', mode: 'clone', enabled: true,
	target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 }] });
/** Instrument only the native canvas boundary. Actual Current CPU repair/render
 * output is used; presentation source acquisition is supplied by its port. */
function canvasBoundary(painted: number[][]) {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(image: { data: Uint8ClampedArray }) { painted.push([...image.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } };
}

for (const locale of ['en', 'de']) test(`${locale}: Current preview uses Original repair pixels, keeps modes keyboard reachable, and reuses its two canvas targets`, async () => {
	const painted: number[][] = [], restore = canvasBoundary(painted), retirees = new Set<() => Promise<void>>(), scopes: Uint8Array[] = []; let originals = 0;
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume, options) => {
		assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 7 }); originals++;
		const frame = rgbaFrame(INPUT); scopes.push(frame.pixels); try { options?.signal?.throwIfAborted(); return await consume({ photoId: 'photo', revision: 7, frame }); } finally { frame.pixels.fill(0); }
	};
	const develop = state(), beforePresent = Promise.resolve(), runtime = createPhotoDevelopRenderRuntimeV3();
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewCurrentV1 photoId="photo" revision={7} develop={develop} withOriginalFrame={withOriginalFrame}
		readPreview={async () => { assert.fail('Cached proxy cannot supply repair donors'); }} loadProxy={async () => runtime}
		beforePresent={beforePresent} registerRetirement={retire => { retirees.add(retire); return () => { retirees.delete(retire); }; }} messages={photoDevelopCopy(locale)} locale={locale} />);
	try { await act(async () => { await settle(); }); assert.deepEqual(painted, [INPUT, AFTER]); assert.equal(originals, 1);
		const canvases = mounted.dom.container.querySelectorAll('canvas'); assert.equal(canvases.length, 2);
		await mounted.event('select', 'onChange', { currentTarget: { value: 'split' } }); await mounted.event('input', 'onChange', { currentTarget: { value: '37' } });
		assert.equal(mounted.dom.one('input').value, '37'); assert.equal(mounted.dom.one('input').getAttribute('aria-label'), photoDevelopCopy(locale).divider);
		await mounted.event('select', 'onChange', { currentTarget: { value: 'after' } }); assert.deepEqual(mounted.dom.container.querySelectorAll('canvas'), canvases);
		assert.equal(originals, 1); assert.ok(scopes.every(bytes => bytes.every(value => value === 0)));
	} finally { const retiring = [...retirees]; await mounted.dispose(); await Promise.all(retiring.map(retire => retire())); restore(); }
});

test('Current suspended preview performs no Original read, joins held cancellation, and resumes the exact unchanged recipe after no-edit Close', async () => {
	const painted: number[][] = [], restore = canvasBoundary(painted), marker = deferred<void>(), release = deferred<void>(), retirees = new Set<() => Promise<void>>();
	const scopes: Uint8Array[] = [], signals: AbortSignal[] = []; let suspended = true, reads = 0;
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (_request, consume, options) => {
		reads++; assert.ok(options?.signal); signals.push(options.signal); const frame = rgbaFrame(INPUT); scopes.push(frame.pixels);
		try { if (reads === 1) { marker.resolve(); await release.promise; } options.signal.throwIfAborted(); return await consume({ photoId: 'photo', revision: 7, frame }); } finally { frame.pixels.fill(0); }
	};
	const develop = state(), beforePresent = Promise.resolve(), loadProxy = async () => createPhotoDevelopRenderRuntimeV3();
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewCurrentV1 photoId="photo" revision={7} develop={develop} withOriginalFrame={withOriginalFrame}
		readPreview={async () => { assert.fail('Preview cache read'); }} loadProxy={loadProxy} suspended={suspended} beforePresent={beforePresent}
		registerRetirement={retire => { retirees.add(retire); return () => { retirees.delete(retire); }; }} messages={photoDevelopCopy('en')} locale="en" />);
	try { await act(async () => { await settle(); }); assert.equal(reads, 0); suspended = false; await mounted.render();
		await act(async () => { await settle(); }); assert.equal(reads, 1); await marker.promise;
		suspended = true; await mounted.render(); assert.equal(signals[0]!.aborted, true);
		const joined = Promise.all([...retirees].map(retire => retire())); assert.equal(await remainsPending(joined), true); assert.deepEqual(painted, []);
		release.resolve(); await joined; suspended = false; await mounted.render(); await act(async () => { await settle(); });
		assert.deepEqual(painted, [INPUT, AFTER]); assert.equal(reads, 2); assert.ok(scopes.every(bytes => bytes.every(value => value === 0)));
	} finally { release.resolve(); const retiring = [...retirees]; await mounted.dispose(); await Promise.all(retiring.map(retire => retire())); restore(); }
});

test('Current StrictMode replay and source replacement preserve actual receiver capture and fence stale display handlers', async () => {
	const painted: number[][] = [], restore = canvasBoundary(painted), gate = deferred<void>(), retirees = new Set<() => Promise<void>>(); let metadata = 0, calls = 0;
	const develop = state(), source = { async withFrame<Result>(_request: unknown, consume: Parameters<PhotoLibraryDevelopOriginalPortV1['withFrame']>[1]): Promise<Result> {
		assert.equal(this, source); calls++; const frame = rgbaFrame(INPUT); try { return await consume({ photoId: 'photo', revision: 7, frame }) as Result; } finally { frame.pixels.fill(0); }
	} };
	const captured = new Proxy(source.withFrame, { get() { metadata++; throw Error('Function metadata'); } });
	const port: PhotoLibraryDevelopOriginalPortV1['withFrame'] = (request, consume, options) => Reflect.apply(captured, source, [request, consume, options]);
	const loadProxy = async () => createPhotoDevelopRenderRuntimeV3();
	const mounted = await mountPhotoImportUi(() => <StrictMode><PhotoDevelopPreviewCurrentV1 photoId="photo" revision={7} develop={develop} withOriginalFrame={port}
		readPreview={async () => { assert.fail('Preview cache read'); }} loadProxy={loadProxy} beforePresent={gate.promise}
		registerRetirement={retire => { retirees.add(retire); return () => { retirees.delete(retire); }; }} messages={photoDevelopCopy('en')} locale="en" /></StrictMode>);
	try { const old = reactProps(mounted.dom.one('select')).onChange!; Reflect.set(source, 'withFrame', () => { assert.fail('Replacement method'); });
		gate.resolve(); await act(async () => { await settle(); }); assert.deepEqual(painted, [INPUT, AFTER]); assert.equal(calls, 1); assert.equal(metadata, 0);
		const retiring = [...retirees]; await mounted.dispose(); await Promise.all(retiring.map(retire => retire())); old({ currentTarget: { value: 'split' } }); assert.equal(calls, 1);
	} finally { gate.resolve(); if (retirees.size) { const retiring = [...retirees]; await mounted.dispose(); await Promise.all(retiring.map(retire => retire())); } restore(); }
});
