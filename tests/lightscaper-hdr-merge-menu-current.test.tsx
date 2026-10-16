/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { StrictMode } from 'react';
import LightscaperAppCurrentV1 from '../src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import LightscaperAppV2 from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';

const LABELS = { en: 'Merge HDR…', de: 'HDR zusammenfügen…' } as const;

for (const locale of ['en', 'de'] as const) test(`${locale}: Current HDR is an opt-in Photo menu action, disabled before a bracket selection and inert on startup`, async () => {
	const copy = bundledLightscaperEditorCopyForLocale(locale);
	let opens = 0;
	const createSession = async (): Promise<never> => { opens++; throw new Error('An inert HDR menu cannot acquire a library.'); };
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
		return <StrictMode><LightscaperAppCurrentV1 locale={locale} createSession={createSession} /></StrictMode>;
	});
	try {
		const action = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === LABELS[locale]);
		assert.ok(action, 'The real Current App must expose HDR creation through its existing Photo menu.');
		const photo = mounted.dom.container.querySelectorAll('details').find(node => node.querySelector('summary')?.textContent === copy.photoPhotoMenu);
		assert.ok(photo); assert.equal(photo.contains(action), true); assert.equal(action.hasAttribute('disabled'), true);
		assert.equal(mounted.dom.find('[data-image-hdr-merge-dialog]'), null); assert.equal(mounted.dom.find('canvas'), null);
		assert.equal(mounted.dom.find('[data-photo-library]'), null); assert.equal(opens, 0);
	} finally { await mounted.dispose(); }
});

test('the permanent legacy App does not acquire the Current HDR operation or display its controls', async () => {
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
		return <LightscaperAppV2 locale="en" />;
	});
	try {
		assert.equal(mounted.dom.container.querySelectorAll('button').some(node => node.textContent === LABELS.en), false);
		assert.equal(mounted.dom.find('[data-image-hdr-merge-dialog]'), null);
	} finally { await mounted.dispose(); }
});
