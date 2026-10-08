/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel,
	disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../../src/common/editor/dawproject-xml.ts';

function rms(samples) {
	const window = samples.slice(4_800, 14_400);
	return Math.sqrt(window.reduce((sum, value) => sum + value ** 2, 0) / window.length);
}

for (const position of ['pre-fader', 'post-fader']) test(`DAWproject keeps an authored ${position} send and its audible level after reopening`, async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
	const track = mixer.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: monoTone.name.replace('.wav', '') });
	await track.getByRole('slider', { name: /volume$/u }).press('Home');
	await expect(track.getByRole('slider', { name: /volume$/u })).toHaveAttribute('aria-valuenow', '-60');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const sends = graph.locator('[data-routing-node^="mixer-node:"]');
	await expect(sends).toHaveCount(1);
	const sendId = (await sends.first().getAttribute('data-routing-node')).slice('mixer-node:'.length);
	const edges = graph.locator('[data-routing-edge]');
	const previousIds = new Set(await edges.evaluateAll(elements => elements.map(element => element.getAttribute('data-routing-edge'))));
	await graph.locator('[data-routing-source^="track:"]').last().press('Enter');
	await graph.locator(`[data-routing-destination="mixer-node:${sendId}"]`).press('Enter');
	await expect(edges).toHaveCount(previousIds.size + 1);
	const edgeId = (await edges.evaluateAll(elements => elements.map(element => element.getAttribute('data-routing-edge')))).find(id => !previousIds.has(id));
	await graph.locator(`[data-routing-edge="${edgeId}"]`).click();
	const inspector = graph.locator('[data-routing-inspector="edge"]');
	await inspector.locator('select[name="kind"]').selectOption('send');
	await inspector.locator('select[name="position"]').selectOption(position);
	await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
	await expect(graph.locator(`[data-routing-edge="${edgeId}"]`)).toHaveAttribute('aria-label', new RegExp(`send.*${position}`, 'u'));
	await closeWorkspacePanel(editor, 'mixer');
	const before = await exportSamples(page, editor);
	if (position === 'pre-fader') expect(rms(before)).toBeGreaterThan(0.1);
	else expect(rms(before)).toBeLessThan(0.001);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	const bytes = await downloadBytes(download);
	await test.info().attach('delivered.dawproject', { body: Buffer.from(bytes), contentType: 'application/zip' });
	const archive = await readDawprojectArchive(new Blob([bytes]));
	let deliveredTap;
	try {
		const deliveredSends = [...walkXml(parseXmlDocument(archive.projectXml))].filter(element => element.name === 'Send');
		expect(deliveredSends).toHaveLength(1);
		deliveredTap = deliveredSends[0].attributes.type;
	} finally { await archive.close(); }
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	const after = await exportSamples(page, editor);
	await test.info().attach('delivered-level.json', { body: JSON.stringify({ position, deliveredTap, beforeRms: rms(before), afterRms: rms(after) }), contentType: 'application/json' });
	expect(after.length).toBe(before.length);
	if (position === 'pre-fader') expect(rms(after) / rms(before)).toBeCloseTo(1, 3);
	else expect(rms(after)).toBeCloseTo(rms(before), 5);
	expect(deliveredTap).toBe(position === 'pre-fader' ? 'pre' : 'post');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	await expect(graph.getByRole('button', { name: new RegExp(`send connection.*${position}`, 'u') })).toHaveCount(1);
});
