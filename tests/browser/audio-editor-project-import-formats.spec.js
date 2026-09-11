/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseFileAction, chooseNestedCommandAction, collectClientErrors,
	registerAudioEditorHooks, trackNameText, waitForEditor,
} from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

async function assertRestoredAudio(page, editor, trackName) {
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(trackNameText(editor).first()).toHaveText(trackName);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	const restored = await waitForEditor(page);
	await expect(restored).toHaveAttribute('data-clip-count', '1');
	await expect(trackNameText(restored).first()).toHaveText(trackName);
	await restored.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(restored.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await restored.getByRole('button', { name: 'Stop', exact: true }).click();
}

test.describe('project import formats', () => {
	registerAudioEditorHooks();

	test('opens DAWproject with embedded audio through File and preserves it after reload', async ({ page }) => {
		const audio = createWavFixture({ name: 'take.wav', frequency: 440, duration: 1 });
		const archive = await writeDawprojectArchive({
			projectXml: `<Project version="1.0"><Application name="Browser fixture" version="1"/>
			<Transport><Tempo unit="bpm" value="90" id="tempo"/><TimeSignature numerator="4" denominator="4" id="sig"/></Transport>
			<Structure><Track contentType="audio" id="t1" name="Imported guitar"><Channel role="regular" destination="m" id="c1"/></Track>
			<Track contentType="audio" id="mt" name="Master"><Channel role="master" id="m"/></Track></Structure>
			<Arrangement id="arr"><Lanes timeUnit="seconds" id="l0"><Lanes track="t1" id="l1"><Clips id="cl">
			<Clip time="0" duration="1" playStart="0" name="Take"><Audio channels="2" duration="1" sampleRate="48000" id="a1"><File path="audio/take.wav"/></Audio></Clip>
			</Clips></Lanes></Lanes></Arrangement></Project>`,
			metadataXml: '<MetaData><Title>Imported session</Title></MetaData>',
			files: [{ path: 'audio/take.wav', blob: new Blob([audio.buffer], { type: 'audio/wav' }) }],
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({ name: 'session.dawproject', mimeType: 'application/zip',
			buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
		await chooseFileAction(page, editor, 'Delivery Report');
		const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report).toBeVisible();
		await expect(report).toContainText('DAWproject');
		await report.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/ }).click();
		await expect(report).toBeHidden();
		await assertRestoredAudio(page, editor, 'Imported guitar');
		expect(errors).toEqual([]);
	});

	test('opens a legacy AUP and its data directory through both file pickers', async ({ page }, testInfo) => {
		const folder = testInfo.outputPath('Legacy_data');
		const nested = join(folder, 'e00', 'd00');
		await mkdir(nested, { recursive: true });
		const frames = 48000;
		const block = Buffer.alloc(24 + frames * 4);
		for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, 48000, 1].entries()) {
			block.writeUInt32BE(value, index * 4);
		}
		for (let frame = 0; frame < frames; frame++) block.writeFloatBE(Math.sin(frame * 2 * Math.PI * 330 / 48000) * 0.3, 24 + frame * 4);
		await writeFile(join(nested, 'e0000.au'), block);
		const xml = `<project rate="48000" projname="Legacy.aup" sel0="0" sel1="1">
		<wavetrack name="Legacy voice" channel="2" rate="48000"><waveclip offset="0">
		<sequence numsamples="48000"><waveblock start="0"><simpleblockfile filename="e0000.au" len="48000"/></waveblock></sequence>
		</waveclip></wavetrack></project>`;
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const projectChooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'File', ['Audacity projects', 'Open legacy Audacity project (.aup + _data)']);
		const dataChooser = page.waitForEvent('filechooser');
		await (await projectChooser).setFiles({ name: 'Legacy.aup', mimeType: 'application/xml', buffer: Buffer.from(xml) });
		await (await dataChooser).setFiles(folder);
		await assertRestoredAudio(page, editor, 'Legacy voice');
		expect(errors).toEqual([]);
	});
});
