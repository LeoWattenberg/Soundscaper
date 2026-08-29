import { expect, test } from './audio-editor-test-fixtures.js';
import {
	collectClientErrors,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.describe('sequence timing surfaces', () => {
	registerAudioEditorHooks();

	test('edits the sequence rate, drop frame, and start timecode from the video workspace', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootVideoEditor(page);
		const readout = editor.locator('[data-sequence-timecode]');
		const timecodeField = editor.getByRole('textbox', { name: 'Timecode', exact: true });

		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:00');
		await expect(timecodeField).toHaveValue('00:00:00:00');

		const flyout = await openSequenceTiming(page, editor);
		const rate = flyout.getByRole('combobox', { name: 'Frame rate', exact: true });
		const dropFrame = flyout.getByRole('checkbox', { name: 'Drop frame', exact: true });
		await expect(rate).toHaveValue('30/1');
		await expect(dropFrame).toBeDisabled();

		await rate.selectOption('25/1');
		await expect(flyout.locator('[data-sequence-rate]')).toHaveAttribute('data-sequence-rate', '25/1');
		await expect(dropFrame).toBeDisabled();

		await rate.selectOption('30000/1001');
		await expect(dropFrame).toBeEnabled();
		await dropFrame.check();
		await expect(flyout.locator('[data-sequence-drop-frame]')).toHaveAttribute('data-sequence-drop-frame', 'true');

		const startTimecode = flyout.getByRole('textbox', { name: 'Start timecode', exact: true });
		await expect(startTimecode).toHaveValue('00:00:00;00');
		await startTimecode.fill('01:00:00;00');
		await startTimecode.blur();
		await expect(flyout.locator('[data-sequence-start-timecode]'))
			.toHaveAttribute('data-sequence-start-timecode', '01:00:00;00');

		await flyout.getByRole('checkbox', { name: 'Timecode ruler', exact: true }).check();
		await page.keyboard.press('Escape');
		await expect(flyout).toBeHidden();

		const ruler = editor.locator('[data-ruler]');
		await expect(ruler).toHaveAttribute('data-time-format', 'timecode');
		await expect(ruler.locator('[data-sequence-timecode-ruler]')).toHaveCount(1);
		await expect(readout).toHaveAttribute('data-sequence-timecode', '01:00:00;00');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
		await page.reload();
		editor = await waitForVideoEditor(page);
		await expect(editor.locator('[data-ruler]')).toHaveAttribute('data-time-format', 'timecode');
		await expect(editor.locator('[data-sequence-timecode]'))
			.toHaveAttribute('data-sequence-timecode', '01:00:00;00');
		expect(errors).toEqual([]);
	});

	test('steps whole frames and seeks typed labels the sequence rate produces', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootVideoEditor(page);
		const readout = editor.locator('[data-sequence-timecode]');
		const timecodeField = editor.getByRole('textbox', { name: 'Timecode', exact: true });

		await editor.getByRole('button', { name: 'Next frame', exact: true }).click();
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:01');
		await editor.getByRole('button', { name: 'Next frame', exact: true }).click();
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:02');
		await editor.getByRole('button', { name: 'Previous frame', exact: true }).click();
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:01');

		await editor.getByRole('button', { name: 'Next frame', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:02');
		await editor.getByRole('button', { name: 'Previous frame', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:00:01');

		await timecodeField.fill('00:00:02:00');
		await timecodeField.press('Enter');
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:02:00');

		const flyout = await openSequenceTiming(page, editor);
		await flyout.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('30000/1001');
		await flyout.getByRole('checkbox', { name: 'Drop frame', exact: true }).check();
		await page.keyboard.press('Escape');
		await expect(flyout).toBeHidden();

		await timecodeField.fill('00:01:00;00');
		await timecodeField.press('Enter');
		await expect(editor.getByRole('alert')
			.filter({ hasText: 'Enter a timecode this sequence rate produces' })).toBeVisible();
		await expect(timecodeField).toHaveAttribute('aria-invalid', 'true');

		await timecodeField.fill('00:00:10;00');
		await timecodeField.press('Enter');
		await expect(readout).toHaveAttribute('data-sequence-timecode', '00:00:10;00');
		await expect(timecodeField).toHaveAttribute('aria-invalid', 'false');
		expect(errors).toEqual([]);
	});
});

async function openSequenceTiming(page, editor) {
	await editor.getByRole('button', { name: 'Sequence timing', exact: true }).focus();
	await page.keyboard.press('Enter');
	const flyout = page.getByRole('dialog', { name: 'Sequence timing', exact: true });
	await expect(flyout).toBeVisible();
	return flyout;
}

async function bootVideoEditor(page) {
	await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
	return waitForVideoEditor(page);
}

async function waitForVideoEditor(page) {
	const editor = await waitForEditor(page);
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	const workspace = page.locator('[data-sidebar] [data-workspace-select]');
	await workspace.selectOption('video-editor');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	return editor;
}
