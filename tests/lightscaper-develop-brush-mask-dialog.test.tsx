/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspaceV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceV2.tsx';
import PhotoDevelopBrushMaskDialogV1, { type PhotoDevelopBrushMaskDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopBrushMaskDialogV1.tsx';
import { photoDevelopBrushMaskCopy } from '../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { normalizeImageDevelopStateV1OrV2, defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withBrushMaskResourceV1, withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../src/common/editor/photo-library-develop-mask-raster-port-v1.ts';
import { createPhotoMediaMaskRasterResourcesV1 } from '../src/lightscaper/storage/photo-media-mask-raster-resources-v1.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { reactProps } from './helpers/react-test-dom.ts';
import { rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import type { ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import { PhotoLibraryBrushMaskAuthoringV1, type PhotoLibraryBrushMaskDisplayV1 } from '../src/common/editor/controller/shared/photo-library-brush-mask-authoring-v1.ts';

for (const locale of ['en', 'de']) test(`${locale}: current Develop Workspace exposes brush authoring only in its existing Settings menu`, async () => {
	const fixture = await currentDevelopFixture(1), before = await fixture.repository.loadPhoto('catalog-1', fixture.photos[0]!.id);
	assert.ok(before);
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => {
		assert.ok(signal); await run({ signal, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale={locale} photoId={before.id} label={before.metadata.fileName}
		generation={fixture} execute={execute} readPreview={async () => ({ outcome: 'missing' })}
		loadProxy={async () => { throw Error('No decoder for missing preview'); }} beforePresent={Promise.resolve()}
		registerRetirement={() => () => undefined} onClose={() => undefined} />);
	try {
		await act(async () => { await settle(); });
		assert.equal(mounted.dom.find('[data-photo-develop-brush-mask]'), null, 'Brush authoring is opt-in.');
		assert.ok(mounted.dom.find('[data-photo-develop-effects]'), 'The current Develop document is ready.');
		const settings = mounted.dom.container.querySelectorAll('details').find(node => node.getAttribute('class')?.split(' ').includes('lightscaper-develop-settings-menu')); assert.ok(settings);
		const label = locale === 'de' ? 'Pinselmaske…' : 'Brush mask…';
		const entries = settings.querySelectorAll('button').filter(button => button.textContent === label);
		assert.equal(entries.length, 1, 'The existing Settings menu must expose the brush dialog.');
		assert.deepEqual(await fixture.repository.loadPhoto('catalog-1', before.id), before);
	} finally { await mounted.dispose(); await fixture.close(); }
});

function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('white-balance-v1', { id: 'warm' }),
		createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false }), createVideoEffect('develop-geometry-v1', { id: 'geometry' })] });
}
async function dialog(locale = 'en', initial = recipe(), strict = false) {
	const name = `brush-dialog-${crypto.randomUUID()}`, raw = createInstrumentedIndexedDB(), database = await openDatabase(raw as unknown as IDBFactory, name);
	const storage = createPhotoMediaMaskRasterResourcesV1({ memory: getMemoryDatabase(name), database: async () => database }, run => run(), () => undefined);
	const release = deferred<void>(), entered = deferred<void>(), retirements = new Set<() => Promise<void>>();
	let current = true, develop = initial, disabled = false, hold = false, closes = 0, installations = 0, renderedProps: PhotoDevelopBrushMaskDialogPropsV1;
	const receipts: Awaited<ReturnType<PhotoLibraryDevelopMaskRasterPortV1['install']>>[] = [];
	const port: PhotoLibraryDevelopMaskRasterPortV1 = { schemaVersion: 1, source: storage.resources.source,
		async install(reference, bytes, options) {
			assert.equal(this, port); installations++; const result = await storage.resources.put(reference, bytes, options);
			const receipt = Object.freeze({ schemaVersion: 1 as const, catalogId: 'catalog-1', ...result, notices: Object.freeze([]) }); receipts.push(receipt);
			if (hold) { entered.resolve(); await release.promise; } return receipt;
		} };
	const applied: Readonly<{ value: PhotoDevelopBrushMaskDialogPropsV1['develop']; overlay: Parameters<PhotoDevelopBrushMaskDialogPropsV1['onApply']>[1] }>[] = [];
	const mounted = await mountPhotoImportUi(() => {
		const element = <PhotoDevelopBrushMaskDialogV1 port={port} develop={develop} locale={locale} disabled={disabled} isCurrent={() => current}
			onApply={function (this: unknown, value, overlay) { assert.equal(this, renderedProps); assert.ok(receipts.length); applied.push({ value, overlay }); }}
			onClose={() => { closes++; }} registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />;
		renderedProps = element.props; return strict ? <StrictMode>{element}</StrictMode> : element;
	});
	const text = photoDevelopBrushMaskCopy(locale);
	const control = (label: string) => { const node = mounted.dom.container.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
	const button = (label: string) => { const node = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(node, label); return node; };
	const flush = async () => { await act(async () => { await settle(); }); };
	const ready = async () => { for (let turn = 0; turn < 100; turn++) { await flush(); if (mounted.dom.one('canvas').getAttribute('data-state') === 'ready') return; }
		assert.fail('Real brush controller did not become ready.'); };
	const change = async (label: string, value: string | boolean) => { await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: typeof value === 'boolean' ? { checked: value } : { value } }); await settle(); }); };
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); await settle(); }); };
	const fields = (prefix: string) => mounted.dom.container.querySelectorAll('input').filter(node => node.getAttribute('aria-label')?.startsWith(`${prefix}: `));
	async function alpha() {
		const receipt = receipts.at(-1); assert.ok(receipt);
		return storage.resources.source.withBytes(receipt.reference, bytes => withBrushMaskResourceV1({ reference: receipt.reference, bytes }, view => [...view.alpha]));
	}
	async function grid() { await ready(); await change(text.width, '4'); await change(text.height, '4'); await click(text.create); await ready();
		await change(text.radius, '0.25'); await change(text.hardness, '1'); await change(text.opacity, '1'); await change(text.x, '0.375'); await change(text.y, '0.375'); }
	return { ...mounted, text, port, storage, raw, name, control, button, flush, ready, change, click, grid, alpha, fields, receipts, applied, entered, release,
		hold() { hold = true; }, retire() { current = false; }, installations: () => installations, closes: () => closes,
		async replace(next: typeof develop, nextDisabled = false) { develop = next; disabled = nextDisabled; await mounted.render(); },
		async join() { await Promise.all([...retirements].map(retire => retire())); },
		async dispose() { release.resolve(); const retiring = [...retirements];
			const results = await Promise.allSettled([mounted.dispose(), ...retiring.map(retire => retire())]);
			const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			try { await storage.close(); } catch (error) { errors.push(error); } try { database.close(); } catch (error) { errors.push(error); }
			if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Dialog fixture cleanup failed.', { cause: errors[0] }); },
	};
}

