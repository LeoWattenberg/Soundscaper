/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

const FONT_SIZE = '12px';

test('editor preferences use one text size across every page', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await expect(editor.getByRole('tab', { name: 'Untitled project', exact: true }))
		.toHaveCSS('font-size', FONT_SIZE);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });

	const editingTab = preferences.getByRole('tab', { name: /Editing$/u });
	await expect(editingTab).toHaveCSS('font-size', FONT_SIZE);
	await editingTab.click();
	const editing = preferences.locator('[data-editing-preferences]');
	await expect(editing.getByRole('heading', { name: 'Effect behavior', exact: true })).toHaveCSS('font-size', FONT_SIZE);
	await expect(editing.locator('.labeled-checkbox__label').first()).toHaveCSS('font-size', FONT_SIZE);
	await expect(editing.locator('.kw-audio-editor-preferences__startup-row label span').first()).toHaveCSS('font-size', FONT_SIZE);
	await expect(editing.getByRole('group', { name: 'Ripple editing', exact: true }).locator(':scope > span')).toHaveCSS('font-size', FONT_SIZE);
	await expect(editing.getByRole('group', { name: 'Ripple editing', exact: true }).locator('.dropdown__text')).toHaveCSS('font-size', FONT_SIZE);
	await expect(editing.locator('.kw-audio-editor-preferences__note').first()).toHaveCSS('font-size', FONT_SIZE);

	const spectrogramTab = preferences.getByRole('tab', { name: /Spectrogram$/u });
	await expect(spectrogramTab).toHaveCSS('font-size', FONT_SIZE);
	await spectrogramTab.click();
	const spectrogram = preferences.locator('[data-spectrogram-settings]');
	await expect(preferences.getByRole('heading', { name: 'Spectrogram', exact: true })).toHaveCSS('font-size', FONT_SIZE);
	await expect(spectrogram.locator('[data-spectrogram-target-name]')).toHaveCSS('font-size', FONT_SIZE);
	await expect(spectrogram.locator('label > span').first()).toHaveCSS('font-size', FONT_SIZE);
	await expect(spectrogram.getByRole('combobox', { name: 'Scale', exact: true })).toHaveCSS('font-size', FONT_SIZE);
	await expect(spectrogram.getByRole('spinbutton', { name: 'Minimum frequency (Hz)', exact: true })).toHaveCSS('font-size', FONT_SIZE);

	const shortcutsTab = preferences.getByRole('tab', { name: /Keyboard shortcuts$/u });
	await expect(shortcutsTab).toHaveCSS('font-size', FONT_SIZE);
	await shortcutsTab.click();
	await expect(preferences.getByRole('heading', { name: 'Keyboard shortcuts', exact: true })).toHaveCSS('font-size', FONT_SIZE);
	await expect(preferences.getByRole('searchbox', { name: 'Search commands', exact: true })).toHaveCSS('font-size', FONT_SIZE);
	await expect(preferences.locator('.kw-audio-editor-preferences__shortcut-header span').first()).toHaveCSS('font-size', FONT_SIZE);
	await expect(preferences.locator('[data-shortcut-group]').first()).toHaveCSS('font-size', FONT_SIZE);
	const firstRow = preferences.locator('[data-shortcut-action]').first();
	await expect(firstRow.locator('.kw-audio-editor-preferences__shortcut-command')).toHaveCSS('font-size', FONT_SIZE);
	await expect(firstRow.locator('input').first()).toHaveCSS('font-size', FONT_SIZE);
	await expect(firstRow.getByRole('button', { name: 'Assign', exact: true })).toHaveCSS('font-size', FONT_SIZE);
	const tabs = preferences.getByRole('tab');
	const tabCount = await tabs.count();
	for (let index = 0; index < tabCount; index += 1) {
		const tab = tabs.nth(index);
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true');
		const mismatches = await preferences.evaluate((root) => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const results = [];
			while (walker.nextNode()) {
				const element = walker.currentNode.parentElement;
				const content = walker.currentNode.textContent.trim();
				if (!element || !content || !element.getClientRects().length || element.closest('[aria-hidden="true"')) continue;
				if (element.matches('.timecode-digit, .timecode-unit, .timecode__separator')) continue;
				const style = getComputedStyle(element);
				if (style.fontSize !== '12px' && !style.fontFamily.includes('MusescoreIcon')) {
					results.push({ text: content.slice(0, 45), size: style.fontSize });
				}
			}
			return results;
		});
		expect(mismatches, `Typography in ${await tab.innerText()}`).toEqual([]);
	}
});
