/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, chooseCommandAction, chooseNestedCommandAction,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('resampling camera audio preserves its linked video and Undo restores the original source', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	const audio = editor.getByRole('group', { name: /^camera Audio clip,/u });
	await audio.locator('.clip-header').click();
	const properties = await openClipProperties(page, editor, audio);
	await properties.getByText('Media settings', { exact: true }).click();
	await properties.getByRole('button', { name: 'Resample', exact: true }).click();
	const resample = page.locator('[data-clip-resample-dialog]');
	await resample.getByRole('textbox').fill('24000');
	await resample.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(resample).toBeHidden();
	await closeClipProperties(properties);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-clip-kind="video"]')).toHaveCount(1);
	const changed = await openClipProperties(page, editor, audio);
	await changed.getByText('Media settings', { exact: true }).click();
	await expect(changed.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value')).toHaveText('24000');
	await closeClipProperties(changed);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, audio);
	await restored.getByText('Media settings', { exact: true }).click();
	await expect(restored.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value')).toHaveText('48000');
});
