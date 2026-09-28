/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';

test.describe('menu-owned text to speech', () => {
	registerAudioEditorHooks();

	test('shows the AI icon on guided effect entries without ellipses', async ({ page }) => {
		await installMilestone7LocalAssistanceFixture(page);
		const editor = await bootEditor(page, '/en/');
		const noiseRepair = await openNestedCommandMenu(page, editor, 'Effect', ['Noise removal and repair']);
		const command = getMenuItem(noiseRepair, 'Enhance Dialogue');
		await expect(command).toBeVisible();
		await expect(command.locator('.musescore-icon')).toHaveText(String.fromCodePoint(0xF476));
		await expect(command.locator('.context-menu-item-label')).toHaveText('Enhance Dialogue');
	});

	test('opens only from Generate and offers the published languages without an installed model', async ({ page }) => {
		await installMilestone7LocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await expect(editor.locator('[data-text-to-speech]')).toHaveCount(0);
		const generateMenu = await openNestedCommandMenu(page, editor, 'Generate', []);
		const command = getMenuItem(generateMenu, 'Text to Speech');
		await expect(command.locator('.musescore-icon')).toHaveText(String.fromCodePoint(0xF476));
		await command.press('Enter');
		await expect(generateMenu).toBeHidden();
		const dialog = page.locator('[data-text-to-speech="true"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('Install a speech model to generate audio locally.')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Generate preview' })).toBeDisabled();
		const language = dialog.getByLabel('Language');
		await expect(language.locator('option')).toHaveCount(9);
		await language.selectOption('a');
		await expect(dialog.getByLabel('Voice').locator('option')).toHaveCount(20);
		await dialog.getByRole('button', { name: 'Close' }).last().click();
		await expect(dialog).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});
