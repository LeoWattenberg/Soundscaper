/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const METERS = [
	{ kind: 'playback', label: 'Playback meter', settings: 'Playback meter settings', slider: 'Playback volume' },
	{ kind: 'recording', label: 'Recording meter', settings: 'Record level', slider: 'Record level' },
];

test.describe('dockable playback and recording meters', () => {
	test('migrates saved sidebar meters to narrow panels with a grip above their settings icons', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.addInitScript(() => {
			for (const kind of ['playback', 'recording']) {
				localStorage.setItem(`soundscaper-${kind}-meter-settings-v2`, JSON.stringify({
					position: 'side', style: 'gradient', type: 'db-linear', dbRange: 96,
				}));
			}
		});
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		for (const meter of METERS) {
			const panel = meterPanel(editor, meter);
			await expect(panel).toBeVisible();
			expect((await requiredBounds(panel)).width).toBeCloseTo(72, 0);
			await expect(panel.getByRole('heading')).toHaveCount(0);
			await expect(panel.getByRole('button', { name: `Panel menu: ${meter.label}`, exact: true })).toHaveCount(0);
			const grip = panel.getByRole('button', { name: `Move workspace item: ${meter.label}`, exact: true });
			const icon = panel.getByRole('button', { name: meter.settings, exact: true });
			const gripBounds = await requiredBounds(grip);
			const iconBounds = await requiredBounds(icon);
			expect(gripBounds.y + gripBounds.height).toBeLessThanOrEqual(iconBounds.y);
			expect(Math.abs(gripBounds.x + gripBounds.width / 2 - iconBounds.x - iconBounds.width / 2)).toBeLessThanOrEqual(1);
			const surface = panel.locator('[data-audio-meter]');
			await expect(surface).toHaveAttribute('data-meter-position', 'panel');
			await expect(surface).toHaveAttribute('data-meter-style', 'gradient');
			await expect(surface).toHaveAttribute('data-meter-type', 'db-linear');
			await expect(surface).toHaveAttribute('data-meter-db-range', '96');
			await expect(panel.getByRole('slider', { name: meter.slider, exact: true })).toHaveAttribute('aria-orientation', 'vertical');
			const settings = await openMeterSettings(editor, meter);
			const position = settings.getByRole('group', { name: 'Position', exact: true });
			await expect(position.getByRole('radio')).toHaveCount(3);
			await expect(position.getByRole('radio', { name: 'Panel', exact: true })).toBeChecked();
			await expect(position.getByRole('radio', { name: 'Toolbar', exact: true })).toBeVisible();
			await expect(position.getByRole('radio', { name: 'Flyout only', exact: true })).toBeVisible();
			const panelLabel = await requiredBounds(position.getByText('Panel', { exact: true }));
			const menuButton = await requiredBounds(position.getByRole('button', { name: `Panel menu: ${meter.label}`, exact: true }));
			expect(menuButton.x).toBeGreaterThan(panelLabel.x + panelLabel.width);
			expect(Math.abs(menuButton.y + menuButton.height / 2 - panelLabel.y - panelLabel.height / 2)).toBeLessThanOrEqual(1);
			await page.keyboard.press('Escape');
			await expect.poll(() => savedMeterPosition(page, meter.kind)).toBe('panel');
		}
		await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
		const customization = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
		for (const [label, meter] of [['Playback volume', METERS[0]], ['Record level', METERS[1]]]) {
			const toggle = customization.getByRole('checkbox', { name: label, exact: true });
			await toggle.click();
			await expect(toggle).toHaveAttribute('aria-checked', 'false');
			await expect(meterPanel(editor, meter)).toBeVisible();
			await toggle.click();
			await expect(toggle).toHaveAttribute('aria-checked', 'true');
		}
		expect(errors).toEqual([]);
	});

	for (const meter of METERS) {
		test(`${meter.label} moves through every dock from its Position menu and retains toolbar and flyout choices`, async ({ page }) => {
			test.setTimeout(60_000);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
			for (const [dock, orientation] of [
				['left', 'vertical'], ['right', 'vertical'], ['top', 'horizontal'],
				['bottom', 'horizontal'], ['floating', 'vertical'],
			]) {
				await dockMeterFromSettings(editor, meter, dock);
				const panel = editor.locator(`[data-panel-dock="${dock}"] [data-workspace-panel="${meter.kind}-meter"]`);
				await expect(panel).toBeVisible();
				await expect(panel.locator('[data-audio-meter]')).toHaveAttribute('data-meter-orientation', orientation);
				await expect(panel.getByRole('slider', { name: meter.slider, exact: true })).toHaveAttribute('aria-orientation', orientation);
				const channels = await requiredBounds(panel.getByRole('meter'));
				const surface = await requiredBounds(panel.locator('[data-audio-meter]'));
				if (orientation === 'horizontal') {
					expect(channels.width).toBeGreaterThan(surface.width * 0.9);
					expect(channels.height).toBeGreaterThan(40);
				} else {
					expect(channels.height).toBeGreaterThan(surface.height * 0.85);
					expect(channels.width).toBeGreaterThan(20);
				}
			}
			const width = (await requiredBounds(meterPanel(editor, meter))).width;
			await chooseNestedCommandAction(page, editor, 'Window', [meter.label]);
			await expect(meterPanel(editor, meter)).toHaveCount(0);
			await expect.poll(() => savedMeterPosition(page, meter.kind)).toBe('flyout');
			await chooseNestedCommandAction(page, editor, 'Window', [meter.label]);
			const restored = editor.locator(`[data-panel-dock="floating"] [data-workspace-panel="${meter.kind}-meter"]`);
			await expect(restored).toBeVisible();
			expect((await requiredBounds(restored)).width).toBeCloseTo(width, 0);

			let settings = await openMeterSettings(editor, meter);
			await settings.getByRole('radio', { name: 'Toolbar', exact: true }).click();
			await expect(meterPanel(editor, meter)).toHaveCount(0);
			const toolbarMeter = editor.locator(`[data-audio-meter][data-meter-kind="${meter.kind}"][data-meter-position="top"]`);
			await expect(toolbarMeter).toBeVisible();
			await expect(toolbarMeter).toHaveAttribute('data-meter-orientation', 'horizontal');
			await expect.poll(() => savedMeterPosition(page, meter.kind)).toBe('top');
			settings = await openMeterSettings(editor, meter);
			await settings.getByRole('radio', { name: 'Flyout only', exact: true }).click();
			await expect(toolbarMeter).toHaveCount(0);
			await expect(settings.getByRole('radio', { name: 'Flyout only', exact: true })).toBeChecked();
			await expect.poll(() => savedMeterPosition(page, meter.kind)).toBe('flyout');
			await settings.getByRole('radio', { name: 'Panel', exact: true }).click();
			await expect(meterPanel(editor, meter)).toBeVisible();
			await page.reload();
			await waitForEditor(page);
			await expect(restored).toBeVisible();
			await expect(restored.locator('[data-audio-meter]')).toHaveAttribute('data-meter-orientation', 'vertical');
			expect(errors).toEqual([]);
		});
	}

	test('resizes a meter dock down to 72 pixels and persists its width', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		const rightDock = editor.locator('[data-panel-dock="right"]');
		await expect(rightDock).toBeVisible();
		expect((await requiredBounds(rightDock)).width).toBeCloseTo(72, 0);
		const channelWidths = await Promise.all(METERS.map(async (meter) => (
			(await requiredBounds(meterPanel(editor, meter).getByRole('meter'))).width
		)));
		const resize = rightDock.getByRole('button', { name: 'Resize: Right', exact: true });
		await resize.press('ArrowLeft');
		await resize.press('ArrowLeft');
		await expect.poll(async () => (await requiredBounds(rightDock)).width).toBeCloseTo(104, 0);
		for (const [index, meter] of METERS.entries()) {
			expect((await requiredBounds(meterPanel(editor, meter).getByRole('meter'))).width).toBeGreaterThan(channelWidths[index] + 30);
		}
		await page.reload();
		await waitForEditor(page);
		expect((await requiredBounds(rightDock)).width).toBeCloseTo(104, 0);
		await resize.press('Shift+ArrowRight');
		await resize.press('Shift+ArrowRight');
		await expect.poll(async () => (await requiredBounds(rightDock)).width).toBeCloseTo(72, 0);
		await page.reload();
		await waitForEditor(page);
		expect((await requiredBounds(rightDock)).width).toBeCloseTo(72, 0);
		for (const meter of METERS) {
			await expect(meterPanel(editor, meter).getByRole('slider', { name: meter.slider, exact: true })).toBeVisible();
		}
	});

	test('the meter grip drags into an empty dock and floating meter resize keeps the same width minimum', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		const meter = METERS[0];
		const grip = meterPanel(editor, meter).getByRole('button', { name: `Move workspace item: ${meter.label}`, exact: true });
		const transfer = await page.evaluateHandle(() => new DataTransfer());
		await grip.dispatchEvent('dragstart', { dataTransfer: transfer });
		const target = editor.locator('[data-workspace-drop-target="top"]');
		await expect(target).toBeVisible();
		const bounds = await requiredBounds(target);
		const event = { dataTransfer: transfer, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 };
		await target.dispatchEvent('dragover', event);
		await target.dispatchEvent('drop', event);
		await grip.dispatchEvent('dragend', { dataTransfer: transfer });
		await transfer.dispose();
		const top = editor.locator('[data-panel-dock="top"] [data-workspace-panel="playback-meter"]');
		await expect(top).toBeVisible();
		await expect(top.locator('[data-audio-meter]')).toHaveAttribute('data-meter-orientation', 'horizontal');
		await dockMeterFromSettings(editor, meter, 'floating');
		const floating = meterPanel(editor, meter);
		await resizeFloatingWidth(page, floating, 80);
		await expect.poll(async () => (await requiredBounds(floating)).width).toBeGreaterThan(120);
		await resizeFloatingWidth(page, floating, -200);
		await expect.poll(async () => (await requiredBounds(floating)).width).toBeCloseTo(72, 0);
		const keyboardResize = floating.getByRole('button', { name: /^Resize:? Playback meter$/u });
		await keyboardResize.press('ArrowRight');
		await expect.poll(async () => (await requiredBounds(floating)).width).toBeCloseTo(88, 0);
		await keyboardResize.press('Shift+ArrowLeft');
		await expect.poll(async () => (await requiredBounds(floating)).width).toBeCloseTo(72, 0);
		const move = floating.getByRole('button', { name: 'Move workspace item: Playback meter', exact: true });
		const beforeMove = await requiredBounds(floating);
		await move.press('ArrowRight');
		await expect.poll(async () => (await requiredBounds(floating)).x).toBeCloseTo(beforeMove.x + 16, 0);
		const moveBounds = await requiredBounds(move);
		await page.mouse.move(moveBounds.x + moveBounds.width / 2, moveBounds.y + moveBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(moveBounds.x + moveBounds.width / 2 + 32, moveBounds.y + moveBounds.height / 2, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => (await requiredBounds(floating)).x).toBeCloseTo(beforeMove.x + 48, 0);
		await page.reload();
		await waitForEditor(page);
		expect((await requiredBounds(floating)).width).toBeCloseTo(72, 0);
		expect((await requiredBounds(floating)).x).toBeCloseTo(beforeMove.x + 48, 0);
	});

	test('grouped meter panels have accessible names and switch through their settings menu', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		const playback = METERS[0];
		let settings = await openMeterSettings(editor, playback);
		await settings.getByRole('button', { name: 'Panel menu: Playback meter', exact: true }).click();
		let menu = editor.page().locator('.kw-audio-editor__workspace-panel-menu');
		await menu.getByRole('menuitem', { name: /^Arrange panel(?: ▸)?$/u }).press('ArrowRight');
		await menu.getByRole('menuitem', { name: /^Recording meter — Right/u }).press('ArrowRight');
		await menu.getByRole('menuitem', { name: 'As tab', exact: true }).click();
		const dock = editor.locator('[data-panel-dock="right"]');
		await expect(dock.getByRole('tabpanel', { name: 'Playback meter', exact: true })).toBeVisible();
		await expect(dock.getByRole('heading')).toHaveCount(0);
		settings = await openMeterSettings(editor, playback);
		await settings.getByRole('button', { name: 'Panel menu: Playback meter', exact: true }).click();
		menu = editor.page().locator('.kw-audio-editor__workspace-panel-menu');
		await menu.getByRole('menuitem', { name: /^Panels(?: ▸)?$/u }).press('ArrowRight');
		await menu.getByRole('menuitem', { name: 'Recording meter', exact: true }).click();
		await expect(dock.getByRole('tabpanel', { name: 'Recording meter', exact: true })).toBeVisible();
		await expect(dock.getByRole('tabpanel', { name: 'Playback meter', exact: true })).toBeHidden();
		await expect(dock.getByRole('button', { name: 'Record level', exact: true })).toBeVisible();
	});

	test('the floating meter grip docks with a real pointer into empty zones and an occupied dock', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		const meter = METERS[0];
		for (const dock of ['top', 'bottom', 'left', 'right']) {
			await dockMeterFromSettings(editor, meter, 'floating');
			const grip = meterPanel(editor, meter).getByRole('button', { name: 'Move workspace item: Playback meter', exact: true });
			const start = await requiredBounds(grip);
			await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
			await page.mouse.down();
			await expect(editor.locator('[data-workspace-drop-targets]')).not.toHaveAttribute('aria-hidden', 'true');
			const destination = dock === 'right'
				? editor.locator('[data-panel-dock="right"] [data-workspace-panel="recording-meter"]')
				: editor.locator(`[data-workspace-drop-target="${dock}"]`);
			const target = await requiredBounds(destination);
			await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.9, { steps: 8 });
			await page.mouse.up();
			await expect(editor.locator(`[data-panel-dock="${dock}"] [data-workspace-panel="playback-meter"]`)).toBeVisible();
			await expect(editor.locator('[data-workspace-drop-targets]')).toHaveAttribute('aria-hidden', 'true');
		}
		await page.reload();
		await waitForEditor(page);
		await expect(editor.locator('[data-panel-dock="right"] [data-workspace-panel="playback-meter"]')).toBeVisible();
	});
});

