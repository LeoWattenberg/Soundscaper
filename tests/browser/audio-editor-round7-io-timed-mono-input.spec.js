/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject, recordPass } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

test('a negotiated mono default microphone can schedule the same take it records ordinarily', async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	const stereo = preferences.getByRole('radio', { name: 'Stereo', exact: true });
	await expect(stereo).toBeEnabled();
	await stereo.check();
	await expect(stereo).toBeChecked();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const projectId = await editor.getAttribute('data-project-id');
	await recordPass(page, editor);
	const saved = await persistedProject(page, projectId);
	expect(saved.sources.at(-1).channelCount).toBe(1);
	expect(saved.sources.at(-1).frameCount).toBeGreaterThan(4096);
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const start = new Date(Date.now() + 30_000);
	const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
	await dialog.locator('input[type="datetime-local"]').first().fill(local);
	await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
	const scheduled = editor.getByRole('region', { name: /Recording is scheduled for/u });
	await expect(scheduled).toBeVisible();
	await expect(dialog).toBeHidden();
	await scheduled.getByRole('button', { name: 'Cancel scheduled recording', exact: true }).click();
	await expect(scheduled).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
