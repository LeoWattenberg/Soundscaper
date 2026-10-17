/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import FramescaperImageBrushMaskEditorV1, { type FramescaperImageBrushMaskEditorPropsV1 } from '../src/common/editor/ui/dialogs/FramescaperImageBrushMaskEditorV1.tsx';
import type { WithImageBrushMaskDraftFrameV1 } from '../src/common/editor/image-brush-mask-resource-port-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1, withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { framescaperImageBrushMaskCopyV1 } from '../src/common/i18n/framescaper-image-brush-mask-copy-v1.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const BASE = [255, 255, 255, 255, 0, 0, 0, 255], PAINTED = [188, 188, 188, 255, 0, 0, 0, 255];
function recipe() {
	const repair = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
		target: { x: .5, y: .5 }, source: { x: 1 / 6, y: .5 }, radius: .2, feather: 0, opacity: 1 }] });
	return normalizeImageDevelopStateCurrentV1({ ...repair, effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', enabled: false, params: { exposure: -1 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 1 / 3, cropWidth: 2 / 3, flipHorizontal: 1 } })] });
}
function canvasBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const planes = new Map<object, { width: number; height: number; pixels: number[] }>();
	const plane = (target: object) => { let found = planes.get(target); if (!found) { found = { width: 0, height: 0, pixels: [] }; planes.set(target, found); } return found; };
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	class Context { constructor(readonly canvas: object) {} getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; }
		putImageData(value: Image) { plane(this.canvas).pixels = [...value.data]; } }
	class Canvas { get width() { return plane(this).width; } set width(value: number) { plane(this).width = value; plane(this).pixels = []; }
		get height() { return plane(this).height; } set height(value: number) { plane(this).height = value; plane(this).pixels = []; } getContext() { return new Context(this); } }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { planes, restore() { for (const [index, key] of keys.entries()) { const descriptor = prior[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}
// The Canvas/native-callback boundary is modeled. Real replay/resource hashing,
// process3 repair, effect-input mask, geometry and display engines execute here.
// Selected Frame store/codec/lease qualification belongs to native/browser tests.
async function fixture(locale = 'en', strict = false, initial = recipe(), seeded: readonly Readonly<{ reference: Readonly<BrushMaskResourceReferenceV1>; bytes: Uint8Array<ArrayBuffer> }>[] = []) {
	const painting = canvasBoundary(), bodies = new Map(seeded.map(value => [value.reference.storageKey, value.bytes.slice()] as const)), backings: Uint8Array[] = [], applied: Readonly<ImageDevelopStateCurrentV1>[] = [];
	const renderEntered = deferred<void>(), renderRelease = deferred<void>(), installEntered = deferred<void>(), installRelease = deferred<void>();
	const retired = new Set<() => Promise<void>>(), closeCalls = [0, 0]; let closeVersion = 0, current = true, disabled = false, closes = 0, calls = 0, installs = 0, holdRender = false, holdInstall = false, renderReached = false;
	let failure: Readonly<{ value: unknown }> | null = null, receiptProjectId = 'frame-project', develop = initial, props: FramescaperImageBrushMaskEditorPropsV1;
	const source: FramescaperImageBrushMaskEditorPropsV1['port']['source'] = { async withBytes(reference, consume) {
		assert.equal(this, source); const saved = bodies.get(reference.storageKey); assert.ok(saved); const bytes = saved.slice(); backings.push(bytes);
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
	const port: FramescaperImageBrushMaskEditorPropsV1['port'] = { schemaVersion: 1, projectId: 'frame-project', source, async install(referenceValue, bytesValue) {
		assert.equal(this, port); const reference = referenceValue as Readonly<BrushMaskResourceReferenceV1>, bytes = bytesValue as Uint8Array<ArrayBuffer>;
		await withBrushMaskResourceV1({ reference, bytes }, () => undefined); const created = !bodies.has(reference.storageKey);
		if (created) bodies.set(reference.storageKey, bytes.slice()); installs++; backings.push(bytes);
		if (holdInstall) { holdInstall = false; installEntered.resolve(); await installRelease.promise; }
		return { schemaVersion: 1, projectId: receiptProjectId, reference, created, notices: [] };
	} };
	const render: WithImageBrushMaskDraftFrameV1 = async (request, consume, options) => {
		calls++; backings.push(request.bytes);
		await withBrushMaskResourceV1({ reference: request.reference, bytes: request.bytes, signal: options?.signal }, () => undefined);
		const frame = rgbaFrame([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]); backings.push(frame.pixels);
		const maskSource: MaskRasterSourcePortV1 = { async withBytes<Result>(reference: Readonly<BrushMaskResourceReferenceV1>, accept: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>): Promise<Result> {
			const bytes = reference.storageKey === request.reference.storageKey ? request.bytes.slice() : bodies.get(reference.storageKey)!.slice(); backings.push(bytes);
			try { return await accept(bytes); } finally { bytes.fill(0); }
		} };
		try { if (failure) { const value = failure.value; failure = null; throw value; }
			return await withImageDevelopFrameV3({ frame, develop: request.develop, ...(request.maskOverlay ? { maskOverlay: request.maskOverlay } : {}), signal: options?.signal }, async output => {
				backings.push(output.frame.pixels as Uint8Array); if (output.maskOverlay) backings.push(output.maskOverlay.coverage);
				if (holdRender) { holdRender = false; renderReached = true; renderEntered.resolve(); await renderRelease.promise; }
				return consume(output);
			}, PROFILE, { maskSource });
		} finally { frame.pixels.fill(0); }
	};
	const mounted = await mountPhotoImportUi(() => {
		const version = closeVersion;
		const element = <FramescaperImageBrushMaskEditorV1 port={port} develop={develop} locale={locale} disabled={disabled} withBrushDraftFrame={render}
			isCurrent={() => current} onApply={function(this: FramescaperImageBrushMaskEditorPropsV1, value) { assert.equal(this, props); applied.push(value); }}
			onClose={function(this: FramescaperImageBrushMaskEditorPropsV1) { assert.equal(this, props); closes++; closeCalls[version] = closeCalls[version]! + 1; }}
			registerRetirement={retire => { retired.add(retire); return () => { retired.delete(retire); }; }} />;
		props = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	}).catch((error: unknown) => { painting.restore(); throw error; });
	const text = framescaperImageBrushMaskCopyV1(locale), modes = photoDevelopMaskManagementCopy(locale);
	const control = (label: string) => { const found = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label); assert.ok(found, label); return found; };
	const change = async (label: string, value: string | boolean) => { await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); await settle(); }); };
	const button = (label: string) => { const found = mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === label).at(-1); assert.ok(found, label); return found; };
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); await settle(); }); };
	const ready = (minimumCalls = 1) => waitFor(async () => { await act(async () => { await settle(); }); return calls >= minimumCalls && mounted.dom.one('[data-frame-image-brush-preview]').getAttribute('data-state') === 'ready'
		&& mounted.dom.one('[data-image-brush-mask-grid]').getAttribute('data-state') === 'ready'; }, 'Frame brush replay/native/display scopes retire');
	const published = () => waitFor(async () => { await act(async () => { await settle(); }); return applied.length === 1; }, 'Frame brush ACK and joined publication');
	const dismissed = () => waitFor(async () => { await act(async () => { await settle(); }); return closes === 1; }, 'Frame brush joined dismissal');
	const binding = () => mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label')?.startsWith(`${text.bind}: `))!;
	const enabled = () => mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label')?.startsWith(`${text.effectEnabled}: `))!;
	const grid = async () => { await ready(); await change(text.width, '2'); await change(text.height, '1'); await click(text.create); await ready();
		for (const [label, value] of [[text.radius, '.25'], [text.hardness, '1'], [text.opacity, '1'], [text.x, '.75'], [text.y, '.5']]) await change(label!, value!); };
	return { ...mounted, painting, bodies, backings, applied, initial, text, modes, port, render, control, change, button, click, ready, published, dismissed, grid, binding, enabled,
		renderEntered, renderRelease, installEntered, installRelease, calls: () => calls, installs: () => installs, closes: () => closes, renderReached: () => renderReached,
		holdRender() { holdRender = true; }, holdInstall() { holdInstall = true; }, failNext(value: unknown) { failure = { value }; }, wrongProject() { receiptProjectId = 'other-frame-project'; },
		retirements: () => [...retired], async stale() { current = false; await mounted.render(); }, staleWithoutRender() { current = false; },
		async rerenderClose() { closeVersion = 1; disabled = true; await mounted.render(); }, closeCalls: () => [...closeCalls],
		async replace(next: Readonly<ImageDevelopStateCurrentV1>, blocked = false) { develop = next; disabled = blocked; await mounted.render(); },
		async seed(reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>) { bodies.set(reference.storageKey, bytes.slice()); },
		async dispose() { renderRelease.resolve(); installRelease.resolve(); const joining = [...retired].map(retire => retire());
			try { await mounted.dispose(); await Promise.allSettled(joining); } finally { painting.restore(); } } };
}

