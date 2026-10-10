/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

async function openShortcutPreferences(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	return preferences;
}

async function shortcutRow(preferences, action, label) {
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill(label);
	const row = preferences.locator(`[data-shortcut-action="${action}"]`);
	await expect(row).toBeVisible();
	return row;
}

// Playwright's mouse API exposes only the first three buttons. CDP sends the
// actual Chromium Back/Forward input, including its native history behavior.
async function extraMouseClick(session, target, button = 'back', modifiers = 0, {
	releaseTarget = target,
	releaseModifiers = modifiers,
} = {}) {
	await target.scrollIntoViewIfNeeded();
	const bounds = await target.boundingBox();
	expect(bounds).not.toBeNull();
	const position = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	await session.send('Input.dispatchMouseEvent', {
		type: 'mousePressed', ...position, button, buttons: button === 'back' ? 8 : 16,
		modifiers, clickCount: 1,
	});
	const releaseBounds = await releaseTarget.boundingBox();
	expect(releaseBounds).not.toBeNull();
	const releasePosition = {
		x: releaseBounds.x + releaseBounds.width / 2,
		y: releaseBounds.y + releaseBounds.height / 2,
	};
	if (releaseTarget !== target) await session.send('Input.dispatchMouseEvent', {
		type: 'mouseMoved', ...releasePosition, buttons: button === 'back' ? 8 : 16,
		modifiers: releaseModifiers,
	});
	await session.send('Input.dispatchMouseEvent', {
		type: 'mouseReleased', ...releasePosition, button, buttons: 0,
		modifiers: releaseModifiers, clickCount: 1,
	});
}

