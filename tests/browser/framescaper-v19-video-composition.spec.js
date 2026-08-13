import { expect, test } from '@playwright/test';

import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	getMenuItem,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

test.describe('Framescaper V19 video composition authoring', () => {
	registerAudioEditorHooks();

	test.beforeEach(async ({ page }) => {
		await installPinnedFfmpegRuntimeRoutes(page);
	});

	test('reaches composition from Edit, preserves it through history, and reopens it', async ({ page }) => {
		test.setTimeout(90_000);
		await page.setViewportSize({ width: 1_280, height: 1_000 });
		const editor = await bootEditor(page, '/framescaper/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await importFiles(editor, [createDeterministicAvFixture('composition-source.webm')]);

		await selectOnlyVideoClip(editor);
		await openCompositionDialog(page, editor);

		let dialog = compositionDialog(page);
		await expect(numberField(dialog, 'Left (%)')).toHaveValue('0');
		await expect(numberField(dialog, 'Position X offset (%)')).toHaveValue('0');
		await expect(numberField(dialog, 'Scale X (%)')).toHaveValue('100');
		await expect(numberField(dialog, 'Opacity (%)')).toHaveValue('100');
		await expect(dialog.getByRole('combobox', { name: 'Blend mode', exact: true })).toHaveValue('normal');

		await numberField(dialog, 'Left (%)').fill('12.5');
		await numberField(dialog, 'Position X offset (%)').fill('20');
		await numberField(dialog, 'Scale X (%)').fill('125');
		await numberField(dialog, 'Rotation (degrees)').fill('17');
		await dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true }).check();
		await numberField(dialog, 'Opacity (%)').fill('65');
		await dialog.getByRole('combobox', { name: 'Blend mode', exact: true }).selectOption('screen');
		await numberField(dialog, 'Layer order').fill('7');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Composition applied.');
		await closeCompositionDialog(dialog);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		const redo = editor.getByRole('button', { name: 'Redo', exact: true });
		await expect(redo).toBeEnabled();
		await redo.click();
		await openCompositionDialog(page, editor);
		dialog = compositionDialog(page);
		await expectAuthoredComposition(dialog);
		await closeCompositionDialog(dialog);

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		await page.goto(`/framescaper/en/?project=${encodeURIComponent(projectId)}`);
		const reopened = await waitForFramescaperEditor(page, projectId);
		await selectOnlyVideoClip(reopened);
		await openCompositionDialog(page, reopened);
		await expectAuthoredComposition(compositionDialog(page));
	});

	test('does not expose the Framescaper composition command in Soundscaper', async ({ page }) => {
		const editor = await bootEditor(page, '/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');

		const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
		await menubar.getByRole('menuitem', { name: 'Edit', exact: true }).click();
		const editMenu = page.getByRole('menu', { name: 'Edit', exact: true });
		const clipBoundaries = getMenuItem(editMenu, 'Audio clips');
		await clipBoundaries.focus();
		await page.keyboard.press('ArrowRight');
		const clipBoundariesMenu = clipBoundaries.getByRole('menu');
		await expect(clipBoundariesMenu).toBeVisible();
		await expect(clipBoundariesMenu.getByRole('menuitem', {
			name: 'Transform and compositing',
			exact: true,
		})).toHaveCount(0);
	});
});

async function openCompositionDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Edit', [
		'Audio clips',
		'Transform and compositing',
	]);
	await expect(compositionDialog(page)).toBeVisible();
}

async function selectOnlyVideoClip(editor) {
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

function compositionDialog(page) {
	return page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
}

async function closeCompositionDialog(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function expectAuthoredComposition(dialog) {
	await expect(numberField(dialog, 'Left (%)')).toHaveValue('12.5');
	await expect(numberField(dialog, 'Position X offset (%)')).toHaveValue('20');
	await expect(numberField(dialog, 'Scale X (%)')).toHaveValue('125');
	await expect(numberField(dialog, 'Rotation (degrees)')).toHaveValue('17');
	await expect(dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true })).toBeChecked();
	await expect(numberField(dialog, 'Opacity (%)')).toHaveValue('65');
	await expect(dialog.getByRole('combobox', { name: 'Blend mode', exact: true })).toHaveValue('screen');
	await expect(numberField(dialog, 'Layer order')).toHaveValue('7');
}

function numberField(dialog, name) {
	return dialog.getByRole('spinbutton', { name, exact: true });
}

async function waitForFramescaperEditor(page, projectId) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor).toHaveAttribute('data-product', 'framescaper');
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', {
		timeout: 15_000,
	});
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}
