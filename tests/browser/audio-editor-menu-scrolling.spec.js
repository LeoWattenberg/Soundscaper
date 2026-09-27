/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	openChromeDrawer,
	registerAudioEditorHooks,
	waitForResponsiveEditorLayout,
} from './audio-editor-test-helpers.js';

async function openEffectMenu(editor) {
	await openChromeDrawer(editor);
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Effect', exact: true }).click();
	const menu = editor.page().getByRole('menu', { name: 'Effect', exact: true });
	await expect(menu).toBeVisible();
	return menu;
}

async function expectScrollableWithinViewport(menu) {
	const geometry = await menu.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			bottom: rect.bottom,
			clientHeight: element.clientHeight,
			overflowY: getComputedStyle(element).overflowY,
			scrollHeight: element.scrollHeight,
			top: rect.top,
			viewportHeight: innerHeight,
		};
	});
	expect(geometry.top).toBeGreaterThanOrEqual(0);
	expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
	expect(geometry.overflowY).toBe('auto');
	expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
}

async function expectLongSubmenuRemainsReachable(page, menu) {
	const nyquist = getMenuItem(menu, 'Nyquist');
	await nyquist.scrollIntoViewIfNeeded();
	await nyquist.press('ArrowRight');
	const submenu = nyquist.getByRole('menu');
	await expect(submenu).toBeVisible();
	await expectScrollableWithinViewport(submenu);
	await submenu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
	await expect.poll(() => submenu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	const lastItem = submenu.getByRole('menuitem').last();
	await lastItem.focus();
	await expect(lastItem).toBeInViewport();
	await page.keyboard.press('Escape');
}

async function expectKeyboardNavigationScrolls(page, menu) {
	const directItems = menu.locator(':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]');
	await directItems.first().focus();
	await page.keyboard.press('End');
	await expect(directItems.last()).toBeFocused();
	await expect(directItems.last()).toBeInViewport();
	await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await page.keyboard.press('Home');
}

test.describe('viewport-bounded application menus', () => {
	registerAudioEditorHooks();

	test('scrolls long desktop menus without clipping their submenus', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 360 });
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-layout', 'desktop');
		const menu = await openEffectMenu(editor);
		await expectScrollableWithinViewport(menu);
		await expectKeyboardNavigationScrolls(page, menu);
		await expectLongSubmenuRemainsReachable(page, menu);
	});

	test('scrolls long compact menus and their sheet submenus', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 360 });
		const editor = await bootEditor(page, '/embed/en/');
		await waitForResponsiveEditorLayout(editor);
		await expect(editor).toHaveAttribute('data-layout', 'compact');
		const menu = await openEffectMenu(editor);
		await expectScrollableWithinViewport(menu);
		await expectKeyboardNavigationScrolls(page, menu);
		await expectLongSubmenuRemainsReachable(page, menu);
	});
});
