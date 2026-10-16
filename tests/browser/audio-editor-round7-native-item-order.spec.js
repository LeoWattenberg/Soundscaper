/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Next item follows ordinary still placement rather than source identity', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const name of ['poster', 'background']) {
		const picking = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
		await (await picking).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
		await expect(editor.getByRole('group', { name: `Image clip: ${name}`, exact: true })).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	}
	const ids = (await editor.locator('[data-clip-id][role="group"]').evaluateAll(elements => elements.map(element => element.dataset.clipId))).sort();
	expect(ids).toHaveLength(2);
	const earlier = editor.locator(`[data-clip-id="${ids[1]}"][role="group"]`);
	const later = editor.locator(`[data-clip-id="${ids[0]}"][role="group"]`);
	await later.locator('.clip-header').click();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Control+ArrowRight');
	const position = clip => clip.evaluate(element => Number.parseFloat(element.style.left));
	await expect.poll(() => position(later)).toBeGreaterThan(await position(earlier));
	await earlier.locator('.clip-header').click();
	await expect(earlier.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	for (const [name, binding] of [['Next item', 'Alt+Y'], ['Previous item', 'Alt+Shift+Y']]) {
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill(name);
		const command = preferences.getByRole('group', { name, exact: true }).locator('..');
		await command.getByRole('textbox').first().fill(binding);
		await command.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	}
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await playhead.press('Alt+Y');
	await expect(later.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await expect(earlier.locator('.clip-display')).not.toHaveClass(/clip-display--selected/u);
	await playhead.press('Alt+Shift+Y');
	await expect(earlier.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
});
