/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { usePhotoDevelopSettingsCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-develop-settings-current-v1.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { PhotoLibraryDevelopWorkflowCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../src/common/editor/controller/shared/photo-library-workflow-slot.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

const readPreview = async () => ({ outcome: 'missing' as const });
const loadProxy = async () => createPhotoDevelopRenderRuntimeV3();
const registerRetirement = () => () => undefined;
const beforePresent = Promise.resolve();
async function fixture(locale = 'en', retainedLegacy = false, presentationBarrier = beforePresent) {
	const f = await repairSettingsFixture(), text = photoDevelopSettingsCopy(locale), messages = photoDevelopCopy(locale);
	if (retainedLegacy) {
		const document = await f.read(); await f.session.develop.apply({ schemaVersion: 3, photoId: document.photoId, expectedRevision: document.revision,
			command: { type: 'select-develop-history', versionId: document.versionId, cursor: 0 } });
	}
	let photoIndex = 0, generation: unknown = f.session, settings!: ReturnType<typeof usePhotoDevelopSettingsCurrentV1>, closed = 0;
	const demandRetirements = new Set<() => Promise<void>>();
	const registerDemandRetirement = (retire: () => Promise<void>) => { demandRetirements.add(retire); return () => { demandRetirements.delete(retire); }; };
	function View() {
		settings = usePhotoDevelopSettingsCurrentV1({ generation, execute: f.execute });
		const current = { settingsCurrent: settings };
		return <PhotoDevelopWorkspaceCurrentV1 {...current} locale={locale} photoId={f.photos[photoIndex]!.id} catalogId={f.photos[0]!.catalogId}
			selectedIds={f.photos.map(photo => photo.id)} label="Selected photo" generation={generation} execute={f.execute} readPreview={readPreview}
			loadProxy={loadProxy} beforePresent={presentationBarrier} registerRetirement={registerRetirement} registerDemandRetirement={registerDemandRetirement} onClose={() => { closed++; }} />;
	}
	// Native-like canvas backing cleanup is qualified; no Original/decoder is
	// injected and this scalar menu witness makes no rendered-pixel claim.
	const canvas = currentAppCanvasBoundary();
	const mounted = await mountPhotoImportUi(() => <StrictMode><View /></StrictMode>).catch(async (error: unknown) => {
		canvas.restore(); await f.close(); throw error;
	});
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === name).at(-1); assert.ok(node, name); return node; };
	const click = async (node: ReactTestElement) => { await act(async () => { reactProps(node).onClick?.({ currentTarget: node }); await settle(); }); };
	const settled = async () => waitFor(async () => { await act(async () => { await settle(); });
		return !settings.snapshot.busy && mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === messages.cancel).every(node => node.hasAttribute('disabled'));
	}, 'actual settings and Develop demands join');
	const named = (tag: 'input' | 'select', label: string) => { const node = mounted.dom.container.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
	const change = async (node: ReactTestElement, value: string) => { await act(async () => { reactProps(node).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); await settle(); }); };
	const settingsDialog = () => mounted.dom.container.querySelectorAll('[role="dialog"]').find(node =>
		[text.copy, text.sync, text.auto, text.quick].includes(node.getAttribute('aria-label') ?? ''));
	const closeSettings = async () => {
		const dialog = settingsDialog(); assert.ok(dialog, 'The opted-in settings dialog remains active.');
		const close = dialog.querySelectorAll('button').filter(node => node.textContent === text.close).at(-1); assert.ok(close);
		await click(close); assert.equal(settingsDialog(), undefined); assert.ok(mounted.dom.find('[data-photo-develop-workspace]'));
		assert.equal(closed, 0, 'Closing settings keeps the actual Develop owner alive.');
	};
	const dispose = async () => {
		const failures: unknown[] = [];
		try { await act(async () => {
			await joinPhotoLibraryRetirementV1([...demandRetirements].map(retire => { try { return retire(); } catch (error) { return Promise.reject(error); } }));
			await settle();
		}); } catch (error) { failures.push(error); }
		for (const close of [() => mounted.dispose(), () => settings.owner.close(), () => f.close()]) {
			try { await close(); } catch (error) { failures.push(error); }
		}
		canvas.restore();
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Current settings fixture cleanup failed.');
	};
	try { await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelectorAll('details').some(node => node.getAttribute('class')?.includes('lightscaper-develop-settings-menu')); }, 'actual Current Workspace document and Settings menu'); }
	catch (error) { await dispose(); throw error; }
	return { ...mounted, f, text, messages, button, click, named, change, settled, closeSettings, settingsDialog, settings: () => settings, closed: () => closed,
		async select(index: number) { photoIndex = index; await mounted.render(); await settled(); },
		async replaceGeneration() { generation = {}; await mounted.render(); await settled(); },
		dispose,
	};
}

