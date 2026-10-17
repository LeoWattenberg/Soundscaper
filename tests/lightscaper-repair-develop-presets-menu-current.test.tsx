/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { usePhotoDevelopSettingsCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-develop-settings-current-v1.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { joinPhotoLibraryRetirementV1 } from '../src/common/editor/controller/shared/photo-library-workflow-slot.ts';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { repairPresetsFixture } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const readPreview = async () => ({ outcome: 'missing' as const });
const loadProxy = async () => createPhotoDevelopRenderRuntimeV3();
const beforePresent = Promise.resolve(), registerRetirement = () => () => undefined;

for (const locale of ['en', 'de']) for (const retainedLegacy of [false, true]) test(`${locale}: Current presets opt in from Settings for ${retainedLegacy ? 'retained repairs with a legacy active recipe' : 'the repaired active recipe'}`, async () => {
	const f = await repairSettingsFixture(), text = photoDevelopSettingsCopy(locale, 'current3'), messages = photoDevelopCopy(locale);
	const state: { settings?: ReturnType<typeof usePhotoDevelopSettingsCurrentV1> } = {}, retirees = new Set<() => Promise<void>>();
	const registerDemandRetirement = (retire: () => Promise<void>) => { retirees.add(retire); return () => { retirees.delete(retire); }; };
	if (retainedLegacy) {
		const document = await f.read(); await f.session.develop.apply({ schemaVersion: 3, photoId: document.photoId, expectedRevision: document.revision,
			command: { type: 'select-develop-history', versionId: document.versionId, cursor: 0 } });
	}
	const before = await f.inspect(), saved = f.saved.length; assert.equal(before[0]!.photo.schemaVersion, 3);
	assert.equal((await f.read()).develop.processVersion, retainedLegacy ? 1 : 3);
	function View() {
		const settings = usePhotoDevelopSettingsCurrentV1({ generation: f.session, execute: f.execute }); state.settings = settings;
		return <PhotoDevelopWorkspaceCurrentV1 locale={locale} label="Native preset source" photoId={f.photos[0]!.id} catalogId={f.photos[0]!.catalogId}
			selectedIds={f.photos.map(photo => photo.id)} generation={f.session} execute={f.execute} settingsCurrent={settings}
			readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement}
			registerDemandRetirement={registerDemandRetirement} onClose={() => undefined} />;
	}
	// Actual selected documents and ACKs; only canvas cleanup is supplied.
	// No Original/decoder is injected and this is no rendered-pixel claim.
	const canvas = currentAppCanvasBoundary();
	const mounted = await mountPhotoImportUi(() => <StrictMode><View /></StrictMode>).catch(async (error: unknown) => { canvas.restore(); await f.close(); throw error; });
	let failed = false, primary: unknown;
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelectorAll('details')
			.some(node => node.querySelector('summary')?.textContent === text.menu); }, 'actual Current Settings menu');
		assert.equal(mounted.dom.container.querySelectorAll('[role="dialog"]').some(node => node.getAttribute('aria-label') === text.presets), false);
		const buttons = mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === text.presets);
		assert.equal(buttons.length, 1, 'The selected Current Settings menu must expose its real preset capability.');
		assert.equal(buttons[0]!.closest('details')?.querySelector('summary')?.textContent, text.menu);
		await act(async () => { reactProps(buttons[0]!).onClick?.({}); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return !state.settings?.snapshot.busy; }, 'actual preset menu list joins');
		const dialog = mounted.dom.container.querySelectorAll('[role="dialog"]').find(node => node.getAttribute('aria-label') === text.presets); assert.ok(dialog);
		const repair = dialog.querySelectorAll('input').find(node => node.parentNode?.textContent === text.repairs); assert.ok(repair);
		assert.equal(reactProps(repair).checked, true); assert.ok(dialog.querySelectorAll('button').some(node => node.textContent === text.savePreset));
		assert.equal(state.settings?.snapshot.presets?.schemaVersion, 3); assert.deepEqual(await f.inspect(), before); assert.equal(f.saved.length, saved);
		assert.ok(mounted.dom.container.querySelectorAll('button').some(node => node.textContent === messages.save));
	} catch (error) { failed = true; primary = error; }
	const failures: unknown[] = [];
	try { await act(async () => { await joinPhotoLibraryRetirementV1([...retirees].map(retire => retire())); await settle(); }); } catch (error) { failures.push(error); }
	for (const close of [() => mounted.dispose(), () => state.settings?.owner.close(), () => f.close()]) { try { await close(); } catch (error) { failures.push(error); } }
	try { canvas.restore(); } catch (error) { failures.push(error); }
	if (failed && !failures.length) throw primary;
	if (!failed && failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failed ? [primary, ...failures] : failures, 'Current preset menu assertion or cleanup failed.', failed ? { cause: primary } : undefined);
});

