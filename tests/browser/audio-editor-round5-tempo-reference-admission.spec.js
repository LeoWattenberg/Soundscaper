/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, commitInput, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Change tempo refuses a source BPM that cannot preserve its chosen destination', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await clipByName(editor, monoTone.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const from = dialog.locator('[data-effect-param="effectAudacityFromBpm"] input');
	const to = dialog.locator('[data-effect-param="effectAudacityToBpm"] input');
	await commitInput(from, '120');
	await commitInput(to, '240');
	await expect(to).toHaveValue('240');
	await commitInput(from, '100');
	await expect(to).toHaveValue('240');
	await expect(from).toHaveAttribute('aria-invalid', 'true');
	await commitInput(from, '160');
	await expect(from).not.toHaveAttribute('aria-invalid', 'true');
	await expect(to).toHaveValue('240');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect((await exportSamples(page, editor)).length).toBe(25_600);
});