for (const locale of ['en', 'de']) for (const retained of [false, true]) test(`${locale}: opted-in Current Settings menu admits ${retained ? 'retained repairs with an active legacy recipe' : 'the complete repaired recipe'} with Current presets reachable from Settings`, async () => {
	const ui = await fixture(locale, retained);
	try {
		const row = (await ui.f.inspect())[0]!.photo; assert.equal(row.schemaVersion, 3);
		if (retained) { assert.equal((await ui.f.read()).develop.processVersion, 1); await assert.rejects(ui.f.session.legacyDevelop!.read({ schemaVersion: 2, photoId: row.id })); }
		const copy = ui.button(ui.text.copy), details = copy.closest('details'); assert.ok(details);
		assert.equal(details.querySelector('summary')?.textContent, locale === 'de' ? 'Einstellungen' : 'Settings');
		assert.equal(details.querySelectorAll('button').filter(node => node.textContent === ui.text.presets).length, 1);
		assert.equal(ui.dom.container.querySelectorAll('[role="dialog"]').some(node => node.getAttribute('aria-label') === ui.text.presets), false, 'Preset management remains opt-in.');
		assert.equal(ui.dom.container.querySelectorAll('button').some(node => node.textContent === ui.text.confirmCopy), false);
		await ui.click(copy); assert.ok(ui.button(ui.text.confirmCopy));
		const repairLabel = locale === 'de' ? 'Reparaturstellen' : 'Repair spots';
		const repair = ui.dom.container.querySelectorAll('input').find(node => node.parentNode?.textContent === repairLabel); assert.ok(repair);
		assert.equal(reactProps(repair).checked, true); await ui.click(ui.button(ui.text.confirmCopy)); await ui.settled();
		assert.equal(ui.settings().snapshot.clipboard?.schemaVersion, 4);
	} finally { await ui.dispose(); }
});

test('Current Settings copy survives another photo selection, Paste and Sync use actual native ACKs, and Quick retains complete repairs', async () => {
	const ui = await fixture(), before = await ui.f.inspect();
	try {
		await ui.click(ui.button(ui.text.copy)); await ui.click(ui.button(ui.text.confirmCopy)); await ui.settled();
		const packet = ui.settings().snapshot.clipboard; assert.ok(packet); await ui.select(1); assert.equal(ui.settings().snapshot.clipboard, packet);
		await ui.click(ui.button(ui.text.paste)); await ui.settled(); assert.equal((await ui.f.read(1)).develop.processVersion, 3);
		assert.deepEqual((await ui.f.read(1)).develop, (await ui.f.read()).develop);
		await ui.select(0); await ui.click(ui.button(ui.text.sync)); await ui.click(ui.button(ui.text.confirmSync)); await ui.settled();
		assert.equal(ui.settings().snapshot.batch?.outcomes.length, 1); assert.equal(ui.settings().snapshot.batch?.outcomes[0]?.status, 'unchanged');
		await ui.closeSettings(); await ui.click(ui.button(ui.text.quick)); assert.equal(ui.settingsDialog()?.getAttribute('aria-label'), ui.text.quick);
		await ui.change(ui.named('input', ui.text.delta), '.5');
		await ui.click(ui.button(ui.text.applyQuick)); await ui.settled();
		for (const [index, entry] of (await ui.f.inspect()).entries()) {
			const doc = await ui.f.read(index); assert.equal(doc.develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, .5);
			assert.deepEqual(Reflect.get(doc.develop, 'repairs'), Reflect.get(packet.develop, 'repairs'));
			assert.deepEqual(entry.photo.original, before[index]!.photo.original); assert.deepEqual(entry.bytes, before[index]!.bytes);
		}
	} finally { await ui.dispose(); }
});

