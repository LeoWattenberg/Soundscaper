/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopRepairSpotsDialogV1, { type PhotoDevelopRepairSpotsDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopRepairSpotsDialogV1.tsx';
import PhotoDevelopLocalAdjustmentsMenuV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopLocalAdjustmentsMenuV1.tsx';
import PhotoDevelopSettingsMenuV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopSettingsMenuV2.tsx';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

function labels(locale = 'en') {
	return locale === 'de' ? { menu: 'Flecken reparieren…', mode: 'Modus', add: 'Fleck hinzufügen', remove: 'Fleck entfernen', spot: 'Fleck',
		targetX: 'Ziel X', targetY: 'Ziel Y', sourceX: 'Quelle X', sourceY: 'Quelle Y', radius: 'Radius', feather: 'Weicher Rand', opacity: 'Deckkraft',
		enabled: 'Aktiviert', tool: 'Bewegen', visualize: 'Flecken visualisieren', threshold: 'Kanten-Schwellenwert', apply: 'Reparaturen anwenden', close: 'Schließen' }
		: { menu: 'Repair spots…', mode: 'Mode', add: 'Add spot', remove: 'Remove spot', spot: 'Spot', targetX: 'Target X', targetY: 'Target Y',
			sourceX: 'Source X', sourceY: 'Source Y', radius: 'Radius', feather: 'Feather', opacity: 'Opacity', enabled: 'Enabled', tool: 'Move',
			visualize: 'Visualize spots', threshold: 'Edge threshold', apply: 'Apply repairs', close: 'Close' };
}
function donors() {
	const pixels = Array.from({ length: 33 }, (_, index) => { const x = index % 11, v = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0; return [v, v, v, 255]; }).flat();
	pixels.splice(12 * 4, 4, 64, 64, 64, 255); pixels.splice(16 * 4, 4, 192, 192, 192, 255); pixels.splice(20 * 4, 4, 0, 0, 0, 255); return pixels;
}
/** The UI test owns only the native paint boundary and Original port. Real
 * source authentication is qualified by the presentation and selected-session tests. */
function nativeBoundary(painted: number[][]) {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(value: { data: Uint8ClampedArray }) { painted.push([...value.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } };
}
async function dialog(locale = 'en', pixels = donors(), width = 11, strict = false) {
	const painted: number[][] = [], restore = nativeBoundary(painted), marker = deferred<void>(), release = deferred<void>(), retirements = new Set<() => Promise<void>>(), backings: Uint8Array[] = [];
	const applied: Parameters<PhotoDevelopRepairSpotsDialogPropsV1['onApply']>[0][] = [];
	let current = true, holding = false, closes = 0, sourceCalls = 0, rendered: PhotoDevelopRepairSpotsDialogPropsV1, develop: PhotoDevelopRepairSpotsDialogPropsV1['develop'] = defaultImageDevelopStateV2();
	const original: PhotoLibraryDevelopOriginalPortV1 = { async withFrame(request, consume, options) {
		assert.equal(this, original); assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 7 }); sourceCalls++;
		const frame = rgbaFrame(pixels); frame.descriptor = Object.freeze({ ...frame.descriptor, width, height: pixels.length / (width * 4) }); backings.push(frame.pixels);
		try { if (holding) { holding = false; marker.resolve(); await release.promise; } options?.signal?.throwIfAborted(); return await consume({ photoId: 'photo', revision: 7, frame }); }
		finally { frame.pixels.fill(0); }
	} };
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopRepairSpotsDialogV1 photoId="photo" revision={7} develop={develop} original={original} locale={locale} isCurrent={() => current}
			onApply={function (this: unknown, value) { assert.equal(this, rendered); applied.push(value); }} onClose={() => { closes++; }}
			registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />;
		rendered = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	});
	const text = labels(locale);
	const control = (name: string) => { const node = mounted.dom.container.querySelectorAll('input,select').find(value => value.getAttribute('aria-label') === name); assert.ok(node, name); return node; };
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').filter(value => value.textContent === name).at(-1); assert.ok(node, name); return node; };
	const change = async (name: string, value: string | boolean) => { await act(async () => { reactProps(control(name)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); await settle(); }); };
	const click = async (name: string) => { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); };
	const ready = async () => { assert.ok(mounted.dom.find('canvas'), 'The opt-in repair dialog has a real Original canvas.');
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.one('canvas').getAttribute('data-state') === 'ready'; }, 'joined Original paint readiness'); };
	const add = async (mode: 'clone' | 'heal') => { await change(text.mode, mode); await change(text.targetX, String(9.5 / 11)); await change(text.targetY, '.5');
		await change(text.sourceX, String(1.5 / 11)); await change(text.sourceY, '.5'); await change(text.radius, '.2'); await change(text.feather, '0'); await change(text.opacity, '1'); await click(text.add); };
	return { ...mounted, text, original, applied, painted, backings, marker, release, ready, control, button, change, click, add,
		hold() { holding = true; }, retire() { current = false; }, calls: () => sourceCalls, closes: () => closes,
		async replace(next: typeof develop) { develop = next; await mounted.render(); },
		async dispose() { release.resolve(); const registered = [...retirements]; const results = await Promise.allSettled([mounted.dispose(), ...registered.map(retire => retire())]); restore();
			const errors = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []); if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Repair UI fixture retirement failed.'); },
	};
}