for (const locale of ['en', 'de']) test(`${locale}: Frame brush keyboard paint/erase/undo/redo previews literal effect-input coverage without installing or publishing per stroke`, async () => {
	const f = await fixture(locale);
	try { await f.grid(); assert.equal(f.control(f.text.showOverlay).checked, false); assert.deepEqual(f.painting.planes.get(f.dom.one('[data-frame-image-brush-after]'))?.pixels, BASE);
		await f.change(f.binding().getAttribute('aria-label')!, true); await f.change(f.enabled().getAttribute('aria-label')!, true); await f.ready();
		const before = f.calls(); await f.click(f.text.stamp); await f.ready(before + 1); assert.deepEqual(f.painting.planes.get(f.dom.one('[data-frame-image-brush-after]'))?.pixels, PAINTED);
		await f.change(f.text.mode, 'erase'); await f.change(f.text.opacity, '.5'); await f.click(f.text.stamp); await f.ready();
		await f.click(f.text.undo); await f.ready(); await f.click(f.text.redo); await f.ready(); await f.click(f.text.undo); await f.ready();
		await f.change(f.text.showOverlay, true); await f.change(f.text.overlayEffect, 'tone'); await f.ready();
		// Nearest sampling maps the 2-wide [0,255] grid to [0,0,255]
		// at the 3-wide effect input; subsequent crop/flip projects [255,0].
		const overlay = f.dom.one('[data-photo-develop-mask-overlay]'); assert.deepEqual(f.painting.planes.get(overlay)?.pixels, [255, 48, 48, 255, 255, 48, 48, 0]);
		await f.change(f.modes.displayMode, 'grayscale'); await f.ready(); assert.deepEqual(f.painting.planes.get(overlay)?.pixels, [255, 255, 255, 255, 0, 0, 0, 255]);
		assert.equal(f.installs(), 0); assert.equal(f.bodies.size, 0); assert.equal(f.applied.length, 0);
		await f.click(f.text.apply); await f.published();
		assert.equal(f.installs(), 1); assert.equal(f.applied[0]!.processVersion, 3); if (f.applied[0]!.processVersion === 3 && f.initial.processVersion === 3) assert.deepEqual(f.applied[0]!.repairs, f.initial.repairs);
		assert.equal(Object.hasOwn(f.applied[0]!, 'maskOverlay'), false); assert.equal(Object.hasOwn(f.applied[0]!, 'displayMode'), false);
		assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.dispose(); }
});

