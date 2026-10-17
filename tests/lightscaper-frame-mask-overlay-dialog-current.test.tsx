/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import FramescaperImageDevelopDialogV1, { type FramescaperImageDevelopDialogPropsV1 } from '../src/common/editor/ui/dialogs/FramescaperImageDevelopDialogV1.tsx';
import type { WithImageDevelopDraftFrameV1 } from '../src/common/editor/controller/shared/image-develop-draft-presentation-v1.ts';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

const AFTER = [188, 188, 188, 255, 0, 0, 0, 255];
function recipe() {
	const base = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
		target: { x: .5, y: .5 }, source: { x: 1 / 6, y: .5 }, radius: .2, feather: 0, opacity: 1 }] });
	return normalizeImageDevelopStateCurrentV1({ ...base, effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 1 / 3, cropWidth: 2 / 3, flipHorizontal: 1 } })],
		masks: [{ schemaVersion: 1, id: 'range', kind: 'matte', inputs: [], nodes: [{ id: 'range', kind: 'luminance-range', lower: .9, upper: 1, falloff: 0 }], outputNodeId: 'range' },
			{ schemaVersion: 1, id: 'donor', kind: 'matte', inputs: [], nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' }],
		maskBindings: [{ maskId: 'range', effectId: 'tone' }] });
}
// Only the native Canvas boundary is modeled here. The actual shared repair,
// mask, geometry and display kernels run; browser cases own physical 2D proof.
function paintBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const planes = new Map<object, { width: number; height: number; pixels: number[] }>();
	const plane = (value: object) => { let found = planes.get(value); if (!found) { found = { width: 0, height: 0, pixels: [] }; planes.set(value, found); } return found; };
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	class Context { constructor(readonly canvas: object) {} getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; }
		putImageData(value: Image) { plane(this.canvas).pixels = [...value.data]; } }
	class Canvas { get width() { return plane(this).width; } set width(value: number) { plane(this).width = value; plane(this).pixels = []; }
		get height() { return plane(this).height; } set height(value: number) { plane(this).height = value; plane(this).pixels = []; }
		getContext() { return new Context(this); } }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { planes, restore() { for (const [index, key] of keys.entries()) { const descriptor = prior[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}
async function fixture(locale = 'en', strict = false) {
	const painting = paintBoundary(), applied: Readonly<ImageDevelopStateCurrentV1>[] = [], retired = new Set<() => Promise<void>>();
	const initial = recipe(), backings: Uint8Array[] = [], entered = deferred<void>(), release = deferred<void>(); let hold = false, holdBefore = false, reached = false, current = true, closes = 0, calls = 0;
	let failure: Readonly<{ value: unknown }> | null = null;
	let props: FramescaperImageDevelopDialogPropsV1;
	const render: WithImageDevelopDraftFrameV1 = async (request, consume, options) => {
		calls++; const frame = rgbaFrame([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]); backings.push(frame.pixels);
		try { if (failure) { const value = failure.value; failure = null; throw value; }
			return await withImageDevelopFrameV3({ frame, ...request, signal: options?.signal }, async output => {
			backings.push(output.frame.pixels as Uint8Array); if (output.maskOverlay) backings.push(output.maskOverlay.coverage);
			if (holdBefore) { holdBefore = false; reached = true; entered.resolve(); await release.promise; }
			const result = await consume(output); if (hold) { hold = false; reached = true; entered.resolve(); await release.promise; } return result;
		}, PROFILE); } finally { frame.pixels.fill(0); }
	};
	const mounted = await mountPhotoImportUi(() => {
		const element = <FramescaperImageDevelopDialogV1 kind="masks" develop={initial} locale={locale} disabled={false} withDraftFrame={render}
			withOriginalFrame={() => assert.fail('Mask presentation must borrow the native rendered draft capability.')} isCurrent={() => current}
			onApply={function(this: FramescaperImageDevelopDialogPropsV1, value) { assert.equal(this, props); applied.push(value); }}
			onClose={function(this: FramescaperImageDevelopDialogPropsV1) { assert.equal(this, props); closes++; }}
			registerRetirement={retire => { retired.add(retire); return () => { retired.delete(retire); }; }} />;
		props = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	}).catch((error: unknown) => { painting.restore(); throw error; });
	const text = photoDevelopMaskManagementCopy(locale);
	const control = (label: string) => { const found = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label); assert.ok(found, label); return found; };
	const change = async (label: string, value: string | boolean) => { await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); await settle(); }); };
	const click = async (label: string) => { const found = mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === label).at(-1); assert.ok(found, label);
		await act(async () => { reactProps(found).onClick?.({}); await settle(); }); };
	const ready = (minimumCalls = 1) => waitFor(async () => { await act(async () => { await settle(); }); return calls >= minimumCalls && mounted.dom.one('[data-frame-image-develop-preview]').getAttribute('data-state') === 'ready'; }, 'Frame draft canvas and native callback retire');
	const selectRange = async () => { await change(text.mask, 'range'); const value: unknown = Object.getOwnPropertyDescriptor(reactProps(control(text.mask)), 'value')?.value;
		assert.equal(value, 'range', 'Select the actual bound mask; canonical mask order is independent of fixture construction order.'); };
	return { ...mounted, painting, initial, backings, applied, text, control, change, click, ready, selectRange, entered, release,
		closes: () => closes, calls: () => calls, hold() { hold = true; }, reached: () => reached,
		holdBefore() { holdBefore = true; }, staleWithoutRender() { current = false; }, failNext(value: unknown) { failure = { value }; },
		retirements: () => [...retired],
		async stale() { current = false; await mounted.render(); },
		async dispose() { release.resolve(); const joining = [...retired].map(retire => retire());
			try { await mounted.dispose(); await Promise.allSettled(joining); } finally { painting.restore(); } } };
}