for (const locale of ['en', 'de']) test(`${locale}: Repair spots is opt-in in actual settings-capable and fallback local menus, independently of resolution controls`, async () => {
	const f = await currentDevelopFixture(1), owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async (run, signal) => run({ signal: signal!, isCurrent: () => true, acquire: async () => f.develop, refresh: async () => undefined }) });
	let opened = 0; const extension = { repairs: { available: true, onOpen: () => { opened++; } } }, source = { schemaVersion: 2 as const, catalogId: 'catalog-1', photoId: f.photos[0]!.id,
		versionId: f.photos[0]!.activeVersionId, revision: f.photos[0]!.revision, develop: currentRecipe() };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopSettingsMenuV2 {...extension} locale={locale} owner={owner} snapshot={owner.snapshot()} source={source}
		selectedIds={[source.photoId]} disabled={false} dirty={false} isCurrent={() => true} onChanged={async () => undefined} />);
	try { const settings = mounted.dom.container.querySelectorAll('details').find(node => node.getAttribute('class')?.includes('lightscaper-develop-settings-menu')); assert.ok(settings);
		const button = settings.querySelectorAll('button').find(value => value.textContent === labels(locale).menu); assert.ok(button, 'Existing Settings exposes the opt-in repair entry.');
		assert.equal(mounted.dom.find('[data-photo-repair-spots-dialog]'), null); await act(async () => { reactProps(button).onClick?.({}); }); assert.equal(opened, 1);
	} finally { await mounted.dispose(); await owner.close(); await f.close(); }
	const fallback = await mountPhotoImportUi(() => <PhotoDevelopLocalAdjustmentsMenuV1 locale={locale} disabled={false} isCurrent={() => true} {...extension}
		resolution={{ value: 'proxy', fullAvailable: true, onChange: () => undefined }} />);
	try { const entry = fallback.dom.container.querySelectorAll('button').find(value => value.textContent === labels(locale).menu); assert.ok(entry);
		await act(async () => { reactProps(entry).onClick?.({}); }); assert.equal(opened, 2); assert.equal(fallback.dom.find('[data-photo-repair-spots-dialog]'), null);
	} finally { await fallback.dispose(); }
});