test('Frame brush Apply joins a held actual preview before acquiring the native immutable writer', async () => {
	const f = await fixture();
	try { await f.grid(); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready(); f.holdRender(); await f.click(f.text.stamp); await f.renderEntered.promise;
		await f.click(f.text.apply); assert.equal(f.installs(), 0); assert.equal(f.applied.length, 0);
		await act(async () => { f.renderRelease.resolve(); await settle(); }); await f.published(); assert.equal(f.installs(), 1);
	} finally { await f.dispose(); }
});

test('Frame brush Close joins a held durable native ACK, preserves its body and suppresses retained recipe publication', async () => {
	const f = await fixture();
	try { await f.grid(); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready(); await f.click(f.text.stamp); await f.ready(); f.holdInstall();
		const retained = reactProps(f.button(f.text.apply)).onClick!; await f.click(f.text.apply); await f.installEntered.promise; await f.click(f.text.close);
		assert.equal(f.closes(), 0); assert.equal(f.bodies.size, 1); const joined = Promise.allSettled(f.retirements().map(retire => retire())); assert.equal(await remainsPending(joined), true);
		await act(async () => { retained({}); await settle(); }); await act(async () => { f.installRelease.resolve(); await joined; await settle(); }); await f.dismissed();
		assert.equal(f.applied.length, 0); assert.equal(f.installs(), 1); assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.dispose(); }
});

