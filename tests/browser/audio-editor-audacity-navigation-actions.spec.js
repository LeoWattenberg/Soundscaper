/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	closeWorkspacePanel,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Audacity action runtime browser routes', () => {
	registerAudioEditorHooks();

	test('runs item and track navigation through shipped shortcuts and command search', async ({ page }) => {
		test.setTimeout(120_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 20_000,
		});
		const rows = editor.locator('[data-track-row]');
		await expect(rows).toHaveCount(3);
		const clip = clipByName(editor, toneA.name);
		await selectClip(clip);

		const originalBox = await requiredBox(clip);
		await pressClipShortcut(page, clip, 'Control+ArrowRight');
		await expect.poll(async () => (await requiredBox(clip)).x).toBeGreaterThan(originalBox.x + 5);
		await pressClipShortcut(page, clip, 'Control+ArrowLeft');
		await expect.poll(async () => (await requiredBox(clip)).x).toBeCloseTo(originalBox.x, 0);

		await pressClipShortcut(page, clip, 'Control+Shift+ArrowLeft');
		await expect.poll(async () => (await requiredBox(clip)).width).toBeLessThan(
			originalBox.width - 5,
		);
		const reducedRightBox = await requiredBox(clip);
		await pressClipShortcut(page, clip, 'Shift+ArrowRight');
		await expect.poll(async () => (await requiredBox(clip)).width).toBeGreaterThan(
			reducedRightBox.width + 5,
		);

		await pressClipShortcut(page, clip, 'Control+Shift+ArrowRight');
		const reducedLeftBox = await requiredBox(clip);
		expect(reducedLeftBox.x).toBeGreaterThan(originalBox.x + 5);
		expect(reducedLeftBox.width).toBeLessThan(originalBox.width - 5);
		await pressClipShortcut(page, clip, 'Shift+ArrowLeft');
		await expect.poll(async () => (await requiredBox(clip)).x).toBeCloseTo(originalBox.x, 0);

		const originalTrackId = await clipTrackId(clip);
		await pressClipShortcut(page, clip, 'Control+ArrowUp');
		await expect.poll(() => clipTrackId(clip)).not.toBe(originalTrackId);
		await pressClipShortcut(page, clip, 'Control+ArrowDown');
		await expect.poll(() => clipTrackId(clip)).toBe(originalTrackId);

		await assignNavigationShortcuts(page, editor);
		await selectClip(clip);
		await pressClipShortcut(page, clip, 'Alt+Shift+Y');
		await pressClipShortcut(page, clip, 'Alt+Shift+Y');
		const firstClipId = await selectedClipId(editor);
		await pressEditorShortcut(page, editor, 'Alt+Y');
		await expect.poll(() => selectedClipId(editor)).not.toBe(firstClipId);
		await pressEditorShortcut(page, editor, 'Alt+Shift+Y');
		await expect.poll(() => selectedClipId(editor)).toBe(firstClipId);

		await pressEditorShortcut(page, editor, 'Control+Home');
		await expect(rows.nth(0).locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		await pressEditorShortcut(page, editor, 'ArrowDown');
		await expect(rows.nth(1).locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		await pressEditorShortcut(page, editor, 'ArrowUp');
		await expect(rows.nth(0).locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		await pressEditorShortcut(page, editor, 'Control+End');
		await expect(rows.nth(2).locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');

		await invokeSearchCommand(page, editor, 'select-all');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(3);
		await pressEditorShortcut(page, editor, 'Control+Home');
		await pressEditorShortcut(page, editor, 'Alt+Shift+R');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
		await pressEditorShortcut(page, editor, 'ArrowDown');
		await pressEditorShortcut(page, editor, 'Shift+Enter');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
		await pressEditorShortcut(page, editor, 'Control+End');
		await pressEditorShortcut(page, editor, 'Shift+Enter');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(3);
		await pressEditorShortcut(page, editor, 'Control+Enter');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
		await pressEditorShortcut(page, editor, 'Alt+Shift+R');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
		await pressEditorShortcut(page, editor, 'Shift+ArrowUp');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
		await pressEditorShortcut(page, editor, 'Shift+ArrowDown');
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);

		await selectClip(clip);
		await pressClipShortcut(page, clip, 'Shift+F10');
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		await expect(clipMenu).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(clipMenu).toBeHidden();

		const timelinePanel = editor.locator('.audio-editor-timeline-panel');
		await timelinePanel.evaluate((element) => {
			element.tabIndex = -1;
			element.focus();
		});
		expect(await dispatchEditorShortcut(timelinePanel, { code: 'F6', key: 'F6' })).toBe(true);
		await timelinePanel.evaluate(() => new Promise(requestAnimationFrame));
		expect(await dispatchEditorShortcut(timelinePanel, {
			code: 'F6', key: 'F6', shiftKey: true,
		})).toBe(true);
		await timelinePanel.evaluate(() => new Promise(requestAnimationFrame));
		expect(errors).toEqual([]);
	});

	test('opens safe runtime surfaces and toggles presentation through command search', async ({ page }) => {
		test.setTimeout(120_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 20_000,
		});
		await assignRuntimeSurfaceShortcuts(page, editor);

		for (const [actionId, panelId] of [
			['project-properties', 'metadata'],
			['toggle-effects', 'effects'],
			['toggle-history', 'history'],
		]) {
			await invokeSearchCommand(page, editor, actionId);
			await expect(editor.locator(`[data-workspace-panel="${panelId}"]`)).toBeVisible();
			await closeWorkspacePanel(editor, panelId);
		}

		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+W');
		let preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(preferences.getByRole('tabpanel', { name: 'Workspace', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();

		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+P');
		preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(preferences.getByRole('tabpanel', { name: 'Editing', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();

		const ruler = editor.locator('[data-ruler]');
		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+B');
		await expect(ruler).toHaveAttribute('data-time-format', 'beats-measures');
		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+T');
		await expect(ruler).toHaveAttribute('data-time-format', 'minutes-seconds');

		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+G');
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+G');
		await expect(editor).toHaveAttribute('data-timeline-view', 'waveform');

		const selectionToolbar = editor.locator('[data-selection-toolbar]');
		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+L');
		await expect(selectionToolbar).toHaveClass(/selection-surface--status-only/u);
		await pressEditorShortcut(page, editor, 'Control+Alt+Shift+L');
		await expect(selectionToolbar).not.toHaveClass(/selection-surface--status-only/u);

		const workspaceMain = editor.locator('.kw-audio-editor__workspace-main');
		await invokeSearchCommand(page, editor, 'toggle-tracks');
		await expect(workspaceMain).toHaveCount(0);
		await invokeSearchCommand(page, editor, 'toggle-tracks');
		await expect(workspaceMain).toBeVisible();

		await invokeSearchCommand(page, editor, 'toggle-clipping-in-waveform');
		await expectViewToggle(page, editor, 'Clipping in waveform', false);
		await invokeSearchCommand(page, editor, 'toggle-clipping-in-waveform');
		await expectViewToggle(page, editor, 'Clipping in waveform', true);
		await invokeSearchCommand(page, editor, 'toggle-statusbar');
		await expectViewToggle(page, editor, 'Status bar', false);
		await invokeSearchCommand(page, editor, 'toggle-statusbar');
		await expectViewToggle(page, editor, 'Status bar', true);
		expect(errors).toEqual([]);
	});
});

async function invokeSearchCommand(page, editor, actionId) {
	await page.keyboard.press('Control+k');
	const search = editor.locator('[data-editor-search-input]');
	await search.click();
	await expect(search).toBeFocused();
	await search.fill(actionId);
	const option = editor.locator(`[data-editor-search-key="command:${actionId}"]`);
	await expect(option).toBeVisible();
	await expect(option).not.toHaveAttribute('aria-disabled', 'true');
	await option.click();
	await expect(editor.locator('[data-editor-search-popup]')).toBeHidden();
}

async function pressClipShortcut(page, clip, shortcut) {
	await clip.focus();
	await page.keyboard.press(shortcut);
}

async function pressEditorShortcut(page, editor, shortcut) {
	const timeline = editor.locator('.audio-editor-timeline-panel');
	await timeline.evaluate((element) => {
		element.tabIndex = -1;
		element.focus();
	});
	await page.keyboard.press(shortcut);
}

async function dispatchEditorShortcut(target, init) {
	return target.evaluate((element, eventInit) => {
		const event = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			...eventInit,
		});
		element.dispatchEvent(event);
		return event.defaultPrevented;
	}, init);
}

async function assignNavigationShortcuts(page, editor) {
	await assignShortcuts(page, editor, [
		['local://track-view-next-item', 'Alt+Y'],
		['local://track-view-prev-item', 'Alt+Shift+Y'],
		['track-view-replace-selection', 'Alt+Shift+R'],
	]);
}

async function assignRuntimeSurfaceShortcuts(page, editor) {
	await assignShortcuts(page, editor, [
		['configure-workspaces', 'Ctrl+Alt+Shift+W'],
		['snap', 'Ctrl+Alt+Shift+P'],
		['beats-measures-ruler', 'Ctrl+Alt+Shift+B'],
		['minutes-seconds-ruler', 'Ctrl+Alt+Shift+T'],
		['action://trackedit/global-view-spectrogram', 'Ctrl+Alt+Shift+G'],
		['local://selection-toolbar', 'Ctrl+Alt+Shift+L'],
	]);
}

async function assignShortcuts(page, editor, assignments) {
	await pressEditorShortcut(page, editor, 'Control+,');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences).toBeVisible();
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });
	for (const [actionId, shortcut] of assignments) {
		await search.fill(actionId);
		const row = preferences.locator(`[data-shortcut-action="${actionId}"]`);
		await expect(row).toBeVisible();
		await row.locator('[data-shortcut-binding="0"]').fill(shortcut);
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
	}
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
}

async function selectClip(clip) {
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
}

async function requiredBox(locator) {
	const box = await locator.boundingBox();
	expect(box).not.toBeNull();
	return box;
}

async function clipTrackId(clip) {
	return clip.locator('xpath=ancestor::*[@data-track-row][1]').getAttribute('data-track-id');
}

async function selectedClipId(editor) {
	return editor.locator('[data-clip-id][role="group"]:has(.clip-display[data-selected="true"])')
		.getAttribute('data-clip-id');
}

async function expectViewToggle(page, editor, name, checked) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'View', exact: true }).click();
	const item = page.getByRole('menu', { name: 'View', exact: true })
		.getByRole('menuitemcheckbox', { name, exact: true });
	await expect(item).toHaveAttribute('aria-checked', String(checked));
	await page.keyboard.press('Escape');
}
