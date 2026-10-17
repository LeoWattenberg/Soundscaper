/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspaceV2 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceV2.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { normalizeImageDevelopStateV1OrV2, defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { currentDevelopFixture, CURRENT_TIME } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';

const words = {
	en: { menu: 'Manage masks…', mask: 'Mask', show: 'Show mask overlay', display: 'Mask display', effect: 'Overlay effect',
		gray: 'Grayscale mask', apply: 'Apply changes', name: 'Mask name', rename: 'Rename mask', close: 'Close' },
	de: { menu: 'Masken verwalten…', mask: 'Maske', show: 'Maskenüberlagerung anzeigen', display: 'Maskenanzeige', effect: 'Anpassung für die Überlagerung',
		gray: 'Graustufenmaske', apply: 'Änderungen anwenden', name: 'Maskenname', rename: 'Maske umbenennen', close: 'Schließen' },
};
function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } },
	], masks: [{ schemaVersion: 1, id: 'gradient', kind: 'mask', inputs: [], nodes: [
		{ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
	], outputNodeId: 'coverage' }], maskBindings: [{ effectId: 'tone', maskId: 'gradient' }] });
}

// This mounted boundary uses a missing preview: it proves menu/recipe ownership,
// while presentation and native tests independently prove actual coverage bytes.
async function workspace(locale: keyof typeof words, withSettings: boolean) {
	const fixture = await currentDevelopFixture(1), photoId = fixture.photos[0]!.id;
	const initial = await fixture.develop.read({ schemaVersion: 2, photoId });
	await fixture.develop.apply({ schemaVersion: 2, photoId, expectedRevision: initial.revision,
		command: { type: 'record-develop', versionId: initial.versionId, develop: recipe(), label: 'Seed mask', createdAt: CURRENT_TIME } });
	const before = (await fixture.repository.loadPhoto('catalog-1', photoId))!;
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const settingsOwner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute });
	const settings = withSettings ? { owner: settingsOwner, drain: () => settingsOwner.cancel(), snapshot: settingsOwner.snapshot() } : undefined;
	const readPreview = async () => ({ outcome: 'missing' as const }), loadProxy = async (): Promise<never> => { throw Error('Missing preview has no decoder'); };
	const beforePresent = Promise.resolve(), registerRetirement = () => () => undefined;
	let generation: unknown = fixture;
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceV2 locale={locale} photoId={photoId} label="Photo"
		generation={generation} execute={execute} readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent}
		registerRetirement={registerRetirement} settings={settings} onClose={() => undefined} />);
	const flush = async () => { await act(async () => { await settle(); }); };
	const button = (label: string) => {
		const found = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label);
		assert.ok(found, label); return found;
	};
	const selectControl = (label: string) => mounted.dom.container.querySelectorAll('select').find(node => node.getAttribute('aria-label') === label);
	const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({}); await settle(); }); };
	const select = async (label: string, value: string) => {
		const target = selectControl(label); assert.ok(target, label);
		await act(async () => { reactProps(target).onChange?.({ currentTarget: { value } }); });
	};
	const show = () => mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === words[locale].show);
	const open = async () => {
		await click(button(words[locale].menu));
		for (let turn = 0; turn < 64 && !selectControl(words[locale].mask); turn++) await flush();
		assert.ok(selectControl(words[locale].mask));
	};
	const enableGrayscale = async () => {
		assert.ok(show()); await act(async () => { reactProps(show()!).onChange?.({ currentTarget: { checked: true } }); });
		await select(words[locale].effect, 'tone'); await select(words[locale].display, 'grayscale');
	};
	const overlay = () => mounted.dom.container.querySelectorAll('canvas').find(node => node.getAttribute('data-photo-develop-mask-overlay') !== null);
	await flush();
	return { ...mounted, fixture, photoId, before, flush, button, selectControl, click, select, show, open, enableGrayscale, overlay,
		async replaceOwner() { generation = {}; await mounted.render(); await flush(); },
		async dispose() { await mounted.dispose(); await settingsOwner.close(); await fixture.close(); },
	};
}

