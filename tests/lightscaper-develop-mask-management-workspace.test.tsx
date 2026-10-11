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

const SOURCE = `brush-mask-v1:2:1:${'a'.repeat(64)}`;
const words = {
	en: { menu: 'Manage masks…', mask: 'Mask', duplicate: 'Duplicate mask', apply: 'Apply changes', close: 'Close' },
	de: { menu: 'Masken verwalten…', mask: 'Maske', duplicate: 'Maske duplizieren', apply: 'Änderungen anwenden', close: 'Schließen' },
};
function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [
		{ id: 'tone', type: 'tone-ladder-v1', enabled: false, params: { exposure: -1 } },
	], masks: [{ schemaVersion: 1, id: 'brush', kind: 'matte', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: SOURCE }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }, { id: 'inverted', kind: 'invert', inputNodeId: 'alpha' }], outputNodeId: 'inverted' }],
	maskBindings: [{ effectId: 'tone', maskId: 'brush' }] });
}

// This controlled Node host verifies scalar persistence and ownership. Native browser
// tests separately authenticate the installed immutable brush body and rendered pixels.
async function workspace(locale: keyof typeof words, withSettings: boolean, seeded = true) {
	const fixture = await currentDevelopFixture(1), photoId = fixture.photos[0]!.id;
	if (seeded) {
		const initial = await fixture.develop.read({ schemaVersion: 2, photoId });
		await fixture.develop.apply({ schemaVersion: 2, photoId, expectedRevision: initial.revision,
			command: { type: 'record-develop', versionId: initial.versionId, develop: recipe(), label: 'Seed masks', createdAt: CURRENT_TIME } });
	}
	const before = (await fixture.repository.loadPhoto('catalog-1', photoId))!;
	const execute: ExecutePhotoDevelopV2 = async (run, signal) => {
		await run({ signal: signal!, isCurrent: () => true, acquire: async () => fixture.develop, refresh: async () => undefined });
	};
	const settingsOwner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute });
	const settings = withSettings ? { owner: settingsOwner, drain: () => settingsOwner.cancel(), snapshot: settingsOwner.snapshot() } : undefined;
	const readPreview = async () => ({ outcome: 'missing' as const });
	const loadProxy = async (): Promise<never> => { throw Error('Missing preview has no decoder'); };
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
	const control = () => mounted.dom.container.querySelectorAll('select').find(node => node.getAttribute('aria-label') === words[locale].mask);
	const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({}); await settle(); }); };
	const select = async (id: string) => { const target = control(); assert.ok(target); await act(async () => { reactProps(target).onChange?.({ currentTarget: { value: id } }); }); };
	const open = async () => {
		await click(button(words[locale].menu));
		for (let turn = 0; turn < 64 && !control(); turn++) await flush();
		assert.ok(control(), 'Menu opens the lazy manager');
	};
	await flush();
	return { ...mounted, fixture, photoId, before, flush, button, control, click, select, open,
		async replaceOwner() { generation = {}; await mounted.render(); await flush(); },
		async dispose() { await mounted.dispose(); await settingsOwner.close(); await fixture.close(); },
	};
}

for (const locale of ['en', 'de'] as const) for (const withSettings of [false, true]) {
	test(`${locale}: ${withSettings ? 'selected settings' : 'fallback settings'} menu manages complex brush graphs through actual Save/history`, async () => {
		const f = await workspace(locale, withSettings), text = words[locale], develop = photoDevelopCopy(locale);
		try {
			assert.equal(f.control(), undefined, 'Manager is absent before opting in');
			const entry = f.button(text.menu); assert.equal(entry.parentNode?.nodeName, 'DETAILS');
			await f.open(); await f.select('brush'); await f.click(f.button(text.duplicate));
			assert.equal(f.control()!.options.length, 2);
			assert.deepEqual(await f.fixture.repository.loadPhoto('catalog-1', f.photoId), f.before, 'Local edits do not publish');
			await f.click(f.button(text.close));
			await f.open(); assert.equal(f.control()!.options.length, 1, 'Close discards local edits');
			await f.select('brush'); await f.click(f.button(text.duplicate)); await f.click(f.button(text.apply));
			assert.equal(f.control(), undefined); assert.equal(f.button(develop.save).hasAttribute('disabled'), false);
			assert.deepEqual(await f.fixture.repository.loadPhoto('catalog-1', f.photoId), f.before, 'Apply only edits the current draft');
			await f.click(f.button(develop.save));
			const current = await f.fixture.develop.read({ schemaVersion: 2, photoId: f.photoId });
			const duplicate = current.develop.masks.find(mask => mask.id !== 'brush'); assert.ok(duplicate);
			assert.deepEqual(duplicate, { ...recipe().masks[0], id: duplicate.id });
			assert.deepEqual(current.develop.maskBindings, recipe().maskBindings); assert.deepEqual(current.develop.effects, recipe().effects);
			assert.equal(current.history.entries.length, 3); assert.equal(current.history.cursor, 2);
			const after = (await f.fixture.repository.loadPhoto('catalog-1', f.photoId))!;
			assert.deepEqual(after.original, f.before.original); assert.deepEqual(after.metadata, f.before.metadata);
			assert.deepEqual(after.extractedMetadata, f.before.extractedMetadata);
			await f.click(f.button(develop.reload)); await f.open(); assert.equal(f.control()!.options.length, 2);
		} finally { await f.dispose(); }
	});
}

for (const retirement of ['close', 'owner'] as const) test(`retained manager Apply cannot edit after ${retirement} retirement`, async () => {
	const f = await workspace('en', true), text = words.en, develop = photoDevelopCopy('en');
	try {
		await f.open(); await f.select('brush'); await f.click(f.button(text.duplicate));
		const staleApply = reactProps(f.button(text.apply)).onClick!;
		if (retirement === 'close') await f.click(f.button(text.close)); else await f.replaceOwner();
		await act(async () => { staleApply({}); await settle(); });
		assert.equal(f.button(develop.save).hasAttribute('disabled'), true);
		assert.deepEqual(await f.fixture.repository.loadPhoto('catalog-1', f.photoId), f.before);
	} finally { await f.dispose(); }
});

test('empty recipe still reaches the mask manager from Settings', async () => {
	const f = await workspace('en', false, false);
	try { await f.open(); assert.deepEqual(f.control()!.options.map(option => option.value), ['']); await f.click(f.button(words.en.close)); }
	finally { await f.dispose(); }
});

test('a retained manager Apply cannot overwrite a same-turn edit from the actual effect controls', async () => {
	const f = await workspace('en', true), text = words.en, develop = photoDevelopCopy('en');
	try {
		await f.open(); await f.select('brush'); await f.click(f.button(text.duplicate));
		const staleApply = reactProps(f.button(text.apply)).onClick!, add = reactProps(f.button(develop.add)).onClick!;
		await act(async () => { add({}); staleApply({}); await settle(); });
		await f.click(f.button(develop.save));
		const current = await f.fixture.develop.read({ schemaVersion: 2, photoId: f.photoId });
		assert.equal(current.develop.effects.length, 2, 'The effect edit owns the new current draft');
		assert.deepEqual(current.develop.masks, recipe().masks, 'The retired manager cannot publish its local duplicate');
	} finally { await f.dispose(); }
});
