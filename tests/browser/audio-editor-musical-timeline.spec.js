import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('musical timeline controls', () => {
	registerAudioEditorHooks();

	test('edits and persists tempo and signature maps from the Music workspace', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/en/');
		const workspace = page.locator('[data-sidebar] [data-workspace-select]');

		await expect(workspace).toHaveValue('modern');
		await expect(editor.getByRole('button', { name: 'Musical timeline', exact: true })).toHaveCount(0);
		await workspace.selectOption('music');
		await expect(editor).toHaveAttribute('data-workspace-preset', 'music');
		const projectTempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
		const signatureNumerator = editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true });
		const signatureDenominator = editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
		await expect(projectTempo).toBeVisible();
		await expect(signatureNumerator).toBeVisible();
		await projectTempo.fill('33.333333333333336');
		await signatureNumerator.fill('64');
		await signatureDenominator.fill('64');

		const musicalTimelineButton = editor.getByRole('button', { name: 'Musical timeline', exact: true });
		await musicalTimelineButton.focus();
		await page.keyboard.press('Enter');
		let flyout = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
		await expect(flyout).toBeVisible();
		await expect(flyout.getByRole('combobox', { name: 'Tempo anchoring', exact: true })).toHaveValue('musical');
		const rootTempo = flyout.getByRole('form', { name: 'Tempo event 1', exact: true });
		await expect(rootTempo.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('100');
		await expect(rootTempo.getByRole('spinbutton', { name: 'Tempo (BPM) denominator', exact: true })).toHaveValue('3');
		const rootSignature = flyout.getByRole('form', { name: 'Time signature event 1', exact: true });
		await expect(rootSignature.getByRole('spinbutton', { name: 'numerator', exact: true })).toHaveValue('64');
		await expect(rootSignature.getByRole('spinbutton', { name: 'denominator', exact: true })).toHaveValue('64');
		await flyout.getByRole('button', { name: 'Add tempo event', exact: true }).click();
		let secondTempo = flyout.getByRole('form', { name: 'Tempo event 2', exact: true });
		await expect(secondTempo).toBeVisible();
		await secondTempo.getByRole('spinbutton', { name: 'Beat position numerator', exact: true }).fill('8');
		const secondTempoBpm = secondTempo.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true });
		await secondTempoBpm.fill('90');
		await secondTempo.getByRole('spinbutton', { name: 'Tempo (BPM) denominator', exact: true }).fill('1');
		const tempoSave = secondTempo.getByRole('button', { name: 'Save', exact: true });
		await tempoSave.focus();
		await page.keyboard.press('Enter');
		await expect(tempoSave).toBeFocused();
		await editor.getByRole('button', { name: 'Undo', exact: true }).evaluate((button) => button.click());
		await expect(secondTempo.getByRole('spinbutton', { name: 'Beat position numerator', exact: true })).toHaveValue('4');
		await expect(secondTempo.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('100');
		await expect(tempoSave).toBeFocused();
		await editor.getByRole('button', { name: 'Redo', exact: true }).evaluate((button) => button.click());
		await expect(secondTempo.getByRole('spinbutton', { name: 'Beat position numerator', exact: true })).toHaveValue('8');
		await expect(secondTempo.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('90');
		secondTempo = flyout.getByRole('form', { name: 'Tempo event 2', exact: true });
		await expect(secondTempo.getByRole('spinbutton', { name: 'Beat position numerator', exact: true })).toHaveValue('8');
		await expect(secondTempo.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('90');

		await flyout.getByRole('button', { name: 'Add time signature event', exact: true }).click();
		let secondSignature = flyout.getByRole('form', { name: 'Time signature event 2', exact: true });
		await expect(secondSignature).toBeVisible();
		await secondSignature.getByRole('spinbutton', { name: 'Bar position', exact: true }).fill('2');
		await secondSignature.getByRole('spinbutton', { name: 'numerator', exact: true }).fill('7');
		const secondSignatureDenominator = secondSignature.getByRole('spinbutton', { name: 'denominator', exact: true });
		await secondSignatureDenominator.fill('8');
		await expect(secondSignatureDenominator).toHaveValue('8');
		const signatureSave = secondSignature.getByRole('button', { name: 'Save', exact: true });
		await signatureSave.focus();
		await page.keyboard.press('Enter');
		await expect(signatureSave).toBeFocused();
		secondSignature = flyout.getByRole('form', { name: 'Time signature event 2', exact: true });
		await expect(secondSignature.getByRole('spinbutton', { name: 'Bar position', exact: true })).toHaveValue('2');
		await expect(secondSignature.getByRole('spinbutton', { name: 'numerator', exact: true })).toHaveValue('7');
		await expect(secondSignature.getByRole('spinbutton', { name: 'denominator', exact: true })).toHaveValue('8');
		await flyout.getByRole('button', { name: 'Add tempo event', exact: true }).click();
		const thirdTempo = flyout.getByRole('form', { name: 'Tempo event 3', exact: true });
		await thirdTempo.getByRole('button', { name: 'Remove tempo event', exact: true }).click();
		await expect(thirdTempo).toHaveCount(0);
		await expect(secondTempo.getByRole('spinbutton', { name: 'Beat position numerator', exact: true })).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(flyout).toBeHidden();
		await expect(musicalTimelineButton).toBeFocused();
		const timelineRuler = editor.locator('[data-ruler]');
		await expect(timelineRuler).toHaveAttribute('data-time-format', 'minutes-seconds');
		await expect(timelineRuler.locator('[data-musical-map-ruler]')).toHaveCount(0);
		await timelineRuler.press('Shift+F10');
		const timelineMenu = page.locator('.timeline-ruler-context-menu');
		await expect(timelineMenu).toBeVisible();
		await timelineMenu.getByRole('menuitem', { name: 'Beats & measures', exact: true }).click();
		await expect(timelineRuler).toHaveAttribute('data-time-format', 'beats-measures');
		await expect(timelineRuler.locator('[data-musical-map-ruler]')).toHaveCount(1);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		editor = await waitForEditor(page);
		await expect(page.locator('[data-sidebar] [data-workspace-select]')).toHaveValue('music');
		await expect(editor.locator('[data-ruler]')).toHaveAttribute('data-time-format', 'beats-measures');
		await expect(editor.locator('[data-musical-map-ruler]')).toHaveCount(1);

		await editor.getByRole('button', { name: 'Musical timeline', exact: true }).focus();
		await page.keyboard.press('Enter');
		flyout = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
		await expect(flyout).toBeVisible();
		await expect(flyout.getByRole('form', { name: 'Tempo event 1', exact: true })
			.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('100');
		await expect(flyout.getByRole('form', { name: 'Tempo event 1', exact: true })
			.getByRole('spinbutton', { name: 'Tempo (BPM) denominator', exact: true })).toHaveValue('3');
		await expect(flyout.getByRole('form', { name: 'Time signature event 1', exact: true })
			.getByRole('spinbutton', { name: 'numerator', exact: true })).toHaveValue('64');
		secondTempo = flyout.getByRole('form', { name: 'Tempo event 2', exact: true });
		await expect(secondTempo.getByRole('spinbutton', { name: 'Beat position numerator', exact: true })).toHaveValue('8');
		await expect(secondTempo.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('90');
		secondSignature = flyout.getByRole('form', { name: 'Time signature event 2', exact: true });
		await expect(secondSignature.getByRole('spinbutton', { name: 'Bar position', exact: true })).toHaveValue('2');
		await expect(secondSignature.getByRole('spinbutton', { name: 'numerator', exact: true })).toHaveValue('7');
		await expect(secondSignature.getByRole('spinbutton', { name: 'denominator', exact: true })).toHaveValue('8');
		expect(errors).toEqual([]);
	});
});