const CROSS = [0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0];
function heldDisplay() {
	const prototype = PhotoLibraryBrushMaskAuthoringV1.prototype, descriptor = Object.getOwnPropertyDescriptor(prototype, 'withDisplay'); assert.ok(descriptor);
	const original = prototype.withDisplay, entered = deferred<void>(), release = deferred<void>();
	const state: { armed: boolean; used: boolean; backing?: ArrayBuffer; work?: Promise<unknown> } = { armed: false, used: false };
	Object.defineProperty(prototype, 'withDisplay', { ...descriptor, value: function <Result>(this: PhotoLibraryBrushMaskAuthoringV1,
		consume: (alpha: Uint8Array<ArrayBuffer>, view: Readonly<PhotoLibraryBrushMaskDisplayV1>) => Result | Promise<Result>): Promise<Result> {
		const work = Reflect.apply(original, this, [async (alpha: Uint8Array<ArrayBuffer>, view: Readonly<PhotoLibraryBrushMaskDisplayV1>) => {
			const result = await Reflect.apply(consume, undefined, [alpha, view]) as Result;
			if (state.armed && !state.used && alpha.some(value => value !== 0)) { state.used = true; state.backing = alpha.buffer; entered.resolve(); await release.promise; }
			return result;
		}]) as Promise<Result>;
		state.work = work; return work;
	} });
	return { entered, release, arm() { state.armed = true; }, async idle() { await state.work; }, bytes() { assert.ok(state.backing); return new Uint8Array(state.backing); },
		async restore() { release.resolve(); await state.work?.catch(() => undefined); Object.defineProperty(prototype, 'withDisplay', descriptor); } };
}
for (const locale of ['en', 'de']) test(`${locale}: keyboard paint, erase and undo/redo install the independent cross before a multi-effect scalar edit`, async () => {
	const f = await dialog(locale), original = JSON.stringify(recipe());
	try {
		await f.grid(); assert.equal(f.fields(f.text.bind).length, 2); assert.equal(f.fields(f.text.effectEnabled).length, 2);
		assert.equal(f.control(f.text.showOverlay).checked, false);
		for (const field of f.fields(f.text.bind)) await f.change(field.getAttribute('aria-label')!, true);
		await f.change(f.fields(f.text.effectEnabled)[0]!.getAttribute('aria-label')!, false);
		await f.change(f.fields(f.text.effectEnabled)[1]!.getAttribute('aria-label')!, true);
		await f.click(f.text.stamp); await f.ready(); await f.click(f.text.undo); await f.ready(); await f.click(f.text.redo); await f.ready();
		await f.change(f.text.mode, 'erase'); await f.change(f.text.opacity, '0.5'); await f.click(f.text.stamp); await f.ready();
		await f.click(f.text.undo); await f.ready(); await f.click(f.text.apply);
		assert.equal(f.installations(), 1); assert.equal(f.applied.length, 1); assert.deepEqual(await f.alpha(), CROSS);
		const { value, overlay } = f.applied[0]!, mask = value.masks[0]!;
		assert.equal(overlay, null); assert.deepEqual(mask.inputs, [{ name: 'paint', kind: 'alpha', sourceRef: f.receipts[0]!.reference.storageKey }]);
		assert.deepEqual(mask.nodes, [{ id: mask.outputNodeId, kind: 'alpha', inputName: 'paint' }]);
		assert.deepEqual(value.maskBindings, [{ effectId: 'detail', maskId: mask.id }, { effectId: 'warm', maskId: mask.id }]);
		assert.deepEqual(value.effects.map(effect => [effect.id, effect.enabled]), [['warm', false], ['detail', true], ['geometry', true]]);
		assert.equal(JSON.stringify(recipe()), original); assert.equal(f.raw.recordCount(f.name, 'analysis'), 1);
	} finally { await f.dispose(); }
});

