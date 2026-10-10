/* SPDX-License-Identifier: AGPL-3.0-only */

import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const image of [false, true]) test(`Sort tracks by name retains ordinary ${image ? 'native picture' : 'audio'} content`, async ({ page }) => {
	const editor = await bootEditor(page, image ? '/framescaper/embed/en/' : '/embed/en/');
	for (const name of ['Zulu', 'Alpha']) {
		if (image) {
			const choosing = page.waitForEvent('filechooser');
			await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
			await (await choosing).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: createPngFixture(16) });
			const picture = editor.getByRole('group', { name: `Image clip: ${name}`, exact: true });
			await expect(picture).toBeVisible();
			await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
			await picture.locator('.clip-header').click();
			const row = picture.locator('xpath=ancestor::div[@data-track-row][1]');
			await row.locator('[data-track-name]').dblclick();
			const naming = row.getByRole('textbox', { name: 'Track name: Images', exact: true });
			await naming.fill(name);
			await naming.press('Enter');
			await expect(row.locator('[data-track-name]')).toHaveText(name);
		} else await importFiles(editor, [createWavFixture({ name: `${name}.wav`, frequency: 440, duration: .2 })]);
	}
	const clip = name => image ? editor.getByRole('group', { name: `Image clip: ${name}`, exact: true }) : clipByName(editor, `${name}.wav`);
	const ordinal = name => clip(name).locator('xpath=ancestor::div[@data-track-row][1]').evaluate(element => (
		Array.from(element.closest('[data-audio-editor]').querySelectorAll('[data-track-row]')).indexOf(element)
	));
	await expect.poll(async () => (await ordinal('Zulu')) < (await ordinal('Alpha'))).toBe(true);
	await chooseNestedCommandAction(page, editor, 'Tracks', [ENGLISH_COPY.sortTracks, ENGLISH_COPY.sortByName]);
	await expect.poll(async () => (await ordinal('Alpha')) < (await ordinal('Zulu'))).toBe(true);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await ordinal('Zulu')) < (await ordinal('Alpha'))).toBe(true);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await ordinal('Alpha')) < (await ordinal('Zulu'))).toBe(true);
});