test('Current Auto-sync waits for the genuine source Save ACK and never recursively synchronizes target ACKs', async () => {
	const ui = await fixture(), entered = deferred<void>(), release = deferred<void>();
	try {
		await ui.click(ui.button(ui.text.auto)); await ui.click(ui.button(ui.text.confirmAuto)); await ui.settled(); assert.equal(ui.settings().snapshot.autoSync, true);
		const before = await ui.f.read(1); await ui.click(ui.button(ui.messages.add));
		const temperature = () => ui.named('input', `${ui.messages.shared.videoEffectExactValue}: ${ui.messages.shared.videoEffectParamTemperature}`);
		await ui.change(temperature(), '.25'); await ui.settled(); assert.equal((await ui.f.read(1)).revision, before.revision, 'Unsaved draft edits never Auto-sync.');
		ui.f.hooks.afterSave = async photo => { if (photo.id === ui.f.photos[0]!.id) { entered.resolve(); await release.promise; } };
		await ui.click(ui.button(ui.messages.save));
		await waitFor(async () => { await act(async () => { await settle(); }); return ui.f.saved.length === 1 || ui.dom.find('[role="alert"]') !== null; }, 'native source Save before ACK delivery');
		assert.equal(ui.f.saved.length, 1); await entered.promise; assert.equal((await ui.f.read(1)).revision, before.revision);
		release.resolve(); await ui.settled();
		assert.equal((await ui.f.read(1)).revision, before.revision + 1); assert.equal((await ui.f.read(1)).develop.effects[0]?.params.temperature, .25);
		assert.equal(ui.f.saved.length, 2, 'One true source ACK causes exactly one target ACK.');
		await ui.change(temperature(), '.5'); await ui.click(ui.button(ui.messages.discard)); await ui.settled();
		assert.equal((await ui.f.read(1)).revision, before.revision + 1); assert.equal(ui.f.saved.length, 2);
	} finally { release.resolve(); await ui.dispose(); }
});

test('Current Settings retained same-event draft and replaced-generation handlers cannot copy an obsolete source', async () => {
	const ui = await fixture();
	try {
		await ui.click(ui.button(ui.messages.add)); const stale = reactProps(ui.button(ui.text.copy)).onClick;
		const input = ui.named('input', `${ui.messages.shared.videoEffectExactValue}: ${ui.messages.shared.videoEffectParamTemperature}`);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: '.4', valueAsNumber: .4 } }); stale?.({}); await settle(); });
		assert.equal(ui.dom.container.querySelectorAll('button').some(node => node.textContent === ui.text.confirmCopy), false, 'The actual owner draft changes before React commits the next render.');
		assert.equal(ui.settings().snapshot.clipboard, null); await ui.click(ui.button(ui.text.copy)); const confirm = reactProps(ui.button(ui.text.confirmCopy)).onClick;
		await ui.replaceGeneration(); await act(async () => { confirm?.({}); await settle(); });
		assert.equal(ui.settings().snapshot.clipboard, null); assert.equal(ui.f.saved.length, 0);
	} finally { await ui.dispose(); }
});

test('Current Quick Develop joins genuine preview retirement before native Source and Target writes', async () => {
	const ui = await fixture(), before = await ui.f.inspect(), release = deferred<void>();
	const prototype = PhotoLibraryDevelopPresentationCurrentV1.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'pause'), pause = prototype.pause;
	const hold = { armed: false, waiting: false, used: false }, joins = new Set<Promise<void>>();
	Object.defineProperty(prototype, 'pause', { configurable: true, value: function (this: PhotoLibraryDevelopPresentationCurrentV1): Promise<void> {
		assert.ok(this instanceof PhotoLibraryDevelopPresentationCurrentV1);
		const actual = Reflect.apply(pause, this, []) as Promise<void>;
		if (!hold.armed || hold.used) return actual;
		hold.used = true;
		// Hold only the genuine retirement delivery, after the native owner
		// has settled; no Original, frame, decoder or validation is replaced.
		const joined = actual.then(async () => { hold.waiting = true; await release.promise; });
		joins.add(joined); return joined;
	} });
	try {
		await ui.settled(); await ui.click(ui.button(ui.text.quick)); await ui.change(ui.named('input', ui.text.delta), '.5');
		hold.armed = true; await ui.click(ui.button(ui.text.applyQuick));
		await waitFor(async () => { await act(async () => { await settle(); }); return hold.waiting; }, 'actual Current preview pause delivery');
		assert.equal(ui.f.saved.length, 0, 'No native Source or Target save may precede the joined preview retirement.');
		assert.deepEqual(await ui.f.inspect(), before);
		release.resolve(); await ui.settled(); assert.equal(ui.f.saved.length, 2);
		assert.equal(ui.settings().snapshot.batch?.completion, 'finished');
		for (const [index, row] of (await ui.f.inspect()).entries()) {
			const current = await ui.f.read(index), previous = before[index]!.photo;
			assert.equal(current.revision, previous.revision + 1);
			assert.equal(current.develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, .5);
			assert.deepEqual(Reflect.get(current.develop, 'repairs'), Reflect.get(previous.versions[0]!.develop, 'repairs'));
			assert.deepEqual(row.photo.original, previous.original); assert.deepEqual(row.bytes, before[index]!.bytes);
		}
	} finally {
		release.resolve();
		try { await ui.dispose(); } finally {
			await Promise.allSettled(joins);
			if (descriptor) Object.defineProperty(prototype, 'pause', descriptor); else Reflect.deleteProperty(prototype, 'pause');
		}
	}
});

