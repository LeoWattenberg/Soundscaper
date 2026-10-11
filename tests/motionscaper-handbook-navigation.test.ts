/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChromeResponse } from '../scripts/docs-ai/chrome.mjs';

test('Motion handbook navigation translations preserve the product name in group and title', () => {
	const labels = { 'sidebar.motionscaper': 'Motionscaper', 'site.title.motionscaper': 'Motionscaper Handbook', 'sidebar.help': 'Help' };
	const translations = { 'sidebar.motionscaper': 'Motionscaper', 'site.title.motionscaper': 'Motionscaper-Handbuch', 'sidebar.help': 'Hilfe und Dokumentation' };
	assert.deepEqual(validateChromeResponse({ locale: 'de', translations }, { targetLocale: 'de', labels }), translations);
	for (const key of ['sidebar.motionscaper', 'site.title.motionscaper']) {
		assert.throws(() => validateChromeResponse({ locale: 'de', translations: { ...translations, [key]: 'Bewegungs-Caper Handbuch' } }, { targetLocale: 'de', labels }), /Motionscaper/u);
	}
});
