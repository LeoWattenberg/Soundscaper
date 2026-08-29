import { expect, test } from '@playwright/test';

import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	importFiles,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';

test.describe('Framescaper v1 video composition authoring', () => {
	registerAudioEditorHooks();

	test('authors by keyboard with announced validation, accessible colors, history, reset, and reopen', async ({ browserName, page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1_280, height: 1_000 });
		const editor = await bootEditor(page, '/framescaper/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await importFiles(editor, [createDeterministicAvFixture('composition-source.webm')]);

		await selectOnlyVideoClip(editor);
		await page.emulateMedia({ forcedColors: 'active' });
		const editMenuTrigger = await openCompositionDialog(page, editor, { inspectMenu: true, browserName });

		let dialog = compositionDialog(page);
		await expect(numberField(dialog, 'Left (%)')).toBeFocused();
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		await expect(dialog).toHaveAttribute('aria-describedby', 'video-composition-description');
		await expect(dialog.locator('#video-composition-description')).toBeVisible();
		const status = dialog.getByRole('status');
		await expect(status).toHaveAttribute('aria-live', 'polite');
		await expect(status).toHaveAttribute('aria-atomic', 'true');
		await assertAccessibleBasics(dialog);
		await expect(dialog).toHaveCSS('border-top-width', '1px');
		// WebKit does not implement forced-color-adjust, so its computed value is
		// empty there rather than the inherited 'auto'.
		if (browserName !== 'webkit') {
			await expect(dialog).toHaveCSS('forced-color-adjust', 'auto');
			await expect(numberField(dialog, 'Left (%)')).toHaveCSS('forced-color-adjust', 'auto');
		}
		await page.emulateMedia({ forcedColors: 'none' });
		await assertNoSeriousAxeViolations(page, '[data-video-composition-dialog]');

		await expectDefaultComposition(dialog);
		await numberField(dialog, 'Left (%)').fill('60');
		await numberField(dialog, 'Right (%)').fill('40');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
		const invalidMessage = 'Check that every composition value is within its displayed range.';
		await expect(status).toHaveText(invalidMessage);
		await expect(dialog.getByRole('alert')).toHaveText(invalidMessage);
		await closeCompositionDialog(page, dialog, editMenuTrigger);

		await openCompositionDialog(page, editor);
		dialog = compositionDialog(page);
		await expectDefaultComposition(dialog);

		await numberField(dialog, 'Left (%)').fill('12.5');
		await numberField(dialog, 'Position X offset (%)').fill('20');
		await numberField(dialog, 'Scale X (%)').fill('125');
		await numberField(dialog, 'Rotation (degrees)').fill('17');
		await dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true }).check();
		await numberField(dialog, 'Opacity (%)').fill('65');
		await dialog.getByRole('combobox', { name: 'Blend mode', exact: true }).selectOption('screen');
		await numberField(dialog, 'Layer order').fill('7');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
		await expect(dialog.getByRole('status')).toContainText('Composition applied.');
		await closeCompositionDialog(page, dialog, editMenuTrigger);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		const redo = editor.getByRole('button', { name: 'Redo', exact: true });
		await expect(redo).toBeEnabled();
		await openCompositionDialog(page, editor);
		dialog = compositionDialog(page);
		await expectDefaultComposition(dialog);
		await closeCompositionDialog(page, dialog, editMenuTrigger);

		await redo.click();
		await expect(redo).toBeDisabled();
		await openCompositionDialog(page, editor);
		dialog = compositionDialog(page);
		await expectAuthoredComposition(dialog);
		await dialog.getByRole('button', { name: 'Reset', exact: true }).press('Enter');
		await expect(dialog.getByRole('status')).toContainText('Composition reset.');
		await expectDefaultComposition(dialog);
		await closeCompositionDialog(page, dialog, editMenuTrigger);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(redo).toBeEnabled();
		await openCompositionDialog(page, editor);
		dialog = compositionDialog(page);
		await expectAuthoredComposition(dialog);
		await closeCompositionDialog(page, dialog, editMenuTrigger);

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		await page.goto(resolveBrowserProductTestUrl(
			`/framescaper/en/?project=${encodeURIComponent(projectId)}`,
		));
		const reopened = await waitForFramescaperEditor(page, projectId);
		await selectOnlyVideoClip(reopened);
		await openCompositionDialog(page, reopened);
		await expectAuthoredComposition(compositionDialog(page));
	});

	test('does not expose the Framescaper composition command in Soundscaper', async ({ page }) => {
		const editor = await bootEditor(page, '/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');

		const clipBoundariesMenu = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
		await expect(clipBoundariesMenu.getByRole('menuitem', {
			name: 'Transform and compositing',
			exact: true,
		})).toHaveCount(0);
	});
});

async function openCompositionDialog(page, editor, { inspectMenu = false, browserName = null } = {}) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	const edit = menubar.getByRole('menuitem', { name: 'Edit', exact: true });
	const clipBoundariesMenu = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	const composition = clipBoundariesMenu.getByRole('menuitem', {
		name: 'Transform and compositing',
		exact: true,
	});
	await expect(composition).toBeEnabled();
	await composition.focus();
	if (inspectMenu) {
		await clipBoundariesMenu.evaluate((element) => {
			element.id = 'framescaper-video-composition-accessibility-menu';
		});
		await assertAccessibleBasics(clipBoundariesMenu);
		await assertNoSeriousAxeViolations(page, '#framescaper-video-composition-accessibility-menu');
		// WebKit does not implement forced-color-adjust, so its computed value is
		// empty there rather than the inherited 'auto'.
		if (browserName !== 'webkit') {
			await expect(composition).toHaveCSS('forced-color-adjust', 'auto');
		}
	}
	await composition.press('Enter');
	await expect(compositionDialog(page)).toBeVisible();
	return edit;
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

async function closeCompositionDialog(page, dialog, returnTarget) {
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(returnTarget).toBeFocused();
}

async function expectDefaultComposition(dialog) {
	await expect(numberField(dialog, 'Left (%)')).toHaveValue('0');
	await expect(numberField(dialog, 'Right (%)')).toHaveValue('0');
	await expect(numberField(dialog, 'Position X offset (%)')).toHaveValue('0');
	await expect(numberField(dialog, 'Scale X (%)')).toHaveValue('100');
	await expect(dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true })).not.toBeChecked();
	await expect(numberField(dialog, 'Opacity (%)')).toHaveValue('100');
	await expect(dialog.getByRole('combobox', { name: 'Blend mode', exact: true })).toHaveValue('normal');
	await expect(numberField(dialog, 'Layer order')).toHaveValue('0');
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
