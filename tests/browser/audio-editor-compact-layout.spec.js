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

	test('a phone viewport keeps the track headers in a drawer that slides over full-width lanes', async ({ page }) => {
		const editor = await bootCompactEditor(page);
		await importFiles(editor, [toneA]);
		const row = editor.locator('[data-track-row]').first();
		const header = row.locator('[data-track-header]');
		const lane = row.locator('[data-track-lane]');
		await expect(header).toBeHidden();
		const timelineBox = await editor.locator('[data-timeline]').boundingBox();
		const laneBox = await lane.boundingBox();
		expect(Math.abs(laneBox.x - timelineBox.x)).toBeLessThanOrEqual(2);
		expect(await editor.locator('.audio-editor-timeline-panel').evaluate((panel) => (
			panel.style.getPropertyValue('--track-panel-width')
		))).toBe('0px');

		const toggle = editor.locator('[data-track-header-toggle]');
		await expect(toggle).toHaveAccessibleName('Show track headers');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(toggle).toHaveAccessibleName('Hide track headers');
		await expect(header).toBeVisible();
		await expect.poll(async () => (await header.boundingBox())?.width).toBe(268);
		await expect(editor.locator('[data-track-header-drawer-strip][data-open="true"]')).toBeVisible();
		await expect(row.getByRole('button', { name: 'Track menu', exact: true })).toBeVisible();

		// A tap in the timeline beside the headers closes the drawer. It lands on
		// whatever the timeline shows there, as a finger would.
		await page.mouse.click(timelineBox.x + timelineBox.width - 10, laneBox.y + 40);
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(header).toBeHidden();

		// The View menu carries the same toggle in the compact layout.
		await chooseCommandAction(page, editor, 'View', 'Track headers');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	});

	test('a landscape phone fits the editor without page scroll', async ({ page }) => {
		const editor = await bootCompactEditor(page, { width: 844, height: 390 });
		await importFiles(editor, [toneA]);
		await expectSurfaceWithinViewport(editor, page);
		expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
		const timelineBox = await editor.locator('[data-timeline]').boundingBox();
		expect(timelineBox.height).toBeGreaterThan(120);
		expect(timelineBox.y + timelineBox.height).toBeLessThanOrEqual(390);
	});

	test('the site introduction folds away on narrow screens and stays open on wide ones', async ({ page }) => {
		await page.setViewportSize(PHONE_PORTRAIT);
		const editor = await bootEditor(page, '/en/');
		await waitForResponsiveEditorLayout(editor);
		const intro = page.locator('.tool-intro');
		const body = intro.locator('.tool-intro-body');
		const toggle = intro.getByRole('button', { name: 'Show introduction', exact: true });
		await expect(intro).toHaveAttribute('data-expanded', 'false');
		await expect(body).toBeHidden();
		await expect(toggle).toBeVisible();
		await toggle.click();
		await expect(intro).toHaveAttribute('data-expanded', 'true');
		await expect(body).toBeVisible();
		await expect(intro.getByRole('button', { name: 'Hide introduction', exact: true })).toBeVisible();

		await page.setViewportSize({ width: 1280, height: 800 });
		await waitForResponsiveEditorLayout(editor);
		await expect(intro.getByRole('button', { name: /introduction$/u })).toBeHidden();
		await expect(body).toBeVisible();
	});

	test('the desktop layout keeps the track header column and no drawer handle', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-track-row]').first().locator('[data-track-header]')).toBeVisible();
		await expect(editor.locator('[data-track-header-toggle]')).toHaveCount(0);
		await expect(editor.locator('.audio-editor-timeline-panel')).not.toHaveAttribute('data-track-header-drawer', /.*/u);
	});
});
