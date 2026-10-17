/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopPreviewV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopPreviewV2.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2, PhotoLibraryDevelopProxyViewV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PixelPreviewPresentationReaderV1 } from '../src/common/editor/controller/shared/pixel-preview-presentation-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

type Mode = 'color' | 'grayscale';
type Paint = Readonly<{ target: object; rgba: readonly number[]; bytes: Uint8ClampedArray }>;
/** Only the canvas platform is controlled here. All projection, rendering,
 * presentation, source joins and wiping use production owners; no native claim. */
function canvasPort() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const;
	const prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), paints: Paint[] = [];
	const sizes = new WeakMap<object, { width: number; height: number }>();
	const size = (target: object) => { let value = sizes.get(target); if (!value) { value = { width: 0, height: 0 }; sizes.set(target, value); } return value; };
	class Context {
		constructor(readonly target: object) {}
		getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; }
		putImageData(image: { data: Uint8ClampedArray }) { paints.push({ target: this.target, rgba: [...image.data], bytes: image.data }); }
	}
	class Canvas {
		get width() { return size(this).width; } set width(value: number) { size(this).width = value; }
		get height() { return size(this).height; } set height(value: number) { size(this).height = value; }
		getContext() { return new Context(this); }
	}
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { paints, size, restore() { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } } };
}
const SOURCE = new Uint8Array(Array.from({ length: 16 }, () => 255));
const DESCRIPTOR = Object.freeze({ schemaVersion: 1 as const, width: 4, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
const AFTER = [233, 233, 233, 255, 248, 248, 248, 255];
const GRAY = [96, 96, 96, 255, 32, 32, 32, 255], COLOR = [255, 48, 48, 96, 255, 48, 48, 32];
function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0, cropWidth: 0.5, flipHorizontal: 1 } })],
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'matte', inputs: [], nodes: [{ id: 'gradient', kind: 'linear-gradient',
			start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' }], maskBindings: [{ effectId: 'tone', maskId: 'mask' }] });
}
async function fixture(locale = 'en', resolution: 'proxy' | 'full' = 'proxy', initialMode: Mode | undefined = undefined, runtime = createPhotoDevelopRenderRuntimeV2(), gate = Promise.resolve()) {
	const canvas = canvasPort(), retirees: (() => Promise<void>)[] = [], develop = recipe(), selection = { maskId: 'mask', effectId: 'tone' };
	let mode = initialMode, shown = true, reads = 0, originals = 0;
	const readPreview: PixelPreviewPresentationReaderV1 = async () => { reads++; return { outcome: 'ready', preview: { photoId: 'photo', tier: 'fit-screen',
		descriptor: DESCRIPTOR, byteLength: SOURCE.byteLength, outputSha256: createHash('sha256').update(SOURCE).digest('hex'), body: new Blob([SOURCE]) }, cache: 'hit', notices: [] }; };
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume, options) => {
		originals++; assert.equal(request.expectedRevision, 7); const pixels = SOURCE.slice();
		try { options?.signal?.throwIfAborted(); return await consume({ photoId: 'photo', revision: 7, frame: { descriptor: DESCRIPTOR, pixels } }); }
		finally { pixels.fill(0); }
	};
	const loadProxy = async () => runtime, registerRetirement = (retire: () => Promise<void>) => { retirees.push(retire); return () => undefined; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewV2 {...{ maskOverlayMode: mode }} photoId="photo" develop={develop}
		readPreview={readPreview} withOriginalFrame={withOriginalFrame} resolution={resolution} revision={7} loadProxy={loadProxy}
		beforePresent={gate} registerRetirement={registerRetirement} messages={photoDevelopCopy(locale)} locale={locale} maskOverlay={shown ? selection : undefined} />);
	const ready = async () => { await waitFor(async () => { await act(async () => { await settle(); });
		return mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state') === 'ready'; }, 'real projected preview readiness'); };
	const painted = (hook: string) => canvas.paints.filter(paint => paint.target === mounted.dom.one(hook));
	return { ...mounted, canvas, develop, selection, painted, ready, reads: () => reads, originals: () => originals,
		async change(next: Mode | undefined) { mode = next; await mounted.render(); }, async hide() { shown = false; await mounted.render(); },
		async cleanup() { try { await mounted.dispose(); await Promise.all(retirees.map(retire => retire())); } finally { canvas.restore(); } } };
}

for (const locale of ['en', 'de']) for (const resolution of ['proxy', 'full'] as const) test(`${locale}/${resolution}: explicit grayscale paints actual selected-stage coverage after crop and flip without changing After`, async () => {
	const f = await fixture(locale, resolution, 'grayscale');
	try {
		await f.ready(); const overlay = f.dom.one('[data-photo-develop-mask-overlay]');
		assert.deepEqual(f.painted('[data-photo-develop-after]').map(paint => paint.rgba), [AFTER]);
		assert.deepEqual(f.painted('[data-photo-develop-mask-overlay]').map(paint => paint.rgba), [GRAY]);
		assert.equal(overlay.getAttribute('data-mode'), 'grayscale'); assert.equal(overlay.getAttribute('aria-label'), locale === 'de' ? 'Graustufenmaske' : 'Grayscale mask');
		assert.equal(reactProps(overlay).hidden, false); assert.equal(overlay.getAttribute('hidden'), null); assert.equal(f.dom.one('[data-photo-develop-after]').getAttribute('role'), 'img');
		assert.equal(f.dom.one('[data-photo-develop-after]').getAttribute('aria-hidden'), null); assert.deepEqual(f.canvas.size(overlay), { width: 2, height: 1 });
		assert.equal(f.reads(), resolution === 'proxy' ? 1 : 0); assert.equal(f.originals(), resolution === 'full' ? 1 : 0);
		assert.deepEqual(f.develop, recipe()); assert.ok(f.canvas.paints.every(paint => paint.bytes.every(value => value === 0))); assert.ok(SOURCE.every(value => value === 255));
	} finally { await f.cleanup(); }
});

test('omitted mode retains byte-exact legacy color and removing selection clears the target without changing recipe or After semantics', async () => {
	const f = await fixture('en', 'proxy', undefined);
	try {
		await f.ready(); const overlay = f.dom.one('[data-photo-develop-mask-overlay]');
		assert.deepEqual(f.painted('[data-photo-develop-mask-overlay]').map(paint => paint.rgba), [COLOR]);
		assert.equal(overlay.getAttribute('data-mode'), 'color'); assert.equal(overlay.getAttribute('aria-label'), photoDevelopLocalAdjustmentsCopy('en').maskOverlay);
		await f.hide(); await f.ready(); assert.equal(f.dom.find('[data-photo-develop-mask-overlay]'), null); assert.deepEqual(f.canvas.size(overlay), { width: 0, height: 0 });
		assert.deepEqual(f.painted('[data-photo-develop-after]').map(paint => paint.rgba), [AFTER, AFTER]); assert.deepEqual(f.develop, recipe());
	} finally { await f.cleanup(); }
});

test('mode changes abort and join an actual held rendered scope before the replacement; display fields never reach the renderer', async () => {
	const real = createPhotoDevelopRenderRuntimeV2(), release = deferred<void>(), requests: string[][] = [];
	const state: { borrowed?: PhotoLibraryDevelopProxyViewV2; signal?: AbortSignal; entered: boolean; calls: number; retired: boolean } = { entered: false, calls: 0, retired: false };
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = {
		async withProxy(request, consume) { requests.push(Object.keys(request).sort()); state.calls++;
			return real.withProxy(request, async output => {
				if (state.calls === 1) { state.borrowed = output; state.signal = request.signal; state.entered = true; try { await release.promise; return await consume(output); } finally { state.retired = true; } }
				return consume(output);
			}); }, withFullResolution: real.withFullResolution,
	};
	const f = await fixture('en', 'proxy', 'color', runtime);
	try {
		await act(async () => { await waitFor(() => state.entered, 'actual render scope held before delivery'); });
		assert.deepEqual([...state.borrowed!.maskOverlay!.coverage], [96, 32]); await f.change('grayscale'); await act(async () => { await settle(3); });
		assert.equal(state.signal!.aborted, true); assert.equal(state.calls, 1); assert.equal(f.reads(), 1); assert.equal(state.retired, false);
		assert.equal(f.painted('[data-photo-develop-after]').length, 0); assert.equal(f.painted('[data-photo-develop-mask-overlay]').length, 0);
		assert.deepEqual([...state.borrowed!.maskOverlay!.coverage], [96, 32]); release.resolve(); await f.ready();
		assert.equal(state.retired, true); assert.equal(state.calls, 2); assert.equal(f.reads(), 2);
		assert.ok(state.borrowed!.frame.pixels.every(value => value === 0)); assert.ok(state.borrowed!.maskOverlay!.coverage.every(value => value === 0));
		assert.deepEqual(f.painted('[data-photo-develop-after]').map(paint => paint.rgba), [AFTER]);
		assert.deepEqual(f.painted('[data-photo-develop-mask-overlay]').map(paint => paint.rgba), [GRAY]);
		assert.deepEqual(requests, [ ['develop', 'frame', 'maskOverlay', 'signal'], ['develop', 'frame', 'maskOverlay', 'signal'] ]);
	} finally { release.resolve(); await f.cleanup(); }
});

test('selection and grayscale mode are captured before the external barrier and painted backings retire on joined disposal', async () => {
	const gate = deferred<void>(), f = await fixture('en', 'proxy', 'grayscale', createPhotoDevelopRenderRuntimeV2(), gate.promise);
	try {
		f.selection.maskId = 'changed'; f.selection.effectId = 'changed'; await act(async () => { await settle(); }); assert.equal(f.reads(), 0);
		gate.resolve(); await f.ready(); assert.deepEqual(f.painted('[data-photo-develop-mask-overlay]').map(paint => paint.rgba), [GRAY]);
		assert.deepEqual(f.painted('[data-photo-develop-after]').map(paint => paint.rgba), [AFTER]);
	} finally { gate.resolve(); await f.cleanup(); }
	assert.ok(f.canvas.paints.every(paint => paint.bytes.every(value => value === 0)));
});