test('re-edit authenticates a retained matte body, preserves input/output identities and unrelated graph, and removal prunes only its bindings', async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 4, height: 4, alpha: new Uint8Array(CROSS) }, view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [{ schemaVersion: 1, id: 'retained', kind: 'matte',
		inputs: [{ name: 'stored', kind: 'raster', sourceRef: body.reference.storageKey }], nodes: [{ id: 'output', kind: 'raster', inputName: 'stored', channel: 'alpha' }], outputNodeId: 'output' },
		{ ...rectangleGraph(), id: 'unrelated' }], maskBindings: [{ effectId: 'warm', maskId: 'retained' }] });
	const f = await dialog('en', initial), wire = JSON.stringify(initial);
	try {
		await f.storage.resources.put(body.reference, body.bytes); await f.ready(); await f.change(f.text.mask, 'retained'); await f.ready();
		assert.equal(f.control(f.text.width).value, '4'); assert.equal(f.control(f.text.width).hasAttribute('disabled'), true);
		await f.change(f.text.mode, 'erase'); await f.change(f.text.radius, '0.25'); await f.change(f.text.hardness, '1'); await f.change(f.text.opacity, '0.5');
		await f.change(f.text.x, '0.375'); await f.change(f.text.y, '0.375'); await f.click(f.text.stamp); await f.ready(); await f.click(f.text.apply);
		assert.deepEqual(await f.alpha(), CROSS.map(value => value ? 127 : 0));
		const updated = f.applied[0]!.value, retained = updated.masks.find(mask => mask.id === 'retained')!;
		assert.equal(retained.kind, 'matte'); assert.equal(retained.outputNodeId, 'output'); assert.equal(retained.inputs[0]!.name, 'stored');
		assert.deepEqual(retained.nodes, initial.masks.find(mask => mask.id === 'retained')!.nodes);
		assert.deepEqual(updated.masks.find(mask => mask.id === 'unrelated'), initial.masks.find(mask => mask.id === 'unrelated'));
		assert.equal(JSON.stringify(initial), wire); await f.click(f.text.remove);
		assert.deepEqual(f.applied[1]!.value.masks.map(mask => mask.id), ['unrelated']); assert.deepEqual(f.applied[1]!.value.maskBindings, []);
	} finally { await f.dispose(); }
});