test('Current Quick Develop fences a queued old-revision preview continuation through both native ACKs', async () => {
	const gate = deferred<void>(), release = deferred<void>(), entered = deferred<void>();
	const opened: { owner?: PhotoLibraryDevelopWorkflowCurrentV1 } = {}, live: { ui?: Awaited<ReturnType<typeof fixture>> } = {};
	const revisions: number[] = [], observation = { armed: false };
	const workflowPrototype = PhotoLibraryDevelopWorkflowCurrentV1.prototype, presentationPrototype = PhotoLibraryDevelopPresentationCurrentV1.prototype;
	const openDescriptor = Object.getOwnPropertyDescriptor(workflowPrototype, 'open'), open = workflowPrototype.open;
	const viewDescriptor = Object.getOwnPropertyDescriptor(presentationPrototype, 'setView'), setView = presentationPrototype.setView;
	Object.defineProperty(workflowPrototype, 'open', { configurable: true, value: function (this: PhotoLibraryDevelopWorkflowCurrentV1, ...args: Parameters<typeof open>) {
		opened.owner = this; return Reflect.apply(open, this, args) as ReturnType<typeof open>;
	} });
	Object.defineProperty(presentationPrototype, 'setView', { configurable: true, value: function (this: PhotoLibraryDevelopPresentationCurrentV1, value: Parameters<typeof setView>[0]): void {
		assert.ok(this instanceof PhotoLibraryDevelopPresentationCurrentV1);
		if (observation.armed) revisions.push(value.revision);
		Reflect.apply(setView, this, [value]);
	} });
	try {
		const ui = await fixture('en', false, gate.promise); live.ui = ui; await ui.settled();
		const owner = opened.owner; assert.ok(owner); const source = await ui.f.read();
		await act(async () => {
			await ui.f.record({ ...source.develop, effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: .25 } })] });
			await owner.reload(); await settle();
		});
		const before = await ui.f.inspect(), originalRevision = before[0]!.photo.revision, saved = ui.f.saved.length;
		assert.equal(originalRevision, source.revision + 1, 'A genuine native record precedes the queued preview replacement.');
		assert.equal(owner.snapshot().document?.revision, originalRevision);
		ui.f.hooks.afterSave = async photo => { if (photo.id === ui.f.photos[0]!.id) { entered.resolve(); await release.promise; } };
		await ui.click(ui.button(ui.text.quick)); await ui.change(ui.named('input', ui.text.delta), '.5'); observation.armed = true;
		await ui.click(ui.button(ui.text.applyQuick)); gate.resolve();
		await waitFor(async () => { await act(async () => { await settle(); }); return ui.f.saved.length > saved; }, 'genuine first Quick Source ACK');
		await entered.promise;
		assert.deepEqual(revisions, [], 'No queued old-document setView may restart while the native settings writes are held.');
		assert.equal(ui.f.saved.length, saved + 1); assert.equal((await ui.f.read(1)).revision, before[1]!.photo.revision);
		release.resolve(); await ui.settled(); assert.equal(ui.f.saved.length, saved + 2);
		assert.equal(ui.settings().snapshot.batch?.completion, 'finished');
		const after = await ui.f.inspect(); assert.equal(revisions.at(-1), after[0]!.photo.revision);
		for (const [index, row] of after.entries()) {
			const current = await ui.f.read(index); assert.equal(current.develop.effects.find(effect => effect.type === 'tone-ladder-v1')?.params.exposure, index ? .5 : .75);
			assert.deepEqual(Reflect.get(current.develop, 'repairs'), Reflect.get(before[index]!.photo.versions[0]!.develop, 'repairs'));
			assert.deepEqual(row.photo.original, before[index]!.photo.original); assert.deepEqual(row.bytes, before[index]!.bytes);
		}
	} finally {
		gate.resolve(); release.resolve();
		try { await live.ui?.dispose(); } finally {
			for (const [prototype, key, descriptor] of [[workflowPrototype, 'open', openDescriptor], [presentationPrototype, 'setView', viewDescriptor]] as const) {
				if (descriptor) Object.defineProperty(prototype, key, descriptor); else Reflect.deleteProperty(prototype, key);
			}
		}
	}
});
