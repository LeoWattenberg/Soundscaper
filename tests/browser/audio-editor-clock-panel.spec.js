/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, closeWorkspacePanel, collectClientErrors,
	dockWorkspacePanel, importFiles, waitForEditor,
} from './audio-editor-test-helpers.js';

async function chooseClockOption(page, display, label) {
	await display.getByRole('button', { name: 'Playhead: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: label, exact: true }).click();
}

test.describe('optional clock workspace panel', () => {
	test('undocks from the existing timer menu and retains its format through resize, reload and redock', async ({ page }) => {
		await page.setViewportSize({ width: 1_440, height: 1_000 });
		let editor = await bootEditor(page, '/embed/en/');
		const errors = collectClientErrors(page);
		await expect(editor.locator('[data-clock-panel]')).toHaveCount(0);
		const toolbar = editor.locator('[data-editor-tool-toolbar]');
		await chooseClockOption(page, toolbar, 'hh:mm:ss + milliseconds');
		await expect(toolbar.locator('.timecode-digit')).toHaveCount(9);
		await chooseClockOption(page, toolbar, 'Undock timecode');
		let clock = editor.locator('[data-workspace-panel="clock"]');
		await expect(clock).toBeVisible();
		await expect(toolbar.locator('[data-time-display]')).toHaveCount(0);
		await expect(clock.locator('.timecode-digit')).toHaveCount(9);
		const initialDigit = await clock.locator('.timecode-digit').first().boundingBox();
		expect(initialDigit).not.toBeNull();
		const resize = clock.getByRole('button', { name: 'Resize: Clock', exact: true });
		await resize.focus();
		await resize.press('Shift+ArrowRight');
		await resize.press('Shift+ArrowDown');
		await expect.poll(async () => (await clock.locator('.timecode-digit').first().boundingBox()).height)
			.toBeGreaterThan(initialDigit.height + 2);
		const resizedPanel = await clock.boundingBox();
		await page.reload();
		editor = await waitForEditor(page);
		clock = editor.locator('[data-workspace-panel="clock"]');
		await expect(clock).toBeVisible();
		await expect(clock.locator('.timecode-digit')).toHaveCount(9);
		await expect.poll(async () => (await clock.boundingBox()).width).toBeCloseTo(resizedPanel.width, 0);
		await chooseClockOption(page, clock, 'Return to toolbar');
		await expect(clock).toHaveCount(0);
		await expect(editor.locator('[data-editor-tool-toolbar] [data-time-display]')).toBeVisible();
		await expect(editor.locator('[data-editor-tool-toolbar] .timecode-digit')).toHaveCount(9);
		await expect(editor.locator('[data-editor-tool-toolbar] [data-time-display] .timecode')).toBeFocused();
		expect(errors).toEqual([]);
	});

	test('opens through Window, follows playback and supports editable seeking and close', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await chooseNestedCommandAction(page, editor, 'Window', ['Clock']);
		const clock = editor.locator('[data-workspace-panel="clock"]');
		await expect(clock).toBeVisible();
		await chooseClockOption(page, clock, 'hh:mm:ss');
		await clock.locator('.timecode-digit').first().click();
		await page.keyboard.type('000002');
		await page.keyboard.press('Enter');
		await expect(clock.locator('.timecode-digit')).toHaveText(['0', '0', '0', '0', '0', '2']);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => Number((await clock.locator('.timecode-digit').allTextContents()).join('')))
			.toBeGreaterThan(2);
		await editor.getByRole('button', { name: 'Pause', exact: true }).click();
		await dockWorkspacePanel(editor, 'clock', 'right');
		await expect(editor.locator('[data-panel-dock="right"] [data-clock-panel]')).toBeVisible();
		await closeWorkspacePanel(editor, 'clock');
		await expect(editor.locator('[data-editor-tool-toolbar] [data-time-display]')).toBeVisible();
		await expect(editor.locator('[data-editor-tool-toolbar] [data-time-display] .timecode')).toBeFocused();
	});
});
