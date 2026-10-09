/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, effectSourcePeak, importFiles } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('ordinary promoted mono microphone take flattens with its native width', async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'loop-silence.wav', duration: .8, channelCount: 1, channelAmplitudes: [0] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true }).getByRole('button', { name: 'Record loop into takes', exact: true }).click();
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await expect(record).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => capturedFrames(page)).toBeGreaterThan(48_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const id = await editor.getAttribute('data-project-id');
	const captured = await persistedProject(page, id);
	const group = captured.takeGroups[0];
	const take = group.takes.find(item => item.startSample === group.startSample && item.endSample === group.endSample);
	expect(take).toBeTruthy();
	const source = captured.sources.find(item => item.id === take.sourceId);
	expect(source.channelCount).toBe(1);
	const inputPeak = await effectSourcePeak(page, source.name);
	expect(inputPeak).toBeGreaterThan(.05);
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Take lanes and comps');
	const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	const lane = dialog.locator('.audio-editor-take-comp__lane').nth(group.laneOrder.indexOf(take.laneId));
	await lane.getByRole('button', { name: `Select ${source.name}`, exact: true }).click();
	await dialog.getByRole('button', { name: 'Promote for full group', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Take comp updated.');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const promoted = await persistedProject(page, id);
	await dialog.getByRole('button', { name: 'Flatten comp', exact: true }).click();
	await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const flattened = await persistedProject(page, id);
	const result = flattened.sources.find(item => item.name.includes('flattened take'));
	const resultPeak = await effectSourcePeak(page, result.name);
	console.log('Take flatten native PCM', { inputWidth: source.channelCount, outputWidth: result.channelCount, inputPeak, resultPeak });
	expect(resultPeak).toBeGreaterThan(.05);
	expect(result.channelCount).toBe(source.channelCount);
	expect(resultPeak).toBeCloseTo(inputPeak, 5);
	expect(result.frameCount).toBe(group.endSample - group.startSample);
	expect(flattened.clips.find(item => item.id === captured.clips[0].id)).toEqual(captured.clips[0]);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const undone = await persistedProject(page, id);
	expect(undone.takeGroups).toEqual(promoted.takeGroups);
	expect(undone.takeGroups[0].takes).toEqual(group.takes);
	expect(undone.takeGroups[0].compRegions).toHaveLength(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const redone = await persistedProject(page, id);
	expect(redone.takeGroups).toHaveLength(0);
	expect(redone.clips).toEqual(flattened.clips);
	expect(redone.sources.find(item => item.id === result.id)).toEqual(result);
});

async function capturedFrames(page) {
	return page.evaluate(async databaseName => {
		const database = await new Promise((resolve, reject) => { const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		try {
			const rows = await new Promise((resolve, reject) => { const request = database.transaction('analysis', 'readonly').objectStore('analysis').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			return Math.max(0, ...rows.filter(row => row.key?.startsWith('raw-pcm-spool-registry-v1:')).flatMap(row => row.value?.records ?? []).map(record => record.frameCount));
		} finally { database.close(); }
	}, SOUNDSCAPER_DATABASE_NAME);
}
