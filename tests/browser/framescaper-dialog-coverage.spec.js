/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test.describe('Framescaper dialog coverage', () => {
	registerAudioEditorHooks();

	test('commits every video composition control through form and blur paths', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('dialog-composition.webm')]);
		await selectVideoClip(editor);
		await openComposition(page, editor);
		let dialog = compositionDialog(page);

		for (const [name, value] of [
			['Left (%)', '4'],
			['Top (%)', '5'],
			['Right (%)', '6'],
			['Bottom (%)', '7'],
			['Anchor X (%)', '45'],
			['Anchor Y (%)', '55'],
			['Position X offset (%)', '-12'],
			['Position Y offset (%)', '18'],
			['Scale X (%)', '110'],
			['Scale Y (%)', '95'],
			['Rotation (degrees)', '-23'],
			['Opacity (%)', '72'],
			['Layer order', '-4'],
		]) {
			await dialog.getByRole('spinbutton', { name, exact: true }).fill(value);
		}
		await dialog.getByRole('checkbox', { name: 'Flip horizontally', exact: true }).check();
		await dialog.getByRole('checkbox', { name: 'Flip vertically', exact: true }).check();
		await dialog.getByRole('combobox', { name: 'Blend mode', exact: true }).selectOption('multiply');
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Composition applied.');

		// A second submission has no mutation to record, but still exercises the
		// dialog's equality guard instead of adding duplicate history.
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await dialog.getByRole('spinbutton', { name: 'Opacity (%)', exact: true }).fill('64');
		await dialog.getByRole('spinbutton', { name: 'Opacity (%)', exact: true }).evaluate((field) => field.blur());
		await expect(dialog.getByRole('status')).toContainText('Composition applied.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();

		await openComposition(page, editor);
		dialog = compositionDialog(page);
		await expect(dialog.getByRole('spinbutton', { name: 'Top (%)', exact: true })).toHaveValue('5');
		await expect(dialog.getByRole('spinbutton', { name: 'Opacity (%)', exact: true })).toHaveValue('64');
		await expect(dialog.getByRole('checkbox', { name: 'Flip vertically', exact: true })).toBeChecked();
		await expect(dialog.getByRole('combobox', { name: 'Blend mode', exact: true })).toHaveValue('multiply');
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Composition reset.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		expect(errors).toEqual([]);
	});

	test('validates, attempts generation, and switches video proxy work', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectClientErrors(page);
		const first = createDeterministicAvFixture('proxy-dialog-first.webm');
		const second = createDeterministicAvFixture('proxy-dialog-second.webm');
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [first]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 20_000,
		});
		await selectVideoClip(editor);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video proxies…']);
		const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
		const source = dialog.getByRole('combobox', { name: 'Video source', exact: true });
		await expect(source.locator('option')).toHaveCount(1);
		await source.selectOption({ label: first.name });
		await expect(source.locator('option:checked')).toHaveText(first.name);

		const chooserPromise = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
		const chooser = await chooserPromise;
		await chooser.setFiles({
			name: 'empty-proxy.webm',
			mimeType: 'video/webm',
			buffer: Buffer.alloc(0),
		});
		await expect(proxyStatus(dialog, 'cannot be empty')).toContainText('cannot be empty', {
			timeout: 20_000,
		});

		const generate = dialog.getByRole('button', { name: 'Generate and attach', exact: true });
		await expect(generate).toBeVisible();
		await generate.click();
		await expect(proxyStatus(dialog, 'cancelled')).toContainText('cancelled', { timeout: 30_000 });
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();

		await importFiles(editor, [second]);
		await selectVideoClip(editor);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video proxies…']);
		const reopened = page.getByRole('dialog', { name: 'Video proxies', exact: true });
		const reopenedSource = reopened.getByRole('combobox', { name: 'Video source', exact: true });
		await expect(reopenedSource.locator('option')).toHaveCount(2);
		await reopenedSource.selectOption({ label: second.name });
		await expect(reopenedSource.locator('option:checked')).toHaveText(second.name);
		await reopened.getByRole('button', { name: 'Close', exact: true }).click();
		expect(errors).toEqual([]);
	});
});

async function selectVideoClip(editor) {
	const clips = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clips.first()).toBeVisible();
	await clips.first().focus();
	await clips.first().press('Enter');
}

async function openComposition(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
	await expect(compositionDialog(page)).toBeVisible();
}

function compositionDialog(page) {
	return page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
}

function proxyStatus(dialog, text) {
	return dialog.getByRole('status').filter({ hasText: text }).first();
}
