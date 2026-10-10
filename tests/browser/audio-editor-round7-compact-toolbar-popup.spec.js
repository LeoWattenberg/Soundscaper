/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, waitForResponsiveEditorLayout } from './audio-editor-test-helpers.js';

test('a compact toolbar popup returns keyboard focus to its reachable opener', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Music']);
	const trigger = editor.getByRole('button', { name: 'Musical timeline', exact: true });
	const popup = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	const anchoring = popup.getByRole('combobox', { name: 'Tempo anchoring', exact: true });
	// The same published toolbar has a complete ordinary desktop keyboard control.
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(popup).toBeVisible();
	await expect(anchoring).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(popup).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await page.setViewportSize({ width: 800, height: 900 });
	await waitForResponsiveEditorLayout(editor);
	await expect(editor).toHaveAttribute('data-layout', 'compact');
	const menu = editor.locator('[data-chrome-drawer-toggle]');
	await menu.click();
	await expect(menu).toHaveAttribute('aria-expanded', 'true');
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(popup).toBeVisible();
	await expect(anchoring).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(popup).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await expect(menu).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Enter');
	await expect(popup).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(trigger).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveAttribute('aria-expanded', 'false');
	await expect(menu).toBeFocused();
	expect(errors).toEqual([]);
});

test('a compact workspace popup keeps its expanded native toolbar opener reachable', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Audacity']);
	const trigger = editor.locator('[data-workspace-switcher] button');
	const popup = page.locator('.kw-audio-editor__workspace-switcher-menu');
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(popup.getByRole('menuitem', { name: 'Soundscaper', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(popup).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await page.setViewportSize({ width: 800, height: 900 });
	await waitForResponsiveEditorLayout(editor);
	const menu = editor.locator('[data-chrome-drawer-toggle]');
	await menu.click();
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(popup.getByRole('menuitem', { name: 'Soundscaper', exact: true })).toBeFocused();
	await expect(menu).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Escape');
	await expect(popup).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveAttribute('aria-expanded', 'false');
	await expect(menu).toBeFocused();
	expect(errors).toEqual([]);
});
