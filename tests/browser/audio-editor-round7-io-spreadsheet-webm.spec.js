/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test, createWavFixture, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

const recording = Buffer.from(readFileSync(new URL('../fixtures/chromium-audio-only.webm.base64', import.meta.url), 'utf8'), 'base64');

test('Clip spreadsheet loads an ordinary audio-only WebM source through its referenced-file picker', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'short-template.wav', frequency: 330, duration: 0.1 })]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const sourceCell = grid.getByRole('gridcell').and(grid.locator('[data-row="0"][data-column="source"]'));
	const originalId = await sourceCell.textContent();
	async function replace(file) {
		await sourceCell.dblclick();
		const draft = grid.getByLabel('Source file', { exact: true });
		await draft.fill(`/recordings/${file.name}`);
		await draft.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Clip spreadsheet', exact: true });
		await expect(dialog.getByText(`/recordings/${file.name}`, { exact: true })).toBeVisible();
		const choosing = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choosing).setFiles(file);
		await expect(dialog).toHaveCount(0);
		await expect(sourceCell).not.toHaveText(originalId);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
		const source = project.sources.find(candidate => candidate.id === project.clips[0].sourceId);
		expect(source.name).toBe(file.name);
		expect(source.kind).toBe('audio');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(sourceCell).toHaveText(originalId);
	}
	await replace(toneB);
	await replace({ name: 'Voice memo.webm', mimeType: 'audio/webm', buffer: recording });
});
