/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Next item enters the first picture after ordinary Select none', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const choosing = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await choosing).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	const first = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	const second = editor.getByRole('group', { name: 'Image clip: background', exact: true });
	await second.locator('.clip-header').click();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Control+ArrowRight');
	const position = clip => clip.evaluate(element => Number.parseFloat(element.style.left));
	await expect.poll(() => position(second)).toBeGreaterThan(await position(first));
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Next item');
	const command = preferences.getByRole('group', { name: 'Next item', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Alt+Y');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await first.locator('.clip-header').click();
	await playhead.press('Alt+Y');
	await expect(second.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await expect(first.locator('.clip-display')).not.toHaveClass(/clip-display--selected/u);
	await expect(second.locator('.clip-display')).not.toHaveClass(/clip-display--selected/u);
	await playhead.press('Alt+Y');
	await expect(first.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await playhead.press('Alt+Y');
	await expect(second.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
});

test('Item below enters the first ordinary track after No tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	const lane = clip => clip.locator('xpath=ancestor::div[@data-track-row][1]').locator('[data-track-lane]');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Item below');
	const command = preferences.getByRole('group', { name: 'Item below', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Alt+W');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await first.locator('.clip-header').click();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Alt+W');
	await expect(lane(second)).toHaveAttribute('data-selected', 'true');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	await expect(lane(first)).toHaveAttribute('data-selected', 'false');
	await expect(lane(second)).toHaveAttribute('data-selected', 'false');
	await playhead.press('Alt+W');
	await expect(lane(first)).toHaveAttribute('data-selected', 'false');
	await expect(lane(second)).toHaveAttribute('data-selected', 'false');
	await playhead.press('Alt+W');
	await expect(lane(first)).toHaveAttribute('data-selected', 'true');
});
