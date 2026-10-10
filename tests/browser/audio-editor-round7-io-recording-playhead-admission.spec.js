/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject, recordPass } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });

for (const seekWhileArmed of [false, true]) test(`scheduled recording preserves its armed playhead with keyboard seek=${seekWhileArmed}`, async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const playhead = editor.locator('[data-playhead]');
	await playhead.focus();
	await playhead.press('End');
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(30_000);
	await playhead.press('Home');
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const start = new Date(Date.now() + 30_000);
	const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
	await dialog.locator('input[type="datetime-local"]').first().fill(local);
	await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
	const scheduled = editor.getByRole('region', { name: /Recording is scheduled for/u });
	try {
		await expect(scheduled).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		if (seekWhileArmed) {
			await playhead.focus();
			await playhead.press('End');
			await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		}
	} finally {
		if (await scheduled.isVisible()) {
			await scheduled.getByRole('button', { name: 'Cancel scheduled recording', exact: true }).click();
			await expect(scheduled).toBeHidden();
		}
	}
	await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toBeEnabled();
	await playhead.focus();
	await playhead.press('End');
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(30_000);
	await playhead.press('Home');
	await recordPass(page, editor);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(project.sources.at(-1).frameCount).toBeGreaterThan(4_096);
});

for (const navigation of ['unchanged', 'region', 'skip']) test(`scheduled recording retains its programme clock through ordinary ${navigation} selection navigation`, async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const playhead = editor.locator('[data-playhead]');
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await playhead.focus(); await playhead.press('End');
	const armedFrame = await playhead.getAttribute('aria-valuenow');
	expect(Number(armedFrame)).toBeGreaterThan(30_000);
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const start = new Date(Date.now() + 30_000);
	const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
	await dialog.locator('input[type="datetime-local"]').first().fill(local);
	await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
	const scheduled = editor.getByRole('region', { name: /Recording is scheduled for/u });
	try {
		await expect(scheduled).toBeVisible();
		await expect(playhead).toHaveAttribute('aria-valuenow', armedFrame);
		if (navigation !== 'unchanged') await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
		if (navigation === 'skip') await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	} finally {
		if (await scheduled.isVisible()) {
			await scheduled.getByRole('button', { name: 'Cancel scheduled recording', exact: true }).click();
			await expect(scheduled).toBeHidden();
		}
	}
	await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toBeEnabled();
	if (navigation !== 'unchanged') await chooseCommandAction(page, editor, 'Select', 'Select none');
	const recorded = await recordPass(page, editor);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(project.sources.at(-1).frameCount).toBeGreaterThan(4_096);
	const recordedId = await recorded.clip.getAttribute('data-clip-id');
	expect(project.clips.find(clip => clip.id === recordedId).timelineStartFrame).toBeGreaterThan(1_000_000);
});
