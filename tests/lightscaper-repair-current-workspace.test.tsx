/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { inspect } from 'node:util';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspaceCurrentV1, { type PhotoDevelopWorkspacePropsCurrentV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { rectangleGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { seedCurrentAppPhoto, currentAppLocks, currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-11T00:00:00.000Z';
async function fixture() {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const session = await createPhotoLibrarySessionCurrentV1(seeded.options), original = await session.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
	const state = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone' })],
		masks: [{ ...rectangleGraph(), id: 'mask' }], maskBindings: [{ effectId: 'tone', maskId: 'mask' }] });
	const repaired = replaceImageDevelopRepairSpotsV1(state, { schemaVersion: 1, spots: [{ id: 'retained-heal', mode: 'heal', enabled: false,
		target: { x: 0.7, y: 0.5 }, source: { x: 0.3, y: 0.5 }, radius: 0.2, feather: 0.2, opacity: 1 }] });
	await session.develop.apply({ schemaVersion: 3, photoId: seeded.photo.id, expectedRevision: original.revision,
		command: { type: 'record-develop', versionId: original.versionId, develop: repaired, label: 'Repair', createdAt: TIME } });
	const runtime = createPhotoDevelopRenderRuntimeV3({ source: session.cubeLuts.source, maskSource: session.maskRasterSource });
	return { seeded, session, repaired, runtime };
}
function controls(container: ReactTestElement) {
	const button = (name: string) => { const found = container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	return { button, async click(name: string) { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); } };
}

for (const locale of ['en', 'de']) test(`${locale}: actual Current workspace preserves repairs through local masks and native Save, without advertising absent settings3`, async t => {
	const f = await fixture(), canvas = currentAppCanvasBoundary(), text = photoDevelopCopy(locale), masks = photoDevelopMaskManagementCopy(locale), demands = new Set<() => Promise<void>>();
	const execute: PhotoDevelopWorkspacePropsCurrentV1['execute'] = async (run, signal) => run({ signal: signal ?? new AbortController().signal,
		acquire: async () => f.session.develop, isCurrent: () => true, refresh: () => f.session.readPage() });
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	try {
		mounted = await mountPhotoImportUi(() => <StrictMode><PhotoDevelopWorkspaceCurrentV1 locale={locale} photoId={f.seeded.photo.id} label="Photo"
			generation={f} execute={execute} readPreview={(photoId, tier, options) => f.session.readPreview(photoId, tier, options)} loadProxy={async () => f.runtime}
			withOriginalFrame={f.session.develop.original!.withFrame} beforePresent={Promise.resolve()} onClose={() => undefined}
			registerRetirement={retire => { demands.add(retire); return () => { demands.delete(retire); }; }} /></StrictMode>);
		const current = mounted, control = controls(current.dom.container);
		await waitFor(async () => { await act(async () => { await settle(); }); return current.dom.container.querySelectorAll('button').some(value => value.textContent === masks.menu && !reactProps(value).disabled); }, 'Current workspace document');
		assert.equal(current.dom.container.querySelectorAll('button').some(value => value.textContent === photoDevelopSettingsCopy(locale).copy), false);
		assert.ok(current.dom.container.querySelectorAll('button').find(value => value.textContent === (locale === 'de' ? 'Flecken reparieren…' : 'Repair spots…')));
		await control.click(masks.menu); await control.click(masks.remove); await control.click(masks.apply);
		assert.equal(reactProps(control.button(text.save)).disabled, false);
		const before = await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id }); assert.deepEqual(before.develop, f.repaired);
		await control.click(text.save);
		try { await waitFor(async () => { await act(async () => { await settle(); }); return control.button(text.save).hasAttribute('disabled'); }, 'native Current Save ACK'); }
		catch (error) {
			t.diagnostic(JSON.stringify({ alerts: current.dom.container.querySelectorAll('[role=alert]').map(value => value.textContent) }));
			try { const observed = await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id });
				t.diagnostic(JSON.stringify({ nativeRevision: observed.revision, nativeDevelop: observed.develop })); }
			catch { t.diagnostic('Native Current read also refused during the failed Save.'); }
			const retired = await Promise.allSettled([...demands].map(retire => retire())); t.diagnostic(JSON.stringify({ retirements: retired.map(value => value.status),
				saveDisabled: reactProps(control.button(text.save)).disabled, discardDisabled: reactProps(control.button(text.discard)).disabled }));
			for (const value of retired) if (value.status === 'rejected') t.diagnostic(inspect(value.reason, { customInspect: false, getters: false, depth: 3, maxArrayLength: 8 }));
			throw error;
		}
		const after = await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id }); assert.equal(after.revision, before.revision + 1);
		assert.equal(after.develop.processVersion, 3); if (after.develop.processVersion === 3) assert.deepEqual(after.develop.repairs, f.repaired.repairs);
		assert.deepEqual(after.develop.masks, []); assert.deepEqual(after.develop.maskBindings, []); assert.deepEqual(after.develop.effects, before.develop.effects);
	} finally { try { await mounted?.dispose(); await Promise.all([...demands].map(retire => retire())); await f.session.close(); } finally { canvas.restore(); } }
});

test('Current workspace replacement rejects a retained local mask Apply before changing the new selected draft', async t => {
	const f = await fixture(), canvas = currentAppCanvasBoundary(), text = photoDevelopCopy('en'), masks = photoDevelopMaskManagementCopy('en'), retirements: (() => Promise<void>)[] = []; let generation: unknown = f;
	const execute: PhotoDevelopWorkspacePropsCurrentV1['execute'] = async (run, signal) => run({ signal: signal ?? new AbortController().signal,
		acquire: async () => f.session.develop, isCurrent: () => true, refresh: () => f.session.readPage() });
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	try {
		mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceCurrentV1 locale="en" photoId={f.seeded.photo.id} label="Photo" generation={generation}
			execute={execute} readPreview={(id, tier, options) => f.session.readPreview(id, tier, options)} loadProxy={async () => f.runtime}
			beforePresent={Promise.resolve()} registerRetirement={retire => { retirements.push(retire); return () => undefined; }} onClose={() => undefined} />);
		const current = mounted, control = controls(current.dom.container);
		const ready = async () => { await waitFor(async () => { await act(async () => { await settle(); }); return current.dom.container.querySelectorAll('button').some(value => value.textContent === masks.menu && !reactProps(value).disabled); }, 'selected Current document'); };
		await ready(); await control.click(masks.menu); await control.click(masks.remove); const oldApply = reactProps(control.button(masks.apply)).onClick;
		generation = {}; await current.render();
		try { await ready(); } catch (error) {
			t.diagnostic(JSON.stringify({ alerts: current.dom.container.querySelectorAll('[role=alert]').map(value => value.textContent) }));
			try { const observed = await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id });
				t.diagnostic(JSON.stringify({ nativeRevision: observed.revision, nativeDevelop: observed.develop })); }
			catch { t.diagnostic('Native Current read also refused during failed replacement.'); }
			const retired = await Promise.allSettled(retirements.map(retire => retire()));
			for (const value of retired) if (value.status === 'rejected') t.diagnostic(inspect(value.reason, { customInspect: false, getters: false, depth: 3, maxArrayLength: 8 }));
			throw error;
		}
		await act(async () => { oldApply?.({}); await settle(); }); assert.equal(reactProps(control.button(text.save)).disabled, true);
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.seeded.photo.id }); assert.deepEqual(saved.develop, f.repaired);
	} finally { try { await mounted?.dispose(); await Promise.all(retirements.map(retire => retire())); await f.session.close(); } finally { canvas.restore(); } }
});
