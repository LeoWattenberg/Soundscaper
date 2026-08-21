/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/nightly-packaged-electron.js';

test('boots the hardened packaged product runtime', async ({ page }, testInfo) => {
	test.skip(process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS !== '1', 'Runs only from nightly packaged-runtime collection.');
	const productId = testInfo.project.metadata.productId;
	await expect(page.locator('[data-audio-editor]')).toBeVisible();
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true');
	const runtime = await page.evaluate(async () => {
		const bridge = globalThis.scapeDesktop?.v1;
		return {
			nodeExposed: typeof globalThis.process !== 'undefined',
			environment: await bridge?.getEnvironment(),
			bridgeAvailable: typeof bridge?.getEnvironment === 'function',
		};
	});
	expect(runtime.nodeExposed).toBe(false);
	expect(runtime.bridgeAvailable).toBe(true);
	expect(runtime.environment?.platform).toBe(process.platform);
	expect(page.url()).toMatch(new RegExp(`^${productId}-app://bundle/`, 'u'));
});

test('uses one full-bleed custom title bar with platform-scoped menu mnemonics', async ({ page }) => {
	test.skip(process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS !== '1', 'Runs only from nightly packaged-runtime collection.');
	const editor = page.locator('[data-audio-editor]');
	const chrome = await editor.evaluate((element) => {
		const shell = document.querySelector('.site-shell');
		const header = element.querySelector('[data-desktop-chrome="true"]');
		const titlebar = header?.querySelector('.application-header__windows-titlebar');
		const windowActions = header?.querySelector('.kw-audio-editor__window-actions');
		const editorBounds = element.getBoundingClientRect();
		const editorStyle = getComputedStyle(element);
		const actionFor = (button) => button.classList.contains('kw-audio-editor__fullscreen')
			? 'fullscreen'
			: button.dataset.windowControl;
		return {
			documentDesktop: document.documentElement.dataset.desktop === 'true',
			shellDesktop: shell?.classList.contains('desktop') === true,
			bounds: [editorBounds.left, editorBounds.top, editorBounds.right, editorBounds.bottom],
			viewport: [innerWidth, innerHeight],
			borderWidth: editorStyle.borderTopWidth,
			borderRadius: editorStyle.borderTopLeftRadius,
			titlebarRegion: titlebar ? getComputedStyle(titlebar).getPropertyValue('-webkit-app-region') : '',
			controlsRegion: windowActions ? getComputedStyle(windowActions).getPropertyValue('-webkit-app-region') : '',
			controlOrder: Array.from(windowActions?.querySelectorAll('button') || [], actionFor),
		};
	});
	expect(chrome.documentDesktop).toBe(true);
	expect(chrome.shellDesktop).toBe(true);
	expect(chrome.bounds[0]).toBeCloseTo(0, 1);
	expect(chrome.bounds[1]).toBeCloseTo(0, 1);
	expect(chrome.bounds[2]).toBeCloseTo(chrome.viewport[0], 1);
	expect(chrome.bounds[3]).toBeCloseTo(chrome.viewport[1], 1);
	expect(chrome.borderWidth).toBe('0px');
	expect(chrome.borderRadius).toBe('0px');
	expect(chrome.titlebarRegion.trim()).toBe('drag');
	expect(chrome.controlsRegion.trim()).toBe('no-drag');
	expect(chrome.controlOrder.slice(0, 2)).toEqual(['fullscreen', 'minimize']);
	expect(['maximize', 'restore']).toContain(chrome.controlOrder[2]);
	expect(chrome.controlOrder[3]).toBe('quit');
	expect(chrome.controlOrder).toHaveLength(4);

	const platform = await page.evaluate(() => globalThis.scapeDesktop.v1.getEnvironment().then(({ platform }) => platform));
	const file = editor.locator('[data-application-menubar] [role="menuitem"]').first();
	const fullscreen = editor.locator('.kw-audio-editor__fullscreen');
	await fullscreen.focus();
	if (platform === 'darwin') {
		await expect(file).not.toHaveAttribute('aria-keyshortcuts', /.+/u);
		await page.keyboard.press('Alt+f');
		await expect(file).toHaveAttribute('aria-expanded', 'false');
	} else {
		await expect(file).toHaveAttribute('aria-keyshortcuts', /^Alt\+[\p{Letter}\p{Number}]$/u);
		const fileAccessKey = await file.getAttribute('aria-keyshortcuts');
		expect(fileAccessKey).toMatch(/^Alt\+[\p{Letter}\p{Number}]$/u);
		if ((await file.textContent())?.trim() === 'File') expect(fileAccessKey).toBe('Alt+F');
		await page.keyboard.press(fileAccessKey);
		await expect(file).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Escape');
	}
});
