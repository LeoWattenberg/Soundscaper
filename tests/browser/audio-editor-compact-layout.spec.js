/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseNestedCommandAction,
	expectSurfaceWithinViewport,
	importFiles,
	registerAudioEditorHooks,
	waitForResponsiveEditorLayout,
} from './audio-editor-test-helpers.js';

const PHONE_PORTRAIT = { width: 390, height: 844 };
const LAYOUT_COMPACT = 'Compact (menus and track headers in drawers)';

async function bootCompactEditor(page, viewport = PHONE_PORTRAIT) {
	await page.setViewportSize(viewport);
	const editor = await bootEditor(page, '/embed/en/');
	await waitForResponsiveEditorLayout(editor);
	await expect(editor).toHaveAttribute('data-layout', 'compact');
	return editor;
}

function menuToggle(editor) {
	return editor.locator('[data-chrome-drawer-toggle]');
}

function applicationMenubar(editor) {
	return editor.getByRole('menubar', { name: 'Application menu', exact: true });
}

test.describe('compact layout', () => {
	registerAudioEditorHooks();

	test('a phone viewport shows the compact bar and keeps the menus, action bar and toolbar in a drawer', async ({ page }) => {
		const editor = await bootCompactEditor(page);
		const toggle = menuToggle(editor);
		await expect(toggle).toHaveAccessibleName('Menu');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		const menubar = applicationMenubar(editor);
		await expect(menubar).toBeHidden();
		const compactBar = editor.locator('[data-compact-bar]');
		await expect(compactBar.locator('[data-transport="play"]')).toBeVisible();
		await expect(compactBar.locator('[data-transport="stop"]')).toBeVisible();
		await expect(editor.locator('[data-workspace-toolbar="transport"]')).toHaveCount(1);
		await expect(editor.locator('[data-toolbar-dock]')).toHaveCount(0);
		await expectSurfaceWithinViewport(editor, page);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(toggle).toHaveAccessibleName('Close menu');
		await expect(menubar).toBeVisible();
		await expect(menubar).toHaveAttribute('aria-orientation', 'vertical');
		const drawer = editor.locator('[data-chrome-drawer]');
		await expect(drawer.locator('[data-workspace-toolbar="transport"]')).toBeVisible();
		await expect(drawer.getByRole('button', { name: 'Jump to project start', exact: true })).toBeVisible();
		await expect(drawer.locator('[data-editor-tool-toolbar]')).toBeVisible();
		const panel = drawer.locator('.kw-audio-editor__chrome-drawer-panel');
		// The panel slides in from the editor's edge; measure it once the transition has settled.
		const editorBox = await editor.boundingBox();
		await expect.poll(async () => Math.abs(((await panel.boundingBox())?.x ?? -1) - editorBox.x) <= 2).toBe(true);
		await expectSurfaceWithinViewport(panel, page);
		await expect(drawer.locator('[data-transport="play"]')).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(menubar).toBeHidden();
		await expect(toggle).toBeFocused();
	});

	test('a command chosen from the drawer runs and closes the drawer and the menu', async ({ page }) => {
		const editor = await bootCompactEditor(page);
		const trackCount = Number(await editor.getAttribute('data-track-count'));
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', String(trackCount + 1));
		await expect(menuToggle(editor)).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('menu', { name: 'Tracks', exact: true })).toHaveCount(0);
		await expect(applicationMenubar(editor)).toBeHidden();
	});

	test('play and stop work from the compact bar', async ({ page }) => {
		const editor = await bootCompactEditor(page);
		await importFiles(editor, [toneA]);
		const compactBar = editor.locator('[data-compact-bar]');
		await compactBar.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(compactBar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await compactBar.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(compactBar.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	});

	test('the Layout preference forces either chrome regardless of the viewport width', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-layout', 'desktop');
		await expect(menuToggle(editor)).toHaveCount(0);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Appearance$/u }).click();
		const layout = preferences.getByRole('group', { name: 'Layout', exact: true });
		await chooseDropdown(page, layout, LAYOUT_COMPACT);
		await expect(editor).toHaveAttribute('data-layout', 'compact');
		await expect(menuToggle(editor)).toBeVisible();
		await chooseDropdown(page, layout, 'Desktop');
		await expect(editor).toHaveAttribute('data-layout', 'desktop');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();

		await page.setViewportSize(PHONE_PORTRAIT);
		await waitForResponsiveEditorLayout(editor);
		await expect(editor).toHaveAttribute('data-layout', 'desktop');
		await expect(applicationMenubar(editor)).toBeVisible();
		await expect(menuToggle(editor)).toHaveCount(0);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await preferences.getByRole('tab', { name: /Appearance$/u }).click();
		await chooseDropdown(page, layout, 'Automatic');
		await expect(editor).toHaveAttribute('data-layout', 'compact');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		await expect(menuToggle(editor)).toBeVisible();
	});
});
