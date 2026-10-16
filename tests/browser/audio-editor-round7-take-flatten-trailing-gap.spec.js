/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('a normally shortened take comp retains its complete silent trailing extent when flattened', async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Comp loop.wav', duration: .8,
		channelCount: 1, channelAmplitudes: [0] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Record loop into takes', exact: true }).click();
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => capturedFrames(page)).toBeGreaterThan(48_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	await expect.poll(async () => (await persistedProject(page, projectId)).takeGroups.length).toBe(1);
	const recorded = await persistedProject(page, projectId);
	const group = recorded.takeGroups[0];
	expect(group.endSample - group.startSample).toBe(38_400);
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Take lanes and comps');
	let dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await dialog.getByRole('button', { name: 'Flatten comp', exact: true }).click();
	await Promise.race([dialog.locator('[data-take-comp-empty]').waitFor({ state: 'visible' }),
		editor.getByRole('alert').first().waitFor({ state: 'visible' })]);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect((await persistedProject(page, projectId)).takeGroups).toEqual(recorded.takeGroups);
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Take lanes and comps');
	dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	const region = dialog.getByRole('table', { name: 'Comp regions', exact: true }).locator('tbody tr').first();
	await region.locator('[data-timecode-direct-entry]').nth(1).fill('19200');
	await region.getByRole('button', { name: 'Apply end', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Take comp updated.');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const shortened = await persistedProject(page, projectId);
	expect(shortened.takeGroups[0].compRegions[0].endSample).toBe(19_200);
	await dialog.getByRole('button', { name: 'Flatten comp', exact: true }).click();
	await Promise.race([dialog.locator('[data-take-comp-empty]').waitFor({ state: 'visible' }),
		editor.getByRole('alert').first().waitFor({ state: 'visible' })]);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const flattened = await persistedProject(page, projectId);
	const output = flattened.sources.find(source => source.name.includes('flattened take'));
	expect(output.frameCount).toBe(38_400);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect((await persistedProject(page, projectId)).takeGroups).toEqual(shortened.takeGroups);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	expect((await persistedProject(page, projectId)).takeGroups).toHaveLength(0);
});

async function capturedFrames(page) {
	return page.evaluate(async databaseName => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			const rows = await new Promise((resolve, reject) => {
				const request = database.transaction('analysis', 'readonly').objectStore('analysis').getAll();
				request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
			});
			return Math.max(0, ...rows.filter(row => row.key?.startsWith('raw-pcm-spool-registry-v1:'))
				.flatMap(row => row.value?.records ?? []).map(record => record.frameCount));
		} finally { database.close(); }
	}, SOUNDSCAPER_DATABASE_NAME);
}