for (const locale of ['en', 'de']) test(`${locale}: Frame opted mask dialog renders its repaired draft with default-off live color/grayscale coverage and no publication`, async () => {
	const f = await fixture(locale);
	try {
		await f.ready(); assert.equal(f.control(f.text.showOverlay).checked, false);
		const after = f.dom.one('[data-frame-image-develop-after]'); assert.deepEqual(f.painting.planes.get(after)?.pixels, AFTER);
		await f.selectRange();
		await f.change(f.text.showOverlay, true); assert.equal(f.applied.length, 0);
		const beforeOverlay = f.calls(); await f.change(f.text.overlayEffect, 'tone'); await f.ready(beforeOverlay + 1);
		const overlay = f.dom.one('[data-photo-develop-mask-overlay]'); assert.deepEqual(f.painting.planes.get(overlay)?.pixels, [255, 48, 48, 255, 255, 48, 48, 0]);
		const beforeGrayscale = f.calls(); await f.change(f.text.displayMode, 'grayscale'); await f.ready(beforeGrayscale + 1); assert.deepEqual(f.painting.planes.get(overlay)?.pixels, [255, 255, 255, 255, 0, 0, 0, 255]);
		assert.deepEqual(f.painting.planes.get(after)?.pixels, AFTER); assert.equal(f.applied.length, 0); assert.equal(Object.hasOwn(f.initial, 'maskOverlay'), false);
		const beforeOff = f.calls(); await f.change(f.text.showOverlay, false); await f.ready(beforeOff + 1); assert.equal(f.painting.planes.get(overlay)?.width, 0);
		assert.equal(f.backings.every(bytes => bytes.every(byte => byte === 0)), true); await f.click(f.text.close);
		await waitFor(() => f.closes() === 1, 'Frame mask Close retires presentation'); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
});

test('Frame composition previews its complete local graph then joins held rendering before exact recipe-only Apply', async () => {
	const f = await fixture();
	try {
		await f.ready(); await f.selectRange(); await f.change(f.text.showOverlay, true);
		const beforeOverlay = f.calls(); await f.change(f.text.overlayEffect, 'tone'); await f.ready(beforeOverlay + 1);
		await f.change(f.text.operand, 'donor'); f.hold(); await f.click(f.text.add);
		await waitFor(f.reached, 'Frame local composition reaches its held actual render');
		assert.equal(f.applied.length, 0); assert.equal(f.initial.masks.find(mask => mask.id === 'range')!.nodes.length, 1);
		await f.click(f.text.apply); assert.equal(f.applied.length, 0); f.release.resolve();
		await waitFor(() => f.applied.length === 1, 'Frame Apply waits for its actual renderer');
		assert.equal(f.applied[0]!.masks.find(mask => mask.id === 'range')!.nodes.length, 3); assert.equal(Object.hasOwn(f.applied[0]!, 'maskOverlay'), false);
		assert.equal(Object.hasOwn(f.applied[0]!, 'displayMode'), false); assert.deepEqual(f.applied[0]!.geometry, f.initial.geometry);
		assert.equal(f.backings.every(bytes => bytes.every(byte => byte === 0)), true);
	} finally { await f.dispose(); }
});

test('stale Frame source clears its canvases, disables Apply and keeps joined footer Close available', async () => {
	const f = await fixture();
	try { await f.ready(); await f.selectRange(); await f.change(f.text.showOverlay, true);
		const beforeOverlay = f.calls(); await f.change(f.text.overlayEffect, 'tone'); await f.ready(beforeOverlay + 1);
		const canvas = f.dom.one('[data-frame-image-develop-after]'); await f.stale();
		assert.equal(f.painting.planes.get(canvas)?.width, 0); await f.click(f.text.apply); assert.equal(f.applied.length, 0);
		await f.click(f.text.close); await waitFor(() => f.closes() === 1, 'stale Frame footer Close remains accessible');
	} finally { await f.dispose(); }
});

test('failed opaque native preview hands joined footer Close to the outer owner while registered retirement retains the exact failure', async () => {
	const f = await fixture(), { proxy, revoke } = Proxy.revocable({}, {}); revoke();
	try {
		await f.ready(); await f.selectRange(); f.failNext(proxy); await f.change(f.text.showOverlay, true); await f.change(f.text.overlayEffect, 'tone');
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.one('[data-frame-image-develop-preview]').getAttribute('data-state') === 'failed'; }, 'opaque native preview failure is presented');
		await f.click(f.text.apply); assert.equal(f.applied.length, 0); const retirements = f.retirements(); assert.equal(retirements.length, 1);
		await f.click(f.text.close); await waitFor(() => f.closes() === 1, 'failed preview still hands off joined outer Close');
		const result = await retirements[0]!().then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, proxy), true);
		assert.equal(f.applied.length, 0); assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.dispose(); }
});

test('source becoming stale inside a held actual render without a prior React update still permits joined footer dismissal', async () => {
	const f = await fixture();
	try {
		await f.ready(); await f.selectRange(); f.holdBefore(); await f.change(f.text.showOverlay, true); await f.change(f.text.overlayEffect, 'tone');
		await waitFor(f.reached, 'stale regression reaches the held genuine renderer'); f.staleWithoutRender(); f.release.resolve();
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.one('[data-frame-image-develop-preview]').getAttribute('data-state') === 'failed'; }, 'held source staleness is presented');
		await f.click(f.text.close); await waitFor(() => f.closes() === 1, 'stale failed preview hands off joined outer Close');
		assert.equal(f.applied.length, 0); assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.dispose(); }
});

test('StrictMode mask presenter joins its replay before the sole usable native render and registers retirement', async () => {
	const f = await fixture('en', true);
	try { await f.ready(); assert.equal(f.calls(), 1); await f.click(f.text.close); await waitFor(() => f.closes() === 1, 'StrictMode Frame presenter Close');
		assert.equal(f.backings.every(bytes => bytes.every(byte => byte === 0)), true);
	} finally { await f.dispose(); }
});
