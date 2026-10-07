/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../../src/common/editor/dawproject-xml.ts';

test('DAWproject preserves an ordinary group bus routed through another group', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	const groups = graph.locator('[data-routing-node^="mixer-node:"]');
	await expect(groups).toHaveCount(2);
	const secondId = (await groups.last().getAttribute('data-routing-node')).slice('mixer-node:'.length);
	await graph.getByRole('button', { name: /^assignment connection from Group: Group bus 1 to Master,/u }).click();
	const inspector = graph.getByRole('complementary', { name: 'Connection inspector', exact: true });
	await inspector.locator('select[name="destination"]').selectOption(JSON.stringify({ kind: 'mixer-node', id: secondId }));
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection rewired');
	await expect(graph.getByRole('button', { name: /^assignment connection from Group: Group bus 1 to Group: Group bus 2,/u })).toBeVisible();
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const archive = await readDawprojectArchive(new Blob([await downloadBytes(await downloading)]));
	try {
		const tracks = [...walkXml(parseXmlDocument(archive.projectXml))].filter(element => element.name === 'Track');
		const first = tracks.find(element => element.attributes.name === 'Group bus 1')?.children.find(element => element.name === 'Channel');
		const second = tracks.find(element => element.attributes.name === 'Group bus 2')?.children.find(element => element.name === 'Channel');
		expect(first).toBeTruthy();
		expect(second).toBeTruthy();
		expect(first.attributes.destination).toBe(second.attributes.id);
	} finally { await archive.close(); }
});
