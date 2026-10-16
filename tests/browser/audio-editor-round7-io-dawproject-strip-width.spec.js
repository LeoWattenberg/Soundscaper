/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync } from 'fflate';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker,
	downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { parseXmlDocument, walkXml } from '../../src/common/editor/dawproject-xml.ts';

for (const channels of [2, 1]) test(`own DAWproject export and Open retain an authored ${channels}-channel group bus`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	let graph = mixer.locator('[data-soundscaper-routing-graph]');
	const group = graph.locator('[data-routing-node^="mixer-node:"]');
	await expect(group).toHaveCount(1);
	await expect(group.locator('.kw-routing-graph__node-main')).toHaveAttribute('aria-pressed', 'true');
	let inspector = graph.getByRole('complementary', { name: 'Routing inspector', exact: true });
	await inspector.locator('input[name="channelCount"]').fill(String(channels));
	await inspector.getByRole('button', { name: 'Save node', exact: true }).click();
	await expect(inspector.locator('input[name="channelCount"]')).toHaveValue(String(channels));
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const authored = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(authored.mixer.groups[0].channelCount).toBe(channels);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const projectXml = new TextDecoder().decode(unzipSync(bytes)['project.xml']);
	const exportedGroup = [...walkXml(parseXmlDocument(projectXml))]
		.find(element => element.name === 'Track' && element.attributes.name === 'Group bus 1');
	expect(exportedGroup?.children.find(element => element.name === 'Channel')?.attributes.audioChannels).toBe(String(channels));
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	if (!await mixer.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	if (!await mixer.locator('[data-soundscaper-routing-graph]').isVisible()) {
		await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	}
	graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.locator('[data-routing-node^="mixer-node:"] .kw-routing-graph__node-main').press('Enter');
	inspector = graph.getByRole('complementary', { name: 'Routing inspector', exact: true });
	await expect(inspector.locator('input[name="channelCount"]')).toHaveValue(String(channels));
});
