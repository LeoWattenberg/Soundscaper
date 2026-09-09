/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { assertNoSeriousAxeViolations, bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

for (const product of ['soundscaper', 'framescaper']) test.describe(`${product} skin carousel`, () => {
	registerAudioEditorHooks();
	test('browses one row without changing the skin and selects with the keyboard', async ({ page }, testInfo) => {
		const path = `${product === 'soundscaper' ? '' : '/framescaper'}/embed/en/`;
		const editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await dialog.getByRole('tab', { name: /Appearance$/u }).click();
		const next = dialog.getByRole('button', { name: 'Next skins', exact: true });
		const previous = dialog.getByRole('button', { name: 'Previous skins', exact: true });
		await expect(previous).toBeDisabled();
		await next.click();
		await expect(next).toBeDisabled();
		await expect(previous).toBeEnabled();
		await expect(editor).toHaveAttribute('data-editor-skin', 'default');
		const techno = dialog.getByRole('button', { name: 'Techno', exact: true });
		await techno.focus();
		await techno.press('Home');
		await expect(dialog.getByRole('button', { name: 'Default', exact: true })).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(dialog.getByRole('button', { name: 'Sakura', exact: true })).toBeFocused();
		await page.keyboard.press('End');
		await expect(techno).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(editor).toHaveAttribute('data-editor-skin', 'techno');
		await assertNoSeriousAxeViolations(page, '.editor-skin-preferences');
		await dialog.screenshot({ path: testInfo.outputPath('skin-carousel.png') });
		await page.setViewportSize({ width: 700, height: 720 });
		const choices = dialog.locator('[data-skin-choice]');
		const tops = await choices.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
		expect(new Set(tops).size).toBe(1);
		await choices.first().evaluate((button) => { button.closest('.editor-skin-carousel').dir = 'rtl'; });
		await choices.first().focus();
		await page.keyboard.press('ArrowLeft');
		await expect(dialog.getByRole('button', { name: 'Sakura', exact: true })).toBeFocused();
	});
});
