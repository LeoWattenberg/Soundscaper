import { expect, test } from './audio-editor-test-fixtures.js';
import { clipByName } from './audio-editor-clip-locators.js';
import {
	bootEditor,
	chooseCommandAction,
	closeDialog,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('audio editor Morse code generator', () => {
	registerAudioEditorHooks();

	test('encodes a message, previews it and keys it onto the timeline', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Generate', 'Morse code');
		const dialog = page.getByRole('dialog', { name: 'Morse code', exact: true });
		const encoding = dialog.locator('.kw-audio-editor-generator__morse-code');

		// The default message previews before anything is typed.
		await expect(encoding).toHaveText('... --- ...');

		await dialog.locator('[data-generator-field="text"] input').fill('cq dx');
		await expect(encoding).toHaveText('-.-. --.- / -.. -..-');
		await dialog.locator('[data-generator-field="wordsPerMinute"] input').fill('60');

		// The output length is derived from the message and the speed, so the
		// dialog reports it rather than accepting it.
		const duration = dialog.locator('[data-generator-field="durationSeconds"] input').first();
		await expect(duration).toBeDisabled();

		await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
		await expect(clipByName(editor, 'Morse code')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('refuses to send a message Morse code has no signal for', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Generate', 'Morse code');
		const dialog = page.getByRole('dialog', { name: 'Morse code', exact: true });
		const generate = dialog.getByRole('button', { name: 'Generate', exact: true });

		await dialog.locator('[data-generator-field="text"] input').fill('sos ✳');
		await expect(dialog.getByText('Unsupported characters', { exact: true })).toBeVisible();
		await expect(generate).toBeDisabled();

		await dialog.locator('[data-generator-field="text"] input').fill('sos');
		await expect(generate).toBeEnabled();
		await closeDialog(dialog);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	});
});
