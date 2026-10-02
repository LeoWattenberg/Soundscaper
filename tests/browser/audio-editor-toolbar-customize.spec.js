import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	setDocumentTheme,
	waitForEditor,
} from './audio-editor-test-helpers.js';

for (const theme of ['light', 'dark']) {
	test(`toolbar customization uses eyes and saves visibility in ${theme} mode`, async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await setDocumentTheme(page, theme);
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		const flyout = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
		const playToggle = flyout.getByRole('checkbox', { name: 'Play', exact: true });
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await expect(playToggle).toHaveCSS('font-size', '12px');
		await expect(playToggle).toContainText('\uEF53');
		await expect(flyout.getByRole('checkbox', { name: 'Metronome', exact: true })).toContainText('\uEF54');

		await playToggle.getByText('Play', { exact: true }).click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await expect(playToggle).toContainText('\uEF54');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
		await expect(flyout).toBeVisible();

		await playToggle.press('Space');
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await expect(playToggle).toContainText('\uEF53');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await expect(playToggle).toBeFocused();
		await playToggle.press('Enter');
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await expect(flyout).toBeHidden();
		await expect(editor.getByRole('button', { name: 'Customize toolbar', exact: true })).toBeFocused();

		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'false');
		await expect(playToggle).toContainText('\uEF54');
		await playToggle.getByText('\uEF54', { exact: true }).click();
		await expect(playToggle).toHaveAttribute('aria-checked', 'true');
		await expect(playToggle).toContainText('\uEF53');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
}

test('toolbar docks on either side through its menu and restores placement after reload', async ({ page }) => {
	const errors = collectClientErrors(page);
	await page.addInitScript(() => {
		for (const kind of ['playback', 'recording']) {
			localStorage.setItem(`soundscaper-${kind}-meter-settings-v2`, JSON.stringify({ position: 'top' }));
		}
	});
	let editor = await bootEditor(page, '/embed/en/');
	for (const dock of ['Left', 'Right', 'Bottom', 'Top']) {
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		const customize = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
		const docking = customize.getByRole('menuitem', { name: /^Dock toolbar/u });
		await docking.hover();
		await docking.getByRole('menu').getByRole('menuitem', { name: dock, exact: true }).click();
		await expect(customize).toBeHidden();
		const toolbar = editor.locator(`[data-toolbar-dock="${dock.toLowerCase()}"]`);
		await expect(toolbar.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		const bounds = await toolbar.boundingBox();
		if (dock === 'Left' || dock === 'Right') {
			expect(bounds.height).toBeGreaterThan(bounds.width);
			await expect(toolbar.locator('[data-audio-meter][data-meter-position="top"]')).toHaveCount(2);
			await expect.poll(() => toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
			await expect.poll(() => toolbar.locator('[data-audio-meter]').evaluateAll((meters) => meters.every((meter) => {
				const rail = meter.closest('[data-toolbar-dock]').getBoundingClientRect();
				const rect = meter.getBoundingClientRect();
				return rect.left >= rail.left - 1 && rect.right <= rail.right + 1;
			}))).toBe(true);
		}
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.locator(`[data-toolbar-dock="${dock.toLowerCase()}"]`)).toBeVisible();
	}
	expect(errors).toEqual([]);
});

test('restores a saved floating toolbar after compact startup and keeps its controls reachable after resizing', async ({ page }) => {
	await page.setViewportSize({ width: 600, height: 800 });
	await page.addInitScript(() => {
		localStorage.setItem('soundscaper-toolbar-docking-v1', JSON.stringify({ dock: 'floating', x: 5000, y: 5000 }));
	});
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const toolbar = editor.locator('[data-toolbar-dock="floating"]');
	await expect(toolbar).toHaveCount(0);
	for (const viewport of [
		{ width: 1200, height: 800 },
		{ width: 960, height: 720 },
		{ width: 600, height: 800 },
		{ width: 1200, height: 800 },
	]) {
		await page.setViewportSize(viewport);
		if (viewport.width <= 900) {
			await expect(toolbar).toHaveCount(0);
			continue;
		}
		for (const control of [toolbar, toolbar.locator('.toolbar__gripper'), toolbar.getByRole('button', { name: 'Customize toolbar', exact: true })]) {
			await expect(control).toBeVisible();
			await expect.poll(() => control.evaluate((element) => {
				const host = element.closest('[data-audio-editor]').getBoundingClientRect();
				const rect = element.getBoundingClientRect();
				return rect.left >= host.left - 1 && rect.right <= host.right + 1
					&& rect.top >= host.top - 1 && rect.bottom <= host.bottom + 1;
			})).toBe(true);
		}
	}
});

test('toolbar grip docks at the side and Escape cancels a move', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const toolbar = editor.locator('[data-editor-tool-toolbar]');
	const grip = toolbar.locator('.toolbar__gripper');
	const bounds = await editor.boundingBox();
	await grip.hover();
	await page.mouse.down();
	await page.mouse.move(bounds.x + 5, bounds.y + bounds.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect(editor.locator('[data-toolbar-dock="left"]')).toBeVisible();
	await grip.hover();
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
	await expect(editor.locator('[data-toolbar-dock="floating"]')).toBeVisible();
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(editor.locator('[data-toolbar-dock="left"]')).toBeVisible();
	expect(errors).toEqual([]);
});