test('stale or failed Frame brush preview clears all canvases and still hands joined Close to its outer owner', async () => {
	const f = await fixture(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	try { await f.grid(); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready(); f.failNext(revoked.proxy); await f.click(f.text.stamp);
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.one('[data-frame-image-brush-preview]').getAttribute('data-state') === 'failed'; }, 'opaque Frame brush preview failure');
		await f.stale(); await f.click(f.text.apply); assert.equal(f.installs(), 0); await f.click(f.text.close); await f.dismissed();
		for (const plane of f.painting.planes.values()) assert.equal(plane.width, 0); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
});

test('Frame Close invokes the latest same-generation callback once after a held native ACK joins through parent rerender', async () => {
	const f = await fixture();
	try { await f.grid(); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready(); await f.click(f.text.stamp); await f.ready(); f.holdInstall();
		await f.click(f.text.apply); await f.installEntered.promise; await f.click(f.text.close); await f.rerenderClose();
		assert.equal(f.closes(), 0); await act(async () => { f.installRelease.resolve(); await settle(); }); await f.dismissed();
		assert.deepEqual(f.closeCalls(), [0, 1]); assert.equal(f.applied.length, 0); await f.click(f.text.close); assert.equal(f.closes(), 1);
	} finally { await f.dispose(); }
});

for (const nodeKind of ['alpha', 'raster'] as const) test(`Frame re-edit preserves installed ${nodeKind} graph metadata, predecessor body and process3 repairs`, async () => {
	const prepared = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	const graph = { schemaVersion: 2, id: 'retained-brush', name: 'Original name', kind: 'matte', inputs: [{ name: 'retained-input', kind: nodeKind, sourceRef: prepared.reference.storageKey }],
		nodes: [{ id: 'retained-output', kind: nodeKind, inputName: 'retained-input', ...(nodeKind === 'raster' ? { channel: 'alpha' } : {}) }], outputNodeId: 'retained-output' };
	const initial = normalizeImageDevelopStateCurrentV1({ ...recipe(), masks: [graph], maskBindings: [{ effectId: 'tone', maskId: graph.id }] }), f = await fixture('en', false, initial, [prepared]);
	try { await f.ready(); await f.change(f.text.mask, graph.id); await f.ready();
		assert.equal(f.control(f.text.width).hasAttribute('disabled'), true); const before = f.bodies.get(prepared.reference.storageKey)!.slice();
		for (const [label, value] of [[f.text.mode, 'erase'], [f.text.radius, '.25'], [f.text.hardness, '1'], [f.text.opacity, '.5'], [f.text.x, '.75'], [f.text.y, '.5']]) await f.change(label!, value!);
		await f.click(f.text.stamp); await f.ready(); await f.click(f.text.apply); await f.published();
		const authored = f.applied[0]!.masks.find(mask => mask.id === graph.id)!;
		assert.equal(authored.schemaVersion, 2); if (authored.schemaVersion === 2) assert.equal(authored.name, graph.name);
		assert.equal(authored.kind, graph.kind); assert.equal(authored.outputNodeId, graph.outputNodeId); assert.deepEqual(authored.nodes, initial.masks[0]!.nodes);
		assert.equal(authored.inputs[0]!.name, graph.inputs[0]!.name); assert.equal(authored.inputs[0]!.kind, nodeKind);
		assert.notEqual(authored.inputs[0]!.sourceRef, prepared.reference.storageKey); assert.deepEqual(f.bodies.get(prepared.reference.storageKey), before);
		const reference = normalizeBrushMaskResourceReferenceV1(authored.inputs[0]!.sourceRef);
		assert.deepEqual(await f.port.source.withBytes(reference, bytes => withBrushMaskResourceV1({ reference, bytes }, resource => [...resource.alpha])), [0, 127]);
	} finally { prepared.bytes.fill(0); await f.dispose(); }
});

