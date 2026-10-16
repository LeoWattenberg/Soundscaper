/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel,
	disableNativeSavePicker, downloadBytes, importFiles, openExportDialog } from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../../src/common/editor/dawproject-xml.ts';

test.use({ browserCoverage: false });

async function samples(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent('download'); await link.click();
	const download = await downloading;
	const bytes = await downloadBytes(download); await download.delete();
	const result = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try { return Array.from((await context.decodeAudioData(new Uint8Array(data).buffer)).getChannelData(0)); }
		finally { await context.close(); }
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return result;
}
function rms(values) {
	const window = values.slice(4_800, 14_400);
	return Math.sqrt(window.reduce((sum, value) => sum + value ** 2, 0) / window.length);
}

for (const routed of [false, true]) test(`own DAWproject preserves the ${routed ? 'audible downstream group assignment' : 'healthy direct master assignment'} on reopening`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	let mixer = editor.locator('[data-mixer-panel]');
	for (let bus = 0; bus < 2; bus++) await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('combobox', { name: /^Output:/u }).nth(1).selectOption({ label: 'Group bus 1' });
	const fader = mixer.locator('.kw-audio-editor__mixer-channel--group').last().getByRole('slider', { name: /volume$/u });
	for (let step = 0; step < 6; step++) await fader.press('ArrowDown');
	expect(Number(await fader.getAttribute('aria-valuenow'))).toBeLessThan(-6);
	await closeWorkspacePanel(editor, 'mixer');
	const direct = await samples(page, editor); expect(rms(direct)).toBeGreaterThan(.01);
	if (routed) {
		await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']); mixer = editor.locator('[data-mixer-panel]');
		await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
		const graph = mixer.locator('[data-soundscaper-routing-graph]');
		const secondId = (await graph.locator('[data-routing-node^="mixer-node:"]').last().getAttribute('data-routing-node')).slice('mixer-node:'.length);
		await graph.getByRole('button', { name: /^assignment connection from Group: Group bus 1 to Master,/u }).click();
		const inspector = graph.getByRole('complementary', { name: 'Connection inspector', exact: true });
		await inspector.locator('select[name="destination"]').selectOption(JSON.stringify({ kind: 'mixer-node', id: secondId }));
		await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
		await expect(graph.getByRole('button', { name: /^assignment connection from Group: Group bus 1 to Group: Group bus 2,/u })).toBeVisible();
		await closeWorkspacePanel(editor, 'mixer');
	}
	const before = routed ? await samples(page, editor) : direct;
	if (routed) expect(rms(before) / rms(direct)).toBeLessThan(.5);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading; const name = download.suggestedFilename();
	const bytes = await downloadBytes(download); await download.delete();
	const archive = await readDawprojectArchive(new Blob([bytes]));
	try {
		const tracks = [...walkXml(parseXmlDocument(archive.projectXml))].filter(element => element.name === 'Track');
		const first = tracks.find(element => element.attributes.name === 'Group bus 1').children.find(element => element.name === 'Channel');
		const destination = tracks.find(element => element.attributes.name === (routed ? 'Group bus 2' : 'Master')).children.find(element => element.name === 'Channel');
		expect(first.attributes.destination).toBe(destination.attributes.id);
	} finally { await archive.close(); }
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	const after = await samples(page, editor);
	expect(after.length).toBe(before.length); expect(rms(after) / rms(before)).toBeCloseTo(1, 3);
});