for (const locale of ['en', 'de'] as const) for (const withSettings of [false, true]) {
	test(`${locale}: grayscale is an ephemeral opt-in view through ${withSettings ? 'selected' : 'fallback'} Settings`, async () => {
		const f = await workspace(locale, withSettings), text = words[locale], develop = photoDevelopCopy(locale);
		try {
			assert.equal(f.overlay(), undefined); assert.equal(f.selectControl(text.display), undefined);
			assert.equal(f.button(text.menu).parentNode?.nodeName, 'DETAILS');
			await f.open(); assert.equal(f.show()!.checked, false); assert.equal(f.selectControl(text.display), undefined);
			await f.enableGrayscale(); await f.click(f.button(text.apply));
			assert.equal(f.selectControl(text.mask), undefined);
			assert.equal(f.overlay()?.getAttribute('data-mode'), 'grayscale');
			assert.equal(f.overlay()?.getAttribute('aria-label'), text.gray);
			assert.equal(f.button(develop.save).hasAttribute('disabled'), true, 'Display-only Apply does not dirty the recipe');
			assert.deepEqual(await f.fixture.repository.loadPhoto('catalog-1', f.photoId), f.before);
			await f.open(); assert.equal(f.show()!.checked, false, 'Reopened manager opts in again');
			await act(async () => { reactProps(f.show()!).onChange?.({ currentTarget: { checked: true } }); });
			assert.equal(Object.getOwnPropertyDescriptor(reactProps(f.selectControl(text.display)!), 'value')?.value, 'color', 'Reopened manager starts with the legacy mode');
			await f.click(f.button(text.close));
			await f.replaceOwner(); assert.equal(f.overlay(), undefined, 'Owner replacement retires ephemeral coverage');
		} finally { await f.dispose(); }
	});
}

test('grayscale plus a mask rename saves only the recipe and is retired by a later effect edit', async () => {
	const f = await workspace('en', true), text = words.en, develop = photoDevelopCopy('en');
	try {
		await f.open(); await f.enableGrayscale();
		const name = f.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.name); assert.ok(name);
		await act(async () => { reactProps(name).onChange?.({ currentTarget: { value: 'Sky' } }); });
		await f.click(f.button(text.rename)); await f.click(f.button(text.apply));
		assert.equal(f.overlay()?.getAttribute('data-mode'), 'grayscale'); await f.click(f.button(develop.save));
		const current = await f.fixture.develop.read({ schemaVersion: 2, photoId: f.photoId });
		assert.deepEqual(current.develop, { ...recipe(), masks: [{ ...recipe().masks[0], schemaVersion: 2, name: 'Sky' }] });
		assert.equal(current.history.entries.length, 3); assert.equal(current.history.cursor, 2);
		const saved = (await f.fixture.repository.loadPhoto('catalog-1', f.photoId))!;
		assert.deepEqual(saved.original, f.before.original); assert.deepEqual(saved.metadata, f.before.metadata);
		await f.click(f.button(develop.add)); assert.equal(f.overlay(), undefined, 'A changed draft invalidates the coverage view');
		await f.click(f.button(develop.reload)); await f.open(); assert.equal(f.show()!.checked, false);
	} finally { await f.dispose(); }
});

for (const retirement of ['close', 'owner', 'same-turn-effect'] as const) test(`retained grayscale Apply cannot publish after ${retirement}`, async () => {
	const f = await workspace('en', false), text = words.en, develop = photoDevelopCopy('en');
	try {
		await f.open(); await f.enableGrayscale(); const retained = reactProps(f.button(text.apply)).onClick!;
		if (retirement === 'close') await f.click(f.button(text.close));
		else if (retirement === 'owner') await f.replaceOwner();
		else { const add = reactProps(f.button(develop.add)).onClick!; await act(async () => { add({}); retained({}); await settle(); }); }
		await act(async () => { retained({}); await settle(); });
		assert.equal(f.overlay(), undefined); assert.deepEqual(await f.fixture.repository.loadPhoto('catalog-1', f.photoId), f.before);
	} finally { await f.dispose(); }
});
