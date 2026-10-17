/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import LightscaperAppV2 from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const locale of ['en', 'de']) test(`${locale}: editable Framescaper copy is an opt-in File Photo action`, async () => {
	const label = locale === 'de' ? 'Bearbeitbare Framescaper-Kopie herunterladen…' : 'Download editable Framescaper copy…';
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperAppV2 locale={locale} />;
	});
	try {
		const menu = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === label);
		assert.ok(menu, 'The editable-copy action must be reachable through the existing menu.');
		const photoMenu = menu.closest('details'); assert.ok(photoMenu);
		assert.equal(photoMenu.querySelector('summary')?.textContent, locale === 'de' ? 'Foto' : 'Photo');
		const parent = photoMenu.parentNode; assert.ok(parent instanceof ReactTestElement);
		assert.equal(parent.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
		assert.equal(reactProps(menu).disabled, true, 'An absent selected photo cannot acquire export authority.');
		assert.equal(mounted.dom.find('[data-photo-framescaper-handoff-dialog]'), null);
	} finally { await mounted.dispose(); }
});

for (const locale of ['en', 'de']) test(`${locale}: receive editable photo is a separate opt-in File action`, async () => {
	const label = locale === 'de' ? 'Bearbeitbares Framescaper-Foto importieren…' : 'Import editable Framescaper photo…';
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperAppV2 locale={locale} />;
	});
	try {
		const menu = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === label);
		assert.ok(menu, 'Receiving a saved editable archive must be reachable through File.');
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
		assert.equal(reactProps(menu).disabled, true, 'No selected Session factory grants receive authority.');
		assert.equal(mounted.dom.find('[data-photo-framescaper-receive-dialog]'), null);
	} finally { await mounted.dispose(); }
});

for (const locale of ['en', 'de']) test(`${locale}: collection sequence is a cold File Photo action independent of photo selection`, async () => {
	const label = locale === 'de' ? 'Sammlung als Framescaper-Sequenz herunterladen…' : 'Download collection as Framescaper sequence…';
	let sessions = 0, destinations = 0;
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperAppV2 locale={locale} createSession={async () => { sessions++; throw new Error('The menu has not been opened.'); }}
			loadBackupSaveRuntime={async () => { destinations++; throw new Error('No download gesture was admitted.'); }} />;
	});
	try {
		const menu = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === label);
		assert.ok(menu, 'The collection action must be reachable through the existing menu.');
		const photoMenu = menu.closest('details'); assert.ok(photoMenu);
		assert.equal(photoMenu.querySelector('summary')?.textContent, locale === 'de' ? 'Foto' : 'Photo');
		const parent = photoMenu.parentNode; assert.ok(parent instanceof ReactTestElement);
		assert.equal(parent.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Datei' : 'File');
		assert.equal(reactProps(menu).disabled, false, 'A collection choice does not require a selected photo or open library.');
		assert.equal(reactProps(mounted.dom.one('[data-photo-framescaper-handoff-menu]')).disabled, true);
		assert.equal(mounted.dom.find('[data-photo-framescaper-collection-handoff-dialog]'), null);
		assert.equal(sessions, 0); assert.equal(destinations, 0);
	} finally { await mounted.dispose(); }
});