test('Frame pointer painting uses the grid rectangle and discards cancelled gestures without a body installation', async () => {
	const f = await fixture();
	try { await f.grid(); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready();
		const canvas = f.dom.one('[data-image-brush-mask-grid]'); let captured = false;
		Object.defineProperties(canvas, { getBoundingClientRect: { value: () => ({ left: 100, top: 200, width: 400, height: 200 }) },
			setPointerCapture: { value: () => { captured = true; } }, hasPointerCapture: { value: () => captured }, releasePointerCapture: { value: () => { captured = false; } } });
		const event = { currentTarget: canvas, pointerId: 9, button: 0, clientX: 400, clientY: 300, preventDefault() {} };
		await act(async () => { reactProps(canvas).onPointerDown?.(event); reactProps(canvas).onPointerCancel?.(event); reactProps(canvas).onPointerUp?.(event); await settle(); });
		assert.equal(captured, false); assert.equal(f.installs(), 0);
		const before = f.calls(); await act(async () => { reactProps(canvas).onPointerDown?.(event); reactProps(canvas).onPointerMove?.(event); reactProps(canvas).onPointerUp?.(event); await settle(); });
		await f.ready(before + 1); assert.equal(captured, false); assert.equal(f.installs(), 0); await f.click(f.text.apply);
		await f.published(); const source = f.applied[0]!.masks[0]!.inputs[0]!.sourceRef;
		const reference = normalizeBrushMaskResourceReferenceV1(source);
		assert.deepEqual(await f.port.source.withBytes(reference, bytes => withBrushMaskResourceV1({ reference, bytes }, resource => [...resource.alpha])), [0, 255]);
	} finally { await f.dispose(); }
});

test('Frame brush refuses another project ACK and retained handlers after source replacement before publishing', async () => {
	const f = await fixture();
	try { await f.grid(); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready();
		const retained = reactProps(f.button(f.text.apply)).onClick!; await f.replace(recipe()); await f.ready(); await act(async () => { retained({}); await settle(); });
		assert.equal(f.installs(), 0); await f.change(f.binding().getAttribute('aria-label')!, false); await f.change(f.binding().getAttribute('aria-label')!, true); await f.ready(); f.wrongProject(); await f.click(f.text.apply);
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.find('[role="alert"]') !== null; }, 'Frame brush ACK owner refusal');
		assert.equal(f.applied.length, 0); assert.equal(f.installs(), 1); await f.click(f.text.close); await f.dismissed();
	} finally { await f.dispose(); }
});

test('StrictMode Frame brush replacement joins its predecessor before one usable native preview', async () => {
	const f = await fixture('en', true);
	try { await f.ready(); assert.equal(f.calls(), 1); await f.click(f.text.close); await f.dismissed();
		assert.equal(f.installs(), 0); assert.ok(f.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await f.dispose(); }
});