test('overlay requires an explicit bound effect and invalid grid or brush values do not acquire a destination body', async () => {
	const f = await dialog();
	try {
		await f.grid(); await f.click(f.text.apply); assert.equal(f.installations(), 0);
		await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true); await f.change(f.text.showOverlay, true);
		assert.equal(f.control(f.text.overlayEffect).value, ''); await f.click(f.text.apply); assert.equal(f.installations(), 0);
		for (const invalid of ['', '0', '-0', 'NaN', 'Infinity', '2']) { await f.change(f.text.radius, invalid); await f.click(f.text.stamp); assert.ok(f.dom.find('[role="alert"]')); }
		await f.change(f.text.width, '1025'); await f.click(f.text.create); assert.equal(f.dom.one('canvas').getAttribute('width'), '4');
		await f.change(f.text.width, '4'); await f.change(f.text.radius, '0.25'); await f.change(f.text.overlayEffect, 'warm'); await f.click(f.text.apply);
		assert.equal(f.applied.length, 1); assert.deepEqual(f.applied[0]!.overlay, { maskId: f.applied[0]!.value.masks[0]!.id, effectId: 'warm' });
	} finally { await f.dispose(); }
});

test('native install ACK may survive retirement but stale callbacks never edit or close a replacement draft, and retirement joins the held result', async () => {
	const f = await dialog();
	try {
		await f.grid(); await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true); await f.click(f.text.stamp); await f.ready(); f.hold();
		const oldApply = reactProps(f.button(f.text.apply)).onClick, oldClose = reactProps(f.button(f.text.close)).onClick;
		await f.click(f.text.apply); await f.entered.promise; assert.equal(f.applied.length, 0); assert.equal(f.raw.recordCount(f.name, 'analysis'), 1);
		f.retire(); const joined = f.join(); assert.equal(await remainsPending(joined), true);
		await act(async () => { oldApply?.({}); oldClose?.({}); }); assert.equal(f.installations(), 1); assert.equal(f.closes(), 0);
		f.release.resolve(); await act(async () => { await joined; await settle(); });
		assert.equal(f.receipts.length, 1); assert.deepEqual(await f.alpha(), CROSS); assert.equal(f.applied.length, 0); assert.equal(f.closes(), 0);
	} finally { await f.dispose(); }
});

test('explicit Close joins a held committed install ACK, retains its immutable body and prevents draft publication', async () => {
	const f = await dialog();
	try {
		await f.grid(); await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true); await f.click(f.text.stamp); await f.ready(); f.hold();
		const apply = reactProps(f.button(f.text.apply)).onClick, stamp = reactProps(f.button(f.text.stamp)).onClick;
		await f.click(f.text.apply); await f.entered.promise;
		assert.equal(f.raw.recordCount(f.name, 'analysis'), 1); assert.equal(f.applied.length, 0);
		await f.click(f.text.close); const joined = f.join(); assert.equal(await remainsPending(joined), true);
		assert.equal(f.closes(), 0, 'Close must join the actual held result before dismissing.');
		await act(async () => { apply?.({}); stamp?.({}); }); assert.equal(f.installations(), 1);
		f.release.resolve(); await act(async () => { await joined; await settle(); });
		assert.equal(f.receipts.length, 1); assert.equal(f.raw.recordCount(f.name, 'analysis'), 1); assert.deepEqual(await f.alpha(), CROSS);
		assert.equal(f.applied.length, 0, 'A committed ACK after Close must not publish a draft edit.'); assert.equal(f.closes(), 1);
	} finally { await f.dispose(); }
});

test('retained chooser and Apply handlers refuse while the real display borrow is busy, then a fresh chooser re-edits the authentic body', async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 4, height: 4, alpha: new Uint8Array(CROSS) }, view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [{ schemaVersion: 1, id: 'retained', kind: 'matte',
		inputs: [{ name: 'stored', kind: 'alpha', sourceRef: body.reference.storageKey }], nodes: [{ id: 'output', kind: 'alpha', inputName: 'stored' }], outputNodeId: 'output' }],
		maskBindings: [{ effectId: 'warm', maskId: 'retained' }] });
	const held = heldDisplay(), f = await dialog('en', initial), errors: unknown[] = [];
	try {
		await f.storage.resources.put(body.reference, body.bytes); await f.ready(); await f.change(f.text.width, '8'); await f.change(f.text.height, '4'); await f.click(f.text.create); await f.ready();
		await f.change(f.text.radius, '0.25'); await f.change(f.text.hardness, '1'); await f.change(f.text.opacity, '1'); await f.change(f.text.x, '0.4375'); await f.change(f.text.y, '0.375');
		await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true);
		await held.idle(); await f.flush(); const choose = reactProps(f.control(f.text.mask)).onChange, apply = reactProps(f.button(f.text.apply)).onClick;
		held.arm(); await f.click(f.text.stamp); await held.entered.promise; await f.flush();
		assert.deepEqual([...held.bytes()], [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		await act(async () => { choose?.({ currentTarget: { value: 'retained' } }); apply?.({}); await settle(); });
		assert.equal(f.control(f.text.mask).value, '', 'Actual busy state must fence a retained idle chooser.');
		assert.equal(f.dom.one('canvas').getAttribute('width'), '8'); assert.equal(f.installations(), 0); assert.equal(f.applied.length, 0);
		held.release.resolve(); await f.ready(); assert.ok(held.bytes().every(value => value === 0));
		await f.change(f.text.mask, 'retained'); await f.ready(); await f.click(f.text.apply);
		assert.equal(f.installations(), 1); assert.deepEqual(await f.alpha(), CROSS); assert.equal(f.applied[0]!.value.masks[0]!.kind, 'matte');
	} catch (error) { errors.push(error); }
	finally { held.release.resolve(); try { await f.dispose(); } catch (error) { errors.push(error); } try { await held.restore(); } catch (error) { errors.push(error); } }
	if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Held display test failed.', { cause: errors[0] });
});

