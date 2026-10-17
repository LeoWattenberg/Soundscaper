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
import { chooseClipMediaSetting } from './audio-editor-clip-settings-test-helpers.js';

function pitchField(dialog) {
	return dialog.getByRole('textbox', { name: 'Pitch', exact: true });
}

function speedField(dialog) {
	return dialog.getByRole('textbox', { name: 'Speed', exact: true });
}

async function expectHighlighted(field) {
	await expect(field).toBeFocused();
	await expect(field).toBeInViewport({ ratio: 1 });
	await expect(field.locator('xpath=ancestor::*[@data-clip-properties-field][1]')).toHaveCSS('border-color', 'rgb(103, 124, 228)');
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
		await chooseClipMediaSetting(dialog, 'Stretch with project tempo changes');
		await closeClipProperties(dialog);
		await expect(speed).toHaveCount(0);
		await expect(clip).not.toContainText('100%');

		for (const [ratio, percentage] of [['0.9999999', '99.9%'], ['1.0000001', '100.1%']]) {
			dialog = await openClipProperties(page, editor, clip);

			await commitInput(speedField(dialog), String(Number(ratio) * 100));
			await closeClipProperties(dialog);
			await expect(speed).toContainText(percentage);
		}

		dialog = await openClipProperties(page, editor, clip);

		await commitInput(speedField(dialog), '100');
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

		await commitInput(pitchField(dialog), '2');
		await commitInput(speedField(dialog), '125');
		await closeClipProperties(dialog);
		await otherClip.focus();
		await otherClip.press('Enter');

		await clip.getByRole('button', { name: 'Clip pitch', exact: true }).click();
		dialog = editor.locator('[data-workspace-panel="clip-properties"]');
		await expect(dialog).toBeVisible();
		const pitchInput = dialog.getByRole('textbox', { name: 'Pitch', exact: true });
		const speedInput = dialog.getByRole('textbox', { name: 'Speed', exact: true });
		await expectHighlighted(pitchInput);
		await expect(pitchInput).toHaveValue('2');
		await closeClipProperties(dialog);
		await otherClip.focus();
		await otherClip.press('Enter');

		await clip.getByRole('button', { name: 'Clip speed', exact: true }).click();
		await expect(dialog).toBeVisible();
		await expectHighlighted(speedInput);
		await expect(speedInput).toHaveValue('125');
		await closeClipProperties(dialog);

		await clip.getByRole('button', { name: 'Clip pitch', exact: true }).press('Enter');
		await expect(dialog).toBeVisible();
		await expectHighlighted(pitchInput);
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

		await commitInput(pitchField(dialog), '2');
		await commitInput(speedField(dialog), '125');
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