for (const locale of ['en', 'de']) test(`${locale}: keyboard Clone and genuine Heal edit locally before Apply with independent full-Original pixel results`, async () => {
	for (const [mode, expected] of [['clone', 64], ['heal', 138]] as const) {
		const f = await dialog(locale), unchanged = defaultImageDevelopStateV2();
		try { await f.ready(); assert.equal(f.control(f.text.visualize).checked, false); await f.add(mode); assert.equal(f.applied.length, 0);
			await f.click(f.text.apply); assert.equal(f.applied.length, 1); const saved = f.applied[0]!;
			assert.equal(saved.processVersion, 3); assert.equal(saved.repairs.spots.length, 1); assert.equal(saved.repairs.spots[0]!.mode, mode);
			const pixels = donors(), frame = rgbaFrame(pixels); frame.descriptor = { ...frame.descriptor, width: 11, height: 3 };
			const after = await withImageDevelopFrameV3({ frame, develop: saved }, view => [...view.frame.pixels], PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1);
			const literal = [...pixels]; literal.splice(20 * 4, 4, expected, expected, expected, 255); assert.deepEqual(after, literal);
			assert.deepEqual(unchanged, defaultImageDevelopStateV2()); assert.ok(f.backings.every(bytes => bytes.every(value => value === 0)));
		} finally { await f.dispose(); }
	}
});

test('source pointer moves use the oriented Original content rectangle, cancellation discards the drag and committed movement changes Heal donor', async () => {
	const f = await dialog();
	try { await f.ready(); await f.add('heal'); await f.change(f.text.tool, 'source');
		const canvas = f.dom.one('canvas'); Reflect.set(canvas, 'getBoundingClientRect', () => ({ left: 10, top: 20, width: 440, height: 120 }));
		Reflect.set(canvas, 'setPointerCapture', () => undefined); Reflect.set(canvas, 'releasePointerCapture', () => undefined);
		const point = (x: number) => ({ currentTarget: canvas, pointerId: 1, button: 0, clientX: 10 + 440 * x, clientY: 80, preventDefault() {} });
		await act(async () => { reactProps(canvas).onPointerDown?.(point(1.5 / 11)); reactProps(canvas).onPointerMove?.(point(5.5 / 11)); reactProps(canvas).onPointerCancel?.(point(5.5 / 11)); });
		assert.equal(Number(f.control(f.text.sourceX).value), 1.5 / 11);
		await act(async () => { reactProps(canvas).onPointerDown?.(point(1.5 / 11)); reactProps(canvas).onPointerMove?.(point(5.5 / 11)); reactProps(canvas).onPointerUp?.(point(5.5 / 11)); });
		assert.equal(Number(f.control(f.text.sourceX).value), .5); await f.click(f.text.apply); assert.equal(f.applied[0]!.repairs.spots[0]!.source.x, .5);
		const pixels = donors(), frame = rgbaFrame(pixels); frame.descriptor = { ...frame.descriptor, width: 11, height: 3 };
		const result = await withImageDevelopFrameV3({ frame, develop: f.applied[0]! }, value => [...value.frame.pixels], PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1);
		const literal = [...pixels]; literal.splice(20 * 4, 4, 217, 217, 217, 255); assert.deepEqual(result, literal);
	} finally { await f.dispose(); }
});