test('parent replacement joins and wipes a cancelled real display borrow before the next controller opens', async () => {
	const held = heldDisplay(), f = await dialog(), errors: unknown[] = [];
	try {
		await f.grid(); await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true);
		await held.idle(); await f.flush(); held.arm(); await f.click(f.text.stamp); await held.entered.promise; await f.flush(); assert.deepEqual([...held.bytes()], CROSS);
		await f.replace(recipe()); await f.flush(); assert.equal(f.dom.one('canvas').getAttribute('data-state'), 'pending');
		assert.deepEqual([...held.bytes()], CROSS, 'Replacement must join the old borrowed plane before wiping it.');
		held.release.resolve(); await f.ready(); assert.ok(held.bytes().every(value => value === 0)); assert.equal(f.installations(), 0);
		await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true); await f.click(f.text.stamp); await f.ready(); await f.click(f.text.apply);
		assert.equal(f.installations(), 1); assert.deepEqual(await f.alpha(), CROSS);
	} catch (error) { errors.push(error); }
	finally { held.release.resolve(); try { await f.dispose(); } catch (error) { errors.push(error); } try { await held.restore(); } catch (error) { errors.push(error); } }
	if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Held display replacement test failed.', { cause: errors[0] });
});

test('display waits for the actual opening outcome before painting and authentic stored-body re-edit', async () => {
	const body = await withPreparedBrushMaskResourceV1({ width: 4, height: 4, alpha: new Uint8Array(CROSS) }, view => ({ reference: view.reference, bytes: view.bytes.slice() }));
	const initial = normalizeImageDevelopStateV1OrV2({ ...recipe(), masks: [{ schemaVersion: 1, id: 'retained', kind: 'matte',
		inputs: [{ name: 'stored', kind: 'alpha', sourceRef: body.reference.storageKey }], nodes: [{ id: 'output', kind: 'alpha', inputName: 'stored' }], outputNodeId: 'output' }],
		maskBindings: [{ effectId: 'warm', maskId: 'retained' }] });
	const prototype = PhotoLibraryBrushMaskAuthoringV1.prototype, openDescriptor = Object.getOwnPropertyDescriptor(prototype, 'open'), displayDescriptor = Object.getOwnPropertyDescriptor(prototype, 'withDisplay');
	assert.ok(openDescriptor); assert.ok(displayDescriptor);
	const open = prototype.open, display = prototype.withDisplay, entered = deferred<void>(), release = deferred<void>();
	const state: { held: boolean; owner?: PhotoLibraryBrushMaskAuthoringV1; opening?: Promise<void>; displays: number; painted?: Promise<unknown> } = { held: false, displays: 0 };
	Object.defineProperty(prototype, 'open', { ...openDescriptor, value: function (this: PhotoLibraryBrushMaskAuthoringV1,
		request: Parameters<PhotoLibraryBrushMaskAuthoringV1['open']>[0]): Promise<void> {
		const result = Reflect.apply(open, this, [request]) as Promise<void>;
		if (state.held) return result; state.held = true; state.owner = this;
		state.opening = result.then(async () => { entered.resolve(); await release.promise; }); return state.opening;
	} });
	Object.defineProperty(prototype, 'withDisplay', { ...displayDescriptor, value: function <Result>(this: PhotoLibraryBrushMaskAuthoringV1,
		consume: (alpha: Uint8Array<ArrayBuffer>, view: Readonly<PhotoLibraryBrushMaskDisplayV1>) => Result | Promise<Result>): Promise<Result> {
		state.displays++; const work = Reflect.apply(display, this, [consume]) as Promise<Result>; state.painted = work; return work;
	} });
	const errors: unknown[] = []; let f: Awaited<ReturnType<typeof dialog>> | undefined;
	try {
		f = await dialog('en', initial); await entered.promise; await f.flush();
		assert.equal(state.owner?.snapshot().ready, true, 'The real opening has published an authenticated grid.');
		assert.equal(await remainsPending(state.opening!), true, 'Its public outcome delivery remains held.');
		assert.equal(state.displays, 0, 'Display must join the actual opening promise before acquiring replay.');
		release.resolve(); await state.opening; await f.ready(); await state.painted;
		assert.equal(state.displays, 1); assert.equal(f.dom.one('canvas').getAttribute('width'), '256');
		await f.storage.resources.put(body.reference, body.bytes); await f.change(f.text.mask, 'retained'); await f.ready(); await state.painted;
		assert.equal(f.control(f.text.width).value, '4'); await f.click(f.text.apply);
		assert.equal(f.installations(), 1); assert.deepEqual(await f.alpha(), CROSS); assert.equal(f.applied[0]!.value.masks[0]!.kind, 'matte');
		assert.equal(f.applied[0]!.value.masks[0]!.outputNodeId, 'output');
	} catch (error) { errors.push(error); }
	finally {
		release.resolve(); try { await f?.dispose(); } catch (error) { errors.push(error); }
		try { await state.opening; } catch (error) { errors.push(error); }
		Object.defineProperty(prototype, 'open', openDescriptor); Object.defineProperty(prototype, 'withDisplay', displayDescriptor);
	}
	if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Opening display test failed.', { cause: errors[0] });
});

