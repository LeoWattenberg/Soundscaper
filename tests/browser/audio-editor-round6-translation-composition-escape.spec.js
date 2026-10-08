/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';

const copy = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;

test('canceling native translation composition keeps the translator and its draft open', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	const surface = page.getByRole('dialog', { name: copy.title, exact: true });
	await surface.getByRole('combobox', { name: copy.language, exact: true }).selectOption('ja');
	await surface.getByRole('searchbox', { name: copy.search, exact: true }).fill('play');
	await surface.getByRole('listbox', { name: new RegExp(`^${copy.messages} \\(`, 'u') }).selectOption('play');
	const translation = surface.getByRole('textbox', { name: copy.translation, exact: true });
	await translation.fill('とう');
	const prevented = await translation.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	await expect(surface).toBeVisible();
	expect(prevented).toBe(false);
	await expect(translation).toBeFocused();
	await expect(translation).toHaveValue('とう');
	await translation.fill('再生');
	await surface.getByRole('button', { name: copy.save, exact: true }).click();
	await translation.press('Escape');
	await expect(surface).toBeHidden();
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	await surface.getByRole('searchbox', { name: copy.search, exact: true }).fill('play');
	await surface.getByRole('listbox', { name: new RegExp(`^${copy.messages} \\(`, 'u') }).selectOption('play');
	await expect(surface.getByRole('textbox', { name: copy.translation, exact: true })).toHaveValue('再生');
});
