/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, waitForResponsiveEditorLayout } from './audio-editor-test-helpers.js';

test('compact track headers keep composing Escape in the live rename input', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const editor = await bootEditor(page, '/embed/en/');
	await waitForResponsiveEditorLayout(editor);
	await expect(editor).toHaveAttribute('data-layout', 'compact');
	await importFiles(editor, [toneA]);
	const toggle = editor.locator('[data-track-header-toggle]');
	await toggle.click();
	const header = editor.locator('[data-track-header]').first();
	const name = header.locator('.track-control-panel__track-name-text');
	const original = await name.innerText();
	await name.dblclick();
	const input = header.locator('[data-track-name] input');
	await expect(input).toBeFocused();
	await input.fill('Ordinary rename');
	await input.press('Enter');
	await expect(name).toHaveText('Ordinary rename');
	await page.keyboard.press('Control+z');
	await expect(name).toHaveText(original);
	await name.dblclick();
	await input.fill('とう');
	const prevented = await input.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(header).toBeVisible();
	await expect(input).toBeFocused();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await input.fill('東京の録音');
	await input.press('Enter');
	await expect(name).toHaveText('東京の録音');
	await page.keyboard.press('Control+z');
	await expect(name).toHaveText(original);
	await page.keyboard.press('Control+Shift+z');
	await expect(name).toHaveText('東京の録音');
	await header.getByRole('button', { name: 'Track menu', exact: true }).focus();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(toggle).toBeFocused();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
