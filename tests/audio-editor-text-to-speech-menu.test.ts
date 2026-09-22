/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalProcessingMenus } from '../src/common/editor/ui/local-processing-menus.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { resolveCatalog } from '../src/common/i18n/runtime.js';

test('desktop Generate menu opens Text to Speech in both products without selected media', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		let opened = 0;
		const menus = prepareLocalProcessingMenus([{ id: 'generate', items: [] }], {
			productId, locale: 'en', copy: { 'ui.textToSpeech.title': 'Text to Speech' },
			capabilities: { assistanceAssets: true }, snapshot: {},
			actions: { openLocalAssistance: () => undefined, openTextToSpeech: () => { opened++; } },
		});
		const displayed = filterProductMenus(menus, {
			assistanceAssets: true, audioGenerators: productId === 'soundscaper',
		}, productId);
		const entry = displayed[0]?.items?.find((item: { id: string }) => item.id === 'text-to-speech');
		assert.equal(entry?.label, 'Text to Speech…');
		assert.equal(entry?.disabled, false);
		entry?.onClick?.();
		assert.equal(opened, 1);
	}
});

test('speech copy stays localized in German and falls back to English elsewhere', async () => {
	const english = await resolveCatalog('en') as Readonly<Record<string, string>>;
	const german = await resolveCatalog('de') as Readonly<Record<string, string>>;
	const french = await resolveCatalog('fr') as Readonly<Record<string, string>>;
	assert.equal(english['ui.textToSpeech.title'], 'Text to Speech');
	assert.equal(german['ui.textToSpeech.title'], 'Text zu Sprache');
	assert.equal(english['ui.textToSpeech.modelPurpose'], 'Speech synthesis');
	assert.equal(german['ui.textToSpeech.modelPurpose'], 'Sprachsynthese');
	assert.equal(french['ui.textToSpeech.title'], english['ui.textToSpeech.title']);
	assert.equal(french['ui.textToSpeech.modelPurpose'], english['ui.textToSpeech.modelPurpose']);
});

test('Text to Speech stays absent in web builds and disabled during blocked editing', () => {
	const base = [{ id: 'generate', items: [] }];
	const options = {
		productId: 'soundscaper', locale: 'en', copy: {},
		capabilities: { assistanceAssets: true }, snapshot: {},
		actions: { openLocalAssistance: () => undefined, openTextToSpeech: () => undefined },
	};
	assert.equal(prepareLocalProcessingMenus(base, { ...options, actions: {
		openLocalAssistance: () => undefined,
	} })[0]?.items?.some(({ id }) => id === 'text-to-speech'), false);
	assert.equal(prepareLocalProcessingMenus(base, { ...options, capabilities: {
		assistanceAssets: false,
	} })[0]?.items?.some(({ id }) => id === 'text-to-speech'), false);
	assert.equal(prepareLocalProcessingMenus(base, { ...options, editBlocked: true })[0]?.items?.find(
		({ id }) => id === 'text-to-speech',
	)?.disabled, true);
});