for (const cancellation of ['onPointerCancel', 'onLostPointerCapture', 'onPointerUp'] as const) test(`${cancellation}: source drag cancellation during a held diagnostic joins, rolls back and leaves Apply and movement usable`, async () => {
	const f = await dialog();
	try {
		await f.ready(); await f.add('heal'); await f.change(f.text.tool, 'source');
		const canvas = f.dom.one('canvas'); Reflect.set(canvas, 'getBoundingClientRect', () => ({ left: 10, top: 20, width: 440, height: 120 }));
		Reflect.set(canvas, 'setPointerCapture', () => undefined); Reflect.set(canvas, 'releasePointerCapture', () => undefined);
		const point = (x: number) => ({ currentTarget: canvas, pointerId: 1, button: 0, clientX: 10 + 440 * x, clientY: 80, preventDefault() {} });
		await act(async () => { reactProps(canvas).onPointerDown?.(point(1.5 / 11)); reactProps(canvas).onPointerMove?.(point(5.5 / 11)); });
		assert.equal(Number(f.control(f.text.sourceX).value), .5, 'The held gesture has a real local preview to roll back.');
		let entered = false; const entry = f.marker.promise.then(() => { entered = true; });
		f.hold(); await f.change(f.text.visualize, true);
		await waitFor(() => entered || f.dom.find('[role="alert"]') !== null, 'diagnostic Original entry or terminal failure');
		assert.equal(entered, true); await entry;
		assert.equal(canvas.getAttribute('data-state'), 'pending'); assert.ok(f.backings.at(-1)?.some(value => value !== 0));
		await act(async () => { reactProps(canvas)[cancellation]?.(point(5.5 / 11)); await settle(); });
		assert.equal(f.applied.length, 0); f.release.resolve(); await f.ready();
		assert.equal(Number(f.control(f.text.sourceX).value), 1.5 / 11, 'Cancellation rolls back the owner gesture after the diagnostic joins.');
		await f.click(f.text.apply); assert.equal(f.applied.length, 1); assert.equal(f.applied[0]!.repairs.spots[0]!.source.x, 1.5 / 11);
		await act(async () => { reactProps(canvas).onPointerDown?.(point(1.5 / 11)); reactProps(canvas).onPointerMove?.(point(5.5 / 11)); reactProps(canvas).onPointerUp?.(point(5.5 / 11)); });
		assert.equal(Number(f.control(f.text.sourceX).value), .5); await f.click(f.text.apply);
		assert.equal(f.applied.length, 2); assert.equal(f.applied[1]!.repairs.spots[0]!.source.x, .5);
		assert.ok(f.backings.every(bytes => bytes.every(value => value === 0))); assert.equal(f.dom.find('[role="alert"]'), null);
	} finally { await f.dispose(); }
});

test('visualize-spots starts off, paints true edge bytes and changed threshold, and never enters the recipe or alters Original', async () => {
	const pixels = [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255], f = await dialog('en', pixels, 3);
	try { await f.ready(); assert.deepEqual(f.painted.at(-1), pixels); await f.change(f.text.visualize, true); await f.ready();
		assert.deepEqual(f.painted.at(-1), [200, 200, 200, 255, 255, 255, 255, 255, 255, 255, 255, 255]); await f.change(f.text.threshold, '.25'); await f.ready();
		assert.deepEqual(f.painted.at(-1), [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]); await f.change(f.text.visualize, false); await f.ready();
		assert.deepEqual(f.painted.at(-1), pixels); assert.equal(f.applied.length, 0); assert.ok(f.backings.every(bytes => bytes.every(value => value === 0)));
	} finally { await f.dispose(); }
});

test('Close seals a held real full-validation demand, blocks retained Apply/Remove callbacks and joins before onClose without publication', async () => {
	const f = await dialog();
	try { await f.ready(); await f.add('heal'); const oldApply = reactProps(f.button(f.text.apply)).onClick!, oldRemove = reactProps(f.button(f.text.remove)).onClick!;
		f.hold(); await f.click(f.text.apply); assert.equal(f.calls() > 1, true); await f.marker.promise; await f.click(f.text.close);
		assert.equal(f.closes(), 0); oldApply({}); oldRemove({}); assert.equal(f.applied.length, 0); f.release.resolve(); await act(async () => { await settle(); });
		assert.equal(f.closes(), 1); assert.equal(f.applied.length, 0); assert.ok(f.backings.every(bytes => bytes.every(value => value === 0)));
	} finally { await f.dispose(); }
});

test('StrictMode replay creates a usable fresh authoring scope; stale props and no-context Heal never publish', async () => {
	const f = await dialog('en', [0, 0, 0, 255], 1, true);
	try { await f.ready(); await f.change(f.text.mode, 'heal'); await f.change(f.text.radius, '1'); await f.click(f.text.add);
		const oldApply = reactProps(f.button(f.text.apply)).onClick!; await f.click(f.text.apply); assert.equal(f.applied.length, 0); assert.ok(f.dom.find('[role="alert"]'));
		await f.replace(defaultImageDevelopStateV2()); oldApply({}); await act(async () => { await settle(); }); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
});
