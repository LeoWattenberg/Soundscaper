/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('the native video numeric context menu leaves an unconfirmed draft cancellable', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('context-menu-brightness.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const brightness = rack.locator('[data-video-effect-param="brightness"] input[type="number"]');
	await brightness.fill('0.2');
	await brightness.press('Enter');
	await expect(brightness).toHaveValue('0.2');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(brightness).toHaveValue('0');
	await brightness.fill('0.2');
	await brightness.click({ position: { x: 8, y: 8 } });
	await expect(brightness).toHaveValue('0.2');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(brightness).toHaveValue('0');
	await brightness.fill('0.3');
	await brightness.press('Escape');
	await expect(brightness).toHaveValue('0');
	await expect(brightness).toBeFocused();
	await brightness.fill('0.4');
	await brightness.click({ button: 'right' });
	await expect(brightness).toBeFocused();
	await brightness.press('Escape');
	await expect(brightness).toHaveValue('0');
	await expect(brightness).toBeFocused();
	await brightness.fill('0.5');
	await brightness.press('Enter');
	await expect(brightness).toHaveValue('0.5');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(brightness).toHaveValue('0');
});