test('actual pointer stroke uses the grid own rectangle, and cancellation discards an unfinished gesture', async () => {
	const f = await dialog();
	try {
		await f.grid(); await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true);
		const canvas = f.dom.one('canvas'); let captured = false;
		Object.defineProperties(canvas, { getBoundingClientRect: { value: () => ({ left: 100, top: 200, width: 400, height: 200 }) },
			setPointerCapture: { value: () => { captured = true; } }, hasPointerCapture: { value: () => captured }, releasePointerCapture: { value: () => { captured = false; } } });
		const event = { currentTarget: canvas, pointerId: 7, button: 0, clientX: 250, clientY: 275, preventDefault() {} };
		await act(async () => { reactProps(canvas).onPointerDown?.(event); reactProps(canvas).onPointerCancel?.(event); });
		await act(async () => { reactProps(canvas).onPointerUp?.(event); }); assert.equal(captured, false);
		await act(async () => { reactProps(canvas).onPointerDown?.(event); reactProps(canvas).onPointerUp?.(event); await settle(); });
		assert.equal(captured, false); await f.ready(); await f.click(f.text.apply); assert.deepEqual(await f.alpha(), CROSS);
	} finally { await f.dispose(); }
});

test('React effect replay joins the retired controller before a fresh interactive owner paints and installs', async () => {
	const f = await dialog('en', recipe(), true);
	try { await f.grid(); await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true); await f.click(f.text.stamp); await f.ready();
		await f.click(f.text.apply); assert.equal(f.applied.length, 1); assert.equal(f.installations(), 1); assert.deepEqual(await f.alpha(), CROSS);
	} finally { await f.dispose(); }
});

test('replaced or disabled props fence retained Apply, stroke, chooser and Close callbacks before installation', async () => {
	const f = await dialog();
	try {
		await f.grid(); await f.change(f.fields(f.text.bind)[0]!.getAttribute('aria-label')!, true);
		const apply = reactProps(f.button(f.text.apply)).onClick, close = reactProps(f.button(f.text.close)).onClick;
		const stroke = reactProps(f.button(f.text.stamp)).onClick, choose = reactProps(f.control(f.text.mask)).onChange;
		await f.replace(recipe()); await f.ready();
		await act(async () => { apply?.({}); close?.({}); stroke?.({}); choose?.({ currentTarget: { value: '' } }); });
		assert.equal(f.installations(), 0); assert.equal(f.closes(), 0); assert.equal(f.applied.length, 0);
		await f.replace(recipe(), true); await f.flush(); await f.click(f.text.apply); await f.click(f.text.stamp);
		assert.equal(f.installations(), 0); assert.equal(f.applied.length, 0);
	} finally { await f.dispose(); }
});