function meterPanel(editor, meter) {
	return editor.locator(`[data-workspace-panel="${meter.kind}-meter"]`);
}

async function openMeterSettings(editor, meter) {
	const settings = editor.getByRole('dialog', { name: meter.settings, exact: true });
	if (!await settings.isVisible()) await editor.getByRole('button', { name: meter.settings, exact: true }).click();
	await expect(settings).toBeVisible();
	return settings;
}

async function dockMeterFromSettings(editor, meter, dock) {
	const settings = await openMeterSettings(editor, meter);
	const position = settings.getByRole('group', { name: 'Position', exact: true });
	await position.getByRole('button', { name: `Panel menu: ${meter.label}`, exact: true }).click();
	const menu = editor.page().getByRole('menu').filter({ has: editor.page().getByRole('menuitem', { name: 'Floating', exact: true }) });
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: dock[0].toUpperCase() + dock.slice(1), exact: true }).click();
	await expect(menu).toBeHidden();
	await editor.page().keyboard.press('Escape');
	await expect(editor.getByRole('button', { name: meter.settings, exact: true })).toBeFocused();
}

async function requiredBounds(locator) {
	const bounds = await locator.boundingBox();
	expect(bounds).not.toBeNull();
	return bounds;
}

async function savedMeterPosition(page, kind) {
	return page.evaluate((meterKind) => JSON.parse(localStorage.getItem(`soundscaper-${meterKind}-meter-settings-v2`))?.position, kind);
}

async function resizeFloatingWidth(page, panel, delta) {
	const bounds = await requiredBounds(panel);
	const startX = bounds.x + bounds.width - 3;
	const startY = bounds.y + bounds.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + delta, startY, { steps: 5 });
	await page.mouse.up();
}