test.describe('keyboard shortcut preferences', () => {
	registerAudioEditorHooks();

	test('sorts shortcuts by where the commands appear, and drops the rows that take none', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();

		// The categorized view is what the page opens on: File heads the list
		// because File heads the menubar, and its first row is the File menu's.
		const groups = preferences.locator('[data-shortcut-group]');
		await expect(groups.first()).toHaveAttribute('data-shortcut-group', 'menu:file');
		await expect(groups.first()).toHaveText('File');
		await expect(preferences.locator('[data-shortcut-action]').first())
			.toHaveAttribute('data-shortcut-action', 'file-new');

		// A dropdown value, an application-information command and a dynamic
		// action template are all absent, whichever view is showing.
		await expect(preferences.locator('[data-shortcut-action="snap-1-128"]')).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action="about-audacity"]')).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action*="%1"]')).toHaveCount(0);
		await expect(preferences.locator('[data-shortcut-action="snap-enabled"]')).toHaveCount(1);

		await chooseDropdown(page, preferences.locator('[role="group"][aria-label="Sort commands"]'), 'Alphabetical');
		await expect(groups).toHaveCount(0);
		const labels = await preferences.locator('[data-shortcut-action]').getByRole('group')
			.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
		expect(labels.length).toBeGreaterThan(0);
		expect(labels).toEqual([...labels].sort((left, right) => left.localeCompare(right, 'en')));
		await expect(preferences.locator('[data-shortcut-action="about-audacity"]')).toHaveCount(0);
	});

	test('builds the shortcut command inventory from implemented manifest actions', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });

		await search.fill('Insert');
		const insert = preferences.locator('[data-shortcut-action="insert"]');
		await expect(insert).toBeVisible();
		await expect(insert).not.toHaveAttribute('aria-disabled', 'true');
		const insertShortcut = insert.locator('input');
		await expect(insertShortcut).toBeEnabled();
		// Alt+I is Audacity's Split labeled audio, so a free chord is what proves the
		// row assignable rather than a conflict message.
		await insertShortcut.fill('Alt+U');
		await expect(insert.getByRole('button', { name: 'Assign', exact: true })).toBeEnabled();
		await expect(insert.locator('[data-shortcut-disabled-reason]')).toHaveCount(0);

		await search.fill('Zoom normal');
		await expect(preferences.locator('[data-shortcut-action="zoom-default"]')).toBeVisible();
		await expect(preferences.locator('[data-shortcut-action="plugin-manager"]')).toHaveCount(0);
		await search.fill('Nyquist prompt');
		await expect(preferences.locator('[data-shortcut-action="nyquist-prompt"]')).toBeVisible();
	});

	test('focuses a new shortcut field after Add shortcut is activated by keyboard', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Insert');
		const row = preferences.locator('[data-shortcut-action="insert"]');
		await expect(row).toBeVisible();
		const existing = await row.locator('[data-shortcut-binding]').count();
		const add = row.locator('[data-shortcut-add="true"]');
		await add.focus();
		await page.keyboard.press('Enter');
		await expect(row.locator(`[data-shortcut-binding="${existing}"]`)).toBeFocused();
	});

	test('captures extra mouse buttons, detects conflicts, and keeps modified bindings after reload', async ({ page, context, browserName }) => {
		test.skip(browserName !== 'chromium', 'Trusted Back/Forward input requires the Chromium CDP interface.');
		const session = await context.newCDPSession(page);
		let editor = await bootEditor(page, '/embed/en/');
		await page.evaluate(() => {
			history.pushState(null, '', '#before-mouse-capture');
			history.pushState(null, '', '#mouse-capture');
		});
		let preferences = await openShortcutPreferences(page, editor);
		let mono = await shortcutRow(preferences, 'new-mono-track', 'New mono track');
		const input = mono.locator('[data-shortcut-binding="0"]');
		const original = await input.inputValue();
		await input.click();
		await input.dispatchEvent('mousedown', { button: 1 });
		await input.dispatchEvent('mousedown', { button: 2 });
		await expect(input).toHaveValue(original);

		await extraMouseClick(session, input, 'back', 0, {
			releaseTarget: preferences.getByRole('heading', { name: 'Keyboard shortcuts', exact: true }),
		});
		await expect(input).toHaveValue('Mouse4');
		await expect(page).toHaveURL(/#mouse-capture$/u);
		await mono.getByRole('button', { name: 'Assign', exact: true }).click();
		const label = await shortcutRow(preferences, 'new-label-track', 'New label track');
		await extraMouseClick(session, label.locator('[data-shortcut-binding="0"]'));
		await expect(label.getByRole('alert')).toContainText('Mouse4');
		await expect(label.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		// CDP's modifier bits are Ctrl=2 and Shift=8.
		await extraMouseClick(session, label.locator('[data-shortcut-binding="0"]'), 'forward', 10);
		await expect(label.locator('[data-shortcut-binding="0"]')).toHaveValue('Ctrl+Shift+Mouse5');
		await expect(label.getByRole('alert')).toHaveCount(0);
		await label.getByRole('button', { name: 'Assign', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();

		await page.reload();
		editor = await waitForEditor(page);
		preferences = await openShortcutPreferences(page, editor);
		mono = await shortcutRow(preferences, 'new-mono-track', 'New mono track');
		await expect(mono.locator('[data-shortcut-binding="0"]')).toHaveValue('Mouse4');
		const restoredLabel = await shortcutRow(preferences, 'new-label-track', 'New label track');
		await expect(restoredLabel.locator('[data-shortcut-binding="0"]')).toHaveValue('Ctrl+Shift+Mouse5');
	});

	test('runs each extra mouse shortcut once and preserves unassigned browser navigation', async ({ page, context, browserName }) => {
		test.skip(browserName !== 'chromium', 'Trusted Back/Forward input requires the Chromium CDP interface.');
		const session = await context.newCDPSession(page);
		const editor = await bootEditor(page, '/embed/en/');
		const target = editor.locator('.audio-editor-timeline-panel');
		const initialCount = Number(await editor.getAttribute('data-track-count'));
		await page.evaluate(() => {
			history.pushState(null, '', '#mouse-back');
			history.pushState(null, '', '#mouse-forward');
		});
		await extraMouseClick(session, target);
		await expect(page).toHaveURL(/#mouse-back$/u);
		await extraMouseClick(session, target, 'forward');
		await expect(page).toHaveURL(/#mouse-forward$/u);
		await expect(editor).toHaveAttribute('data-track-count', String(initialCount));

		const preferences = await openShortcutPreferences(page, editor);
		const mono = await shortcutRow(preferences, 'new-mono-track', 'New mono track');
		await extraMouseClick(session, mono.locator('[data-shortcut-binding="0"]'));
		await expect(mono.locator('[data-shortcut-binding="0"]')).toHaveValue('Mouse4');
		await mono.getByRole('button', { name: 'Add shortcut: New mono track', exact: true }).click();
		await extraMouseClick(session, mono.locator('[data-shortcut-binding="1"]'), 'forward', 10);
		await mono.getByRole('button', { name: 'Assign', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();

		await extraMouseClick(session, target);
		await expect(editor).toHaveAttribute('data-track-count', String(initialCount + 1));
		await expect(page).toHaveURL(/#mouse-forward$/u);
		await page.goBack();
		await expect(page).toHaveURL(/#mouse-back$/u);
		await extraMouseClick(session, target, 'forward', 10, { releaseModifiers: 0 });
		await expect(editor).toHaveAttribute('data-track-count', String(initialCount + 2));
		await expect(page).toHaveURL(/#mouse-back$/u);
		await target.click();
		await target.dispatchEvent('mousedown', { button: 1 });
		await target.dispatchEvent('mousedown', { button: 2 });
		await expect(editor).toHaveAttribute('data-track-count', String(initialCount + 2));

		await extraMouseClick(session, target, 'forward');
		await expect(page).toHaveURL(/#mouse-forward$/u);
		await expect(editor).toHaveAttribute('data-track-count', String(initialCount + 2));

		await openShortcutPreferences(page, editor);
		await extraMouseClick(session, preferences.getByRole('heading', { name: 'Keyboard shortcuts', exact: true }));
		await expect(preferences).toBeVisible();
		await expect(editor).toHaveAttribute('data-track-count', String(initialCount + 2));
	});

	test('prevents a mouse shortcut release from navigating after the command opens a dialog', async ({ page, context, browserName }) => {
		test.skip(browserName !== 'chromium', 'Trusted Back/Forward input requires the Chromium CDP interface.');
		const session = await context.newCDPSession(page);
		const editor = await bootEditor(page, '/embed/en/');
		const preferences = await openShortcutPreferences(page, editor);
		const row = await shortcutRow(preferences, 'preference-dialog', 'Preferences');
		await extraMouseClick(session, row.locator('[data-shortcut-binding="0"]'));
		await expect(row.locator('[data-shortcut-binding="0"]')).toHaveValue('Mouse4');
		await row.getByRole('button', { name: 'Assign', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(preferences).toBeHidden();
		await page.evaluate(() => {
			history.pushState(null, '', '#before-mouse-dialog');
			history.pushState(null, '', '#mouse-dialog');
		});
		await extraMouseClick(session, editor.locator('.audio-editor-timeline-panel'));
		await expect(preferences).toBeVisible();
		await expect(page).toHaveURL(/#mouse-dialog$/u);
	});
});
