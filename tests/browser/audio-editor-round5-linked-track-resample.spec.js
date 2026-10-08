/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeClipProperties,
	importFiles, openClipProperties,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('resampling a camera audio track preserves its picture, link and one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('track-camera.webm')]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	const audio = editor.getByRole('group', { name: /^track-camera Audio clip,/u });
	await audio.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Resample');
	const rateDialog = page.getByRole('dialog', { name: 'Resample', exact: true });
	await rateDialog.locator('input').fill('24000');
	await rateDialog.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(rateDialog).toBeHidden({ timeout: 10_000 });
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-clip-kind="video"]')).toHaveCount(1);
	const properties = await openClipProperties(page, editor, audio);
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(properties.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value')).toHaveText('24000');
	await closeClipProperties(properties);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, audio);
	await restored.getByText('Media settings', { exact: true }).click();
	await expect(restored.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value')).toHaveText('48000');
	await closeClipProperties(restored);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
