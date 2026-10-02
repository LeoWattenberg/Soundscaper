/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	closeClipProperties,
	collectClientErrors,
	commitInput,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

function pitchField(dialog) {
	return dialog.getByRole('spinbutton', { name: /^Pitch \(semitones/u });
}

function speedField(dialog) {
	return dialog.getByRole('spinbutton', { name: 'Speed ratio', exact: true });
}

async function expectHighlighted(field) {
	await expect(field).toBeFocused();
	await expect(field).toBeInViewport({ ratio: 1 });
	await expect(field.locator('..')).toHaveClass(/text-input--active/u);
}

test.describe('clip pitch and speed indicators', () => {
	registerAudioEditorHooks();

	test('omits normal speed and preserves the direction of tiny speed changes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const speed = clip.getByRole('button', { name: 'Clip speed', exact: true });
		await expect(speed).toHaveCount(0);
		await expect(clip).not.toContainText('100%');

		let dialog = await openClipProperties(page, editor, clip);
		await dialog.getByText('Pitch and tempo', { exact: true }).click();
		await dialog.getByRole('checkbox', { name: 'Stretch with project tempo changes', exact: true }).check();
		await closeClipProperties(dialog);
		await expect(speed).toHaveCount(0);
		await expect(clip).not.toContainText('100%');

		for (const [ratio, percentage] of [['0.9999999', '99.9%'], ['1.0000001', '100.1%']]) {
			dialog = await openClipProperties(page, editor, clip);
			await dialog.getByText('Pitch and tempo', { exact: true }).click();
			await commitInput(speedField(dialog), ratio);
			await closeClipProperties(dialog);
			await expect(speed).toContainText(percentage);
		}

		dialog = await openClipProperties(page, editor, clip);
		await dialog.getByText('Pitch and tempo', { exact: true }).click();
		await commitInput(speedField(dialog), '1');
		await closeClipProperties(dialog);
		await expect(speed).toHaveCount(0);
		await expect(clip).not.toContainText('100%');
		expect(errors).toEqual([]);
	});

	test('opens clip properties with the clicked pitch or speed control focused', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const otherTone = { ...longTone, name: 'other-clip.wav' };
		await importFiles(editor, [longTone, otherTone]);
		const clip = clipByName(editor, longTone.name);
		const otherClip = clipByName(editor, otherTone.name);
		let dialog = await openClipProperties(page, editor, clip);
		await dialog.getByText('Pitch and tempo', { exact: true }).click();
		await commitInput(pitchField(dialog), '2');
		await commitInput(speedField(dialog), '1.25');
		await closeClipProperties(dialog);
		await otherClip.focus();
		await otherClip.press('Enter');

		await clip.getByRole('button', { name: 'Clip pitch', exact: true }).click();
		dialog = editor.locator('[data-workspace-panel="clip-properties"]');
		await expect(dialog).toBeVisible();
		await expectHighlighted(pitchField(dialog));
		await expect(pitchField(dialog)).toHaveValue('2.00');
		await closeClipProperties(dialog);
		await otherClip.focus();
		await otherClip.press('Enter');

		await clip.getByRole('button', { name: 'Clip speed', exact: true }).click();
		await expect(dialog).toBeVisible();
		await expectHighlighted(speedField(dialog));
		await expect(speedField(dialog)).toHaveValue('1.25');
		await closeClipProperties(dialog);

		await clip.getByRole('button', { name: 'Clip pitch', exact: true }).press('Enter');
		await expect(dialog).toBeVisible();
		await expectHighlighted(pitchField(dialog));
		expect(errors).toEqual([]);
	});

	test('double clicking an indicator resets only its own value and remains undoable', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		const clip = clipByName(editor, longTone.name);
		const pitch = clip.getByRole('button', { name: 'Clip pitch', exact: true });
		const speed = clip.getByRole('button', { name: 'Clip speed', exact: true });
		const dialog = await openClipProperties(page, editor, clip);
		await dialog.getByText('Pitch and tempo', { exact: true }).click();
		await commitInput(pitchField(dialog), '2');
		await commitInput(speedField(dialog), '1.25');
		await closeClipProperties(dialog);

		await pitch.dblclick();
		await expect(pitch).toHaveCount(0);
		await expect(speed).toContainText('125%');
		await expect(dialog).toBeHidden();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(pitch).toContainText('+2');

		await speed.dblclick();
		await expect(speed).toHaveCount(0);
		await expect(pitch).toContainText('+2');
		await expect(dialog).toBeHidden();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(speed).toContainText('125%');
		expect(errors).toEqual([]);
	});
});
