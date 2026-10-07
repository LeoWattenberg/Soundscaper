/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel,
	disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples) {
	const window = samples.slice(4_800, 14_400);
	return Math.sqrt(window.reduce((sum, value) => sum + value ** 2, 0) / window.length);
}

test('reopening an ordinary DAWproject retains its group bus and audible routed gain', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	let mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('combobox', { name: /^Output:/u }).nth(1).selectOption({ label: 'Group bus 1' });
	const bus = mixer.locator('.kw-audio-editor__mixer-channel--group');
	const fader = bus.getByRole('slider', { name: /volume$/u });
	for (let step = 0; step < 6; step += 1) await fader.press('ArrowDown');
	expect(Number(await fader.getAttribute('aria-valuenow'))).toBeLessThan(-6);
	await closeWorkspacePanel(editor, 'mixer');
	const before = await exportSamples(page, editor);
	expect(rms(before)).toBeGreaterThan(0.01);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	const bytes = await downloadBytes(download);
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	const after = await exportSamples(page, editor);
	expect(after.length).toBe(before.length);
	expect(rms(after) / rms(before)).toBeCloseTo(1, 3);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	mixer = editor.locator('[data-mixer-panel]');
	await expect(mixer.locator('.kw-audio-editor__mixer-channel--group')).toHaveCount(1);
	await expect(mixer.getByRole('combobox', { name: /^Output:/u }).last().locator('option:checked')).toHaveText('Group bus 1');
});
