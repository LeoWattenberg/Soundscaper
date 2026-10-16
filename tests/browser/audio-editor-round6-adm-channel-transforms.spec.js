/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, clipByName, closeDialog,
	closeWorkspacePanel, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('stereo Split keeps the authored left and right ADM channels deliverable', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await disableNewClipFades(page, editor);
	await importFiles(editor, [toneA]);
	const track = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	const original = await exportBw64(page, editor);
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	assertSamePcm(await exportBw64(page, editor), original);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	assertSamePcm(await exportBw64(page, editor), original);
});

test('Make stereo keeps both authored mono ADM channels deliverable', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	await disableNewClipFades(page, editor);
	const left = createWavFixture({ name: 'round6-adm-left.wav', frequency: 440, duration: .8, channelCount: 1 });
	const right = createWavFixture({ name: 'round6-adm-right.wav', frequency: 660, duration: .8, channelCount: 1 });
	await importFiles(editor, [left, right]);
	const track = clipByName(editor, left.name).locator('xpath=ancestor::div[@data-track-row]');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await metadata.getByRole('combobox', { name: /round6-adm-right.*channel 1/u }).selectOption('R');
	await closeWorkspacePanel(editor, 'metadata');
	const original = await exportBw64(page, editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const before = await persistedProject(page, projectId);
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Make stereo track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await expect.poll(async () => (await persistedProject(page, projectId)).clips.length).toBe(1);
	const after = await persistedProject(page, projectId);
	const mergedTrack = after.tracks.find(candidate => candidate.clipIds.includes(after.clips[0].id));
	expect(mergedTrack).toBeTruthy();
	const rightTrack = before.tracks.find(candidate => candidate.name === 'round6-adm-right');
	expect(rightTrack).toBeTruthy();
	const originalRight = before.metadata.adm.bed.assignments.find(assignment => assignment.stripId === rightTrack.id);
	expect(after.metadata.adm.bed.assignments.find(assignment => assignment.stripId === mergedTrack.id && assignment.bedChannel === 'R'))
		.toEqual({ ...originalRight, stripId: mergedTrack.id, sourceChannel: 1 });
	console.log('ADM Make stereo delivered references', { before: before.metadata.adm.bed.assignments,
		after: after.metadata.adm.bed.assignments });
	assertSamePcm(await exportBw64(page, editor), original);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	assertSamePcm(await exportBw64(page, editor), original);
});

async function exportBw64(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	const link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('BW64');
	await closeDialog(dialog);
	return bytes;
}

async function disableNewClipFades(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
}

function assertSamePcm(left, right) {
	const pcm = bytes => {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let dataSize, channels, bits, format;
		for (let offset = 12; offset + 8 <= bytes.length;) {
			const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
			const size = view.getUint32(offset + 4, true);
			if (id === 'ds64') dataSize = Number(view.getBigUint64(offset + 16, true));
			if (id === 'fmt ') {
				format = view.getUint16(offset + 8, true);
				if (format === 0xfffe) format = view.getUint16(offset + 32, true);
				channels = view.getUint16(offset + 10, true);
				bits = view.getUint16(offset + 22, true);
			}
			if (id === 'data') {
				expect([1, 3]).toContain(format);
				expect([16, 24, 32]).toContain(bits);
				const data = Buffer.from(bytes.subarray(offset + 8, offset + 8 + (size === 0xffffffff ? dataSize : size)));
				const samples = Array.from({ length: data.length / (bits / 8) }, (_, index) =>
					format === 3 ? data.readFloatLE(index * 4) : data.readIntLE(index * (bits / 8), bits / 8) / (2 ** (bits - 1)));
				return { samples, channels };
			}
			offset += 8 + size + (size % 2);
		}
		throw new Error('Delivered BW64 has no PCM data chunk.');
	};
	const a = pcm(left), b = pcm(right);
	expect(a.channels).toBe(b.channels);
	expect(a.samples.length).toBe(b.samples.length);
	const energy = value => Array.from({ length: value.channels }, (_, channel) => {
		let total = 0;
		for (let index = channel; index < value.samples.length; index += value.channels) total += value.samples[index] ** 2;
		return Math.sqrt(total / (value.samples.length / value.channels));
	});
	const originalLevels = energy(b), changedLevels = energy(a);
	for (const level of originalLevels) expect(level).toBeGreaterThan(.1);
	let difference = 0;
	for (let index = 0; index < b.samples.length; index++) difference = Math.max(difference, Math.abs(a.samples[index] - b.samples[index]));
	console.log('ADM transformed PCM', { originalLevels, changedLevels, difference });
	expect(difference).toBeLessThan(1e-5);
}
