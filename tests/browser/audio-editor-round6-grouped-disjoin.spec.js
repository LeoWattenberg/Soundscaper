/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Split clips at silences retains nonsilent group companions and surviving audio', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const paused = createWavFixture({ name: 'grouped-paused.wav', frequency: 440, duration: 1, channelCount: 1 });
	paused.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
	const companion = createWavFixture({ name: 'grouped-companion.wav', frequency: 660, duration: 1, channelCount: 1 });
	await importFiles(editor, [paused, companion]);
	await clipByName(editor, paused.name).locator('.clip-header').click();
	await clipByName(editor, companion.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split clips at silences']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(clipByName(editor, paused.name)).toHaveCount(2);
	await expect(clipByName(editor, companion.name)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(clipByName(editor, paused.name)).toHaveCount(1);
	await expect(clipByName(editor, companion.name)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(clipByName(editor, companion.name)).toBeVisible();
});
