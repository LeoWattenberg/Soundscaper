/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, clipByName, closeWorkspacePanel,
	disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples) {
	const middle = samples.slice(4_800, 14_400);
	return Math.sqrt(middle.reduce((sum, sample) => sum + sample * sample, 0) / middle.length);
}

test('DAWproject discloses the authored assignment level omitted from its delivered routing', async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const trackId = await clipByName(editor, monoTone.name).evaluate(clip => clip.closest('[data-track-id]')?.getAttribute('data-track-id'));
	expect(trackId).toBeTruthy();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('combobox', { name: 'Output: browser-mono-tone', exact: true })
		.selectOption({ label: 'Group bus 1' });
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const bus = await graph.locator('[data-routing-node^="mixer-node:"]').getAttribute('data-routing-node');
	expect(bus).toBeTruthy();
	await graph.locator(`[data-routing-edge="assignment:${bus}:master"]`).click();
	const inspector = graph.locator('[data-routing-inspector="edge"]');
	await inspector.locator('input[name="levelDb"]').fill('-12');
	await inspector.locator('input[name="levelDb"]').press('Tab');
	await expect(inspector.locator('input[name="levelDb"]')).toHaveValue('-12');
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	await expect(inspector).toContainText('-12 dB');
	await closeWorkspacePanel(editor, 'mixer');
	const before = await exportSamples(page, editor);
	expect(rms(before)).toBeGreaterThan(0.04);
	expect(rms(before)).toBeLessThan(0.05);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	const warning = report.locator('[data-severity="warning"]');
	await expect(warning).toContainText('Group bus 1 → Master');
	await expect(warning).toContainText('−12 dB');
	await expect(warning).toContainText('unity');
	await report.getByRole('button', { name: 'Close', exact: true }).click();
	const download = await downloading;
	const bytes = await downloadBytes(download);
	await testInfo.attach('delivered.dawproject', { body: Buffer.from(bytes), contentType: 'application/zip' });
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	const after = await exportSamples(page, editor);
	await testInfo.attach('delivered-level.json', { body: JSON.stringify({ before: rms(before), after: rms(after) }), contentType: 'application/json' });
	expect(after.length).toBe(before.length);
	expect(rms(after) / rms(before)).toBeCloseTo(10 ** (12 / 20), 3);
});
