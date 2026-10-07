/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const control of ['Solo', 'Mute']) test(`Control-click ${control} isolates the target track in one edit`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['first.wav', 'second.wav'].map(name => createWavFixture({ name, duration: 0.8, channelCount: 1 }));
	await importFiles(editor, files);
	const rows = files.map(file => clipByName(editor, file.name).locator('xpath=ancestor::div[@data-track-row]'));
	const buttons = rows.map(row => row.getByRole('button', { name: control, exact: true }));
	await buttons[0].click();
	await expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
	await buttons[1].click({ modifiers: ['Control'] });
	await expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
	await expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
	await expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
	await expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
});