async function mountedPresets(locale = 'en') {
	const f = await repairPresetsFixture(), text = photoDevelopSettingsCopy(locale, 'current3'), messages = photoDevelopCopy(locale);
	const selection = { index: 0, generation: f.session as unknown }, state: { settings?: ReturnType<typeof usePhotoDevelopSettingsCurrentV1> } = {};
	const retirees = new Set<() => Promise<void>>(), closing: { work?: Promise<void> } = {};
	const registerDemandRetirement = (retire: () => Promise<void>) => { retirees.add(retire); return () => { retirees.delete(retire); }; };
	function View() {
		const settings = usePhotoDevelopSettingsCurrentV1({ generation: selection.generation, execute: f.execute }); state.settings = settings;
		return <PhotoDevelopWorkspaceCurrentV1 locale={locale} label="Native preset source" photoId={f.photos[selection.index]!.id} catalogId={f.photos[0]!.catalogId}
			selectedIds={f.photos.map(photo => photo.id)} generation={selection.generation} execute={f.execute} settingsCurrent={settings}
			readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement}
			registerDemandRetirement={registerDemandRetirement} onClose={() => undefined} />;
	}
	const canvas = currentAppCanvasBoundary();
	const mounted = await mountPhotoImportUi(() => <StrictMode><View /></StrictMode>).catch(async (error: unknown) => { canvas.restore(); await f.close(); throw error; });
	const settings = () => { assert.ok(state.settings); return state.settings; };
	const button = (name: string, scope: ReactTestElement = mounted.dom.container) => { const node = scope.querySelectorAll('button').filter(node => node.textContent === name).at(-1); assert.ok(node, name); return node; };
	const named = (tag: 'input' | 'select', label: string) => { const node = mounted.dom.container.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label
		|| node.closest('label')?.childNodes.filter(child => child.nodeType === 3).map(child => child.textContent).join('').trim() === label); assert.ok(node, label); return node; };
	const click = async (node: ReactTestElement) => { await act(async () => { reactProps(node).onClick?.({ currentTarget: node }); await settle(); }); };
	const change = async (node: ReactTestElement, value: string) => { await act(async () => { reactProps(node).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); await settle(); }); };
	const settled = async () => waitFor(async () => { await act(async () => { await settle(); }); return !settings().snapshot.busy
		&& mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === messages.cancel).every(node => node.hasAttribute('disabled')); }, 'Current preset and Develop joins');
	const dialog = () => { const node = mounted.dom.container.querySelectorAll('[role="dialog"]').find(node => node.getAttribute('aria-label') === text.presets); assert.ok(node); return node; };
	const open = async () => { await click(button(text.presets)); await settled(); return dialog(); };
	const dispose = () => {
		if (closing.work) return closing.work;
		closing.work = Promise.resolve().then(async () => {
			const errors: unknown[] = [];
			try { await act(async () => { await joinPhotoLibraryRetirementV1([...retirees].map(retire => retire())); await settle(); }); } catch (error) { errors.push(error); }
			for (const close of [() => mounted.dispose(), () => state.settings?.owner.close(), () => f.close()]) { try { await close(); } catch (error) { errors.push(error); } }
			canvas.restore(); if (errors.length) throw new AggregateError(errors, 'Mounted native preset cleanup failed.');
		}); return closing.work;
	};
	try { await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelectorAll('details').some(node => node.querySelector('summary')?.textContent === text.menu); }, 'actual Current Settings'); }
	catch (error) { await dispose(); throw error; }
	return { ...mounted, f, text, messages, settings, button, named, click, change, settled, dialog, open, dispose,
		async select(index: number) { selection.index = index; await mounted.render(); await settled(); },
		async replaceGeneration() { selection.generation = {}; await mounted.render(); await settled(); },
		async addDirtyTone(exposure: string) {
			await change(named('select', messages.choose), 'tone-ladder-v1'); await click(button(messages.add));
			await change(named('input', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamExposure}`), exposure);
		},
	};
}

for (const locale of ['en', 'de']) test(`${locale}: Current preset menu saves a dirty native repair draft, renames its identity, applies and deletes its sticky row`, async () => {
	const ui = await mountedPresets(locale), before = await ui.f.inspect();
	try {
		await ui.addDirtyTone('.5'); await ui.open(); await ui.change(ui.named('input', ui.text.presetName), 'Local repairs');
		assert.equal(ui.button(ui.text.savePreset).hasAttribute('disabled'), false); await ui.click(ui.button(ui.text.savePreset)); await ui.settled();
		const first = ui.settings().snapshot.presets; assert.ok(first); const selected = first.presets[0]; assert.ok(selected);
		assert.equal(first.schemaVersion, 3); assert.equal(selected.scope, 'full'); assert.equal(ui.f.saved.length, 0); assert.deepEqual(await ui.f.inspect(), before);
		const cap = ui.f.session.develop.presetsCurrent; assert.ok(cap);
		const body = await cap.read({ schemaVersion: 3, catalogId: first.catalogId, presetId: selected.id, expectedRevision: first.revision });
		assert.equal(body.preset.settings.develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, .5);
		assert.deepEqual(Reflect.get(body.preset.settings.develop, 'repairs'), Reflect.get(before[0]!.photo.versions[0]!.develop, 'repairs'));
		await ui.change(ui.named('select', ui.text.choosePreset), selected.id); await ui.change(ui.named('input', ui.text.presetName), 'Renamed repairs');
		await ui.click(ui.button(ui.text.renamePreset)); await ui.settled();
		const renamed = ui.settings().snapshot.presets; assert.ok(renamed); assert.equal(renamed.revision, first.revision + 1);
		assert.deepEqual(renamed.presets[0], { ...selected, name: 'Renamed repairs' });
		await ui.click(ui.button(ui.text.close, ui.dialog())); await ui.select(1); await ui.open();
		await ui.change(ui.named('select', ui.text.choosePreset), selected.id); await ui.click(ui.button(ui.text.applyPreset)); await ui.settled();
		assert.equal(ui.settings().snapshot.batch?.outcomes[0]?.status, 'applied'); assert.deepEqual((await ui.f.read(1)).develop, body.preset.settings.develop);
		const applied = await ui.f.inspect(); assert.deepEqual(applied[0], before[0]); assert.equal(ui.f.saved.length, 1);
		await ui.click(ui.button(ui.text.deletePreset)); await ui.settled();
		assert.deepEqual(await ui.f.row(), { schemaVersion: 4, kind: 'photo-develop-presets', catalogId: first.catalogId, revision: 3, presets: [] });
		for (const [index, row] of (await ui.f.inspect()).entries()) { assert.deepEqual(row.photo.original, before[index]!.photo.original); assert.deepEqual(row.bytes, before[index]!.bytes); }
	} finally { await ui.dispose(); }
});

test('Current preset menu refuses retained same-event dirty-source and replaced-generation Save handlers before native CAS', async () => {
	const ui = await mountedPresets();
	try {
		await ui.addDirtyTone('.25'); await ui.open(); await ui.change(ui.named('input', ui.text.presetName), 'Stale');
		const stale = reactProps(ui.button(ui.text.savePreset)).onClick, exposure = ui.named('input', `${ui.messages.shared.videoEffectExactValue}: ${ui.messages.shared.videoEffectParamExposure}`);
		const before = await ui.f.inspect();
		await act(async () => { reactProps(exposure).onChange?.({ currentTarget: { value: '.5', valueAsNumber: .5 } }); stale?.({}); await settle(); });
		await ui.settled(); assert.equal(await ui.f.row(), undefined); assert.equal(ui.f.writes.length, 0); assert.deepEqual(await ui.f.inspect(), before);
		await ui.click(ui.button(ui.text.savePreset)); await ui.settled(); assert.equal(ui.f.writes.filter(write => write.acknowledged).length, 1);
		const row = await ui.f.row(), retained = reactProps(ui.button(ui.text.savePreset)).onClick;
		await ui.replaceGeneration(); await act(async () => { retained?.({}); await settle(); }); await ui.settled();
		assert.deepEqual(await ui.f.row(), row); assert.equal(ui.f.writes.filter(write => write.acknowledged).length, 1); assert.deepEqual(await ui.f.inspect(), before);
	} finally { await ui.dispose(); }
});

test('Current preset Apply joins genuine preview retirement, excludes repeated clicks and joins a held native ACK on Close', async () => {
	const ui = await mountedPresets(), pauseRelease = deferred<void>(), ackRelease = deferred<void>();
	const prototype = PhotoLibraryDevelopPresentationCurrentV1.prototype, descriptor = Object.getOwnPropertyDescriptor(prototype, 'pause'), pause = prototype.pause;
	const hold = { armed: false, used: false, waiting: false, acknowledged: false }, joining: { closing?: Promise<void> } = {};
	Object.defineProperty(prototype, 'pause', { configurable: true, value: function (this: PhotoLibraryDevelopPresentationCurrentV1): Promise<void> {
		assert.ok(this instanceof PhotoLibraryDevelopPresentationCurrentV1); const actual = Reflect.apply(pause, this, []) as Promise<void>;
		if (!hold.armed || hold.used) return actual; hold.used = true;
		return actual.then(async () => { hold.waiting = true; await pauseRelease.promise; });
	} });
	try {
		await ui.open(); await ui.change(ui.named('input', ui.text.presetName), 'Repair binding'); await ui.click(ui.button(ui.text.savePreset)); await ui.settled();
		const selected = ui.settings().snapshot.presets?.presets[0]; assert.ok(selected);
		await ui.click(ui.button(ui.text.close, ui.dialog())); await ui.select(1); await ui.open(); await ui.change(ui.named('select', ui.text.choosePreset), selected.id);
		const before = await ui.f.inspect(), apply = ui.button(ui.text.applyPreset), retained = reactProps(apply).onClick;
		ui.f.hooks.afterSave = async photo => { if (photo.id === ui.f.photos[1]!.id) { hold.acknowledged = true; await ackRelease.promise; } };
		hold.armed = true; await ui.click(apply); await waitFor(async () => { await act(async () => { await settle(); }); return hold.waiting; }, 'genuine Current preset preview retirement');
		assert.equal(ui.f.saved.length, 0); assert.deepEqual(await ui.f.inspect(), before);
		await act(async () => { retained?.({}); await settle(); }); assert.equal(ui.f.saved.length, 0);
		pauseRelease.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return hold.acknowledged; }, 'genuine native preset target ACK');
		assert.equal(ui.f.saved.length, 1); const committed = await ui.f.inspect();
		assert.deepEqual(committed[0], before[0]); assert.deepEqual(committed[1]!.photo, ui.f.saved[0]);
		assert.deepEqual(committed[1]!.photo.versions[0]!.develop, before[0]!.photo.versions[0]!.develop);
		for (const [index, row] of committed.entries()) { assert.deepEqual(row.photo.original, before[index]!.photo.original); assert.deepEqual(row.bytes, before[index]!.bytes); }
		joining.closing = ui.dispose(); assert.equal(ui.dispose(), joining.closing); assert.equal(await remainsPending(joining.closing), true);
		ackRelease.resolve(); await joining.closing; assert.equal(ui.settings().owner.snapshot().batch, null);
		assert.equal(ui.f.saved.length, 1, 'The genuine durable ACK remains recorded exactly once after Close joins.');
	} finally {
		pauseRelease.resolve(); ackRelease.resolve();
		try { await joining.closing; await ui.dispose(); } finally { if (descriptor) Object.defineProperty(prototype, 'pause', descriptor); else Reflect.deleteProperty(prototype, 'pause'); }
	}
});
