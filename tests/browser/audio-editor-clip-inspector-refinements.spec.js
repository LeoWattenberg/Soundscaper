/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, commitInput,
	importFiles, openClipProperties, openSourceMonitor } from './audio-editor-test-helpers.js';

test.use({ viewport: { width: 1440, height: 1000 } });

for (const owner of ['Clip properties', 'Source monitor']) {
	test(`a timeline trim can be extended from ${owner}, with one Undo and Redo`, async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		await clip.focus();
		await clip.press('t');
		await clip.getByRole('button', { name: 'Trim right edge', exact: true }).press('Shift+ArrowLeft');
		await expect(clip).toHaveAttribute('aria-label', /7 seconds long/u);
		if (owner === 'Clip properties') {
			const panel = await openClipProperties(page, editor, clip, { additional: false });
			const trim = panel.getByRole('textbox', { name: 'Trim end', exact: true });
			await expect(trim).toHaveValue('1');
			await commitInput(trim, '0.5');
			await expect(trim).toHaveValue('0.5');
			await expect(panel.getByRole('textbox', { name: 'Length', exact: true })).toHaveValue('7.5');
		} else {
			const panel = await openSourceMonitor(page, editor, clip);
			await panel.getByRole('button', { name: 'Trim source end', exact: true }).press('Shift+ArrowRight');
		}
		const duration = owner === 'Clip properties' ? '7.5' : '7.1';
		await expect(clip).toHaveAttribute('aria-label', new RegExp(`${duration.replace('.', '[.]')} seconds long`, 'u'));
		await expect(clip).toHaveAttribute('aria-label', /starts at 0 seconds/u);
		await expect(editor.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clip).toHaveAttribute('aria-label', /7 seconds long/u);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(clip).toHaveAttribute('aria-label', new RegExp(`${duration.replace('.', '[.]')} seconds long`, 'u'));
		expect(errors).toEqual([]);
	});
}

test('clip properties opens beside the meters and its source strip opens the bottom Source monitor', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(editor, [longTone]);
	const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name), { additional: false });
	const side = editor.locator('[data-panel-dock="right"]');
	await expect(side.locator('[data-workspace-panel="clip-properties"]')).toBeVisible();
	await expect(side.locator('[data-workspace-panel="playback-meter"]')).toBeVisible();
	await expect(side.locator('[data-workspace-panel="recording-meter"]')).toBeVisible();
	await expect(panel.getByText('Additional properties', { exact: true })).toHaveCount(0);
	await expect(panel.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveCount(1);
	await expect(panel.getByRole('textbox', { name: 'Speed', exact: true })).toHaveCount(1);
	await panel.getByRole('button', { name: 'Clip in its source', exact: true }).click();
	const monitor = editor.locator('[data-panel-dock="bottom"] [data-workspace-panel="source-monitor"]');
	await expect(monitor.getByRole('region', { name: 'Source waveform', exact: true })).toBeVisible();
	await expect(monitor.locator('details')).toHaveCount(0);
});

test('Reverse has a contrasting dark-theme switch in both states', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name), { additional: false });
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	const reverse = panel.getByRole('switch', { name: 'Reverse', exact: true });
	for (const checked of [false, true]) {
		await expect(reverse).toHaveAttribute('aria-checked', String(checked));
		const contrast = await reverse.locator('.clip-properties__switch').evaluate(element => {
			const rgb = value => {
				const channels = value.match(/[\d.]+/gu).map(Number);
				return value.startsWith('color(srgb ') ? channels.map((v, i) => i < 3 ? v * 255 : v) : channels;
			};
			const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
			const background = node => node ? blend(rgb(getComputedStyle(node).backgroundColor), background(node.parentElement)) : [255, 255, 255];
			const luminance = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
				.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
			const track = background(element);
			const thumb = blend(rgb(getComputedStyle(element, '::after').backgroundColor), track);
			const a = luminance(track); const b = luminance(thumb);
			return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), track, thumb, width: element.getBoundingClientRect().width };
		});
		expect(contrast.width).toBeGreaterThanOrEqual(24);
		expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(3);
		if (!checked) await reverse.click();
	}
});

test('a rejected property edit appears as a dismissible workspace toast', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name), { additional: false });
	await commitInput(panel.getByRole('textbox', { name: 'Start', exact: true }), '1e20');
	const toast = editor.locator('[data-editor-toast="workspace-error"]');
	await expect(toast).toBeVisible();
	await expect(panel.getByRole('alert')).toHaveCount(0);
	await toast.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(toast).toHaveCount(0);
});

test('clip colors use the track swatch palette and can follow the track again', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name), { additional: false });
	const color = panel.getByRole('button', { name: 'Clip color', exact: true });
	await color.click();
	const red = page.getByRole('menuitem', { name: 'Clip color: Red', exact: true });
	await expect(red).toBeVisible();
	await expect(red).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	await red.click();
	await expect(color).toContainText('Red');
	await color.click();
	await page.getByRole('menuitemcheckbox', { name: 'Follow track color', exact: true }).click();
	await expect(color).toContainText('Follow track color');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(color).toContainText('Red');
});
