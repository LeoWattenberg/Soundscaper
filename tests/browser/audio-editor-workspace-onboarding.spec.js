/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	chooseNestedCommandAction,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
	resolveBrowserProductTestUrl,
	waitForEditor,
} from './audio-editor-test-helpers.js';

// The suite-wide storage state marks first-launch setup as done; this spec is
// the one place that boots a genuinely fresh profile.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('first-launch workspace chooser', () => {
	registerAudioEditorHooks();

	test('offers the Audacity or Soundscaper layout once and keeps the choice across reloads', async ({ page }) => {
		const editor = await bootUnseededEditor(page, '/en/');
		const dialog = page.getByRole('dialog', { name: 'Getting started', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('data-workspace-onboarding-dialog', 'true');
		const group = dialog.getByRole('group', { name: 'Select workspace layout', exact: true });
		const soundscaper = group.getByRole('button', { name: 'Soundscaper', exact: true });
		const audacity = group.getByRole('button', { name: 'Audacity', exact: true });
		await expect(soundscaper).toHaveAttribute('aria-current', 'true');
		await expect(audacity).not.toHaveAttribute('aria-current', 'true');
		await expect(soundscaper).toBeFocused();
		await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
		await expect(page.locator('[data-sidebar] [data-workspace-select] option'))
			.toHaveText(['Soundscaper', 'Audacity', 'Music', 'Classic']);

		// The card is the whole answer: it applies the layout and dismisses the
		// chooser without a second confirming click.
		await audacity.click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-workspace-preset', 'audacity');
		await expect(page.locator('[data-sidebar] [data-workspace-select]')).toHaveValue('audacity');
		await expect(editor.locator('[data-workspace-panel="project-bin"]')).toHaveCount(0);
		await expect(editor.locator('[data-side-playback-meter]')).toBeVisible();
		await expect(editor.locator('[data-side-recording-meter]')).toHaveCount(0);
		await expect(editor.locator('[data-snap-control]')).toHaveCount(1);

		await addAudioTrack(page, editor);
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		await expect(editor.locator('[data-track-ruler]')).toHaveCount(0);

		await page.reload();
		const reloaded = await waitForEditor(page);
		await expect(page.getByRole('dialog', { name: 'Getting started', exact: true })).toHaveCount(0);
		await expect(reloaded).toHaveAttribute('data-workspace-preset', 'audacity');
		await expect(reloaded.locator('[data-workspace-panel="project-bin"]')).toHaveCount(0);
		await addAudioTrack(page, reloaded);
		await expect(reloaded.locator('[data-track-row]').first()).toBeVisible();
		await expect(reloaded.locator('[data-track-ruler]')).toHaveCount(0);

		await chooseNestedCommandAction(page, reloaded, 'View', ['Workspace', 'Set up workspace']);
		const reopened = page.getByRole('dialog', { name: 'Getting started', exact: true });
		await expect(reopened).toBeVisible();
		const reopenedAudacity = reopened.getByRole('button', { name: 'Audacity', exact: true });
		await expect(reopenedAudacity).toHaveAttribute('aria-current', 'true');
		await expect(reopenedAudacity).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(reopened).toBeHidden();
		await expect(reloaded).toHaveAttribute('data-workspace-preset', 'audacity');

		await chooseNestedCommandAction(page, reloaded, 'View', ['Workspace', 'Soundscaper']);
		await expect(reloaded).toHaveAttribute('data-workspace-preset', 'modern');
		await expect(reloaded.locator('[data-track-ruler]').first()).toBeVisible();
		await expect(reloaded.locator('[data-side-recording-meter]')).toBeVisible();
	});

	test('never interrupts Framescaper and hides the menu entry there', async ({ page }) => {
		const editor = await bootUnseededEditor(page, '/framescaper/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await expect(page.getByRole('dialog', { name: 'Getting started', exact: true })).toHaveCount(0);
		await expect(page.locator('[data-editor-surface="workspace-onboarding"]')).toHaveCount(0);

		const workspaceMenu = await openNestedCommandMenu(page, editor, 'View', ['Workspace']);
		// The active preset renders as a checked item, so match either menu role.
		await expect(getMenuItem(workspaceMenu, 'Video editor')).toBeVisible();
		await expect(getMenuItem(workspaceMenu, 'Set up workspace')).toHaveCount(0);
		await expect(getMenuItem(workspaceMenu, 'Audacity')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Getting started', exact: true })).toHaveCount(0);
	});
});

async function bootUnseededEditor(page, path) {
	await page.goto(resolveBrowserProductTestUrl(path));
	return waitForEditor(page);
}

async function addAudioTrack(page, editor) {
	await editor.getByRole('button', { name: 'Add track', exact: true }).click();
	const flyout = page.locator('.add-track-flyout');
	await expect(flyout).toBeVisible();
	await flyout.getByRole('menuitem', { name: 'Audio track', exact: true }).click();
	await expect(flyout).toHaveCount(0);
}
