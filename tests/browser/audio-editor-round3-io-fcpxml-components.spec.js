/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

for (const removeAudio of [false, true]) {
	test(`FCPXML ${removeAudio ? 'does not restore removed' : 'does not duplicate retained'} camera audio`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('camera.webm')]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		if (removeAudio) {
			await editor.getByRole('group', { name: /^Video clip:/u }).first().press('Enter');
			await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
			const audio = editor.getByRole('group', { name: /^camera Audio clip,/u });
			await audio.press('Enter');
			await audio.press('Delete');
			await expect(audio).toHaveCount(0);
		}
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export FCPXML']);
		const text = new TextDecoder().decode(await downloadBytes(await downloading));
		const components = await page.evaluate(xml => {
			const document = new DOMParser().parseFromString(xml, 'application/xml');
			const assets = new Map(Array.from(document.querySelectorAll('asset'), asset => [asset.id, asset]));
			return Array.from(document.querySelectorAll('asset-clip'), clip => {
				const asset = assets.get(clip.getAttribute('ref'));
				const enabled = clip.getAttribute('srcEnable') || 'all';
				return { video: asset.getAttribute('hasVideo') === '1' && enabled !== 'audio',
					audio: asset.getAttribute('hasAudio') === '1' && enabled !== 'video' };
			});
		}, text);
		expect(components.filter(component => component.video)).toHaveLength(1);
		expect(components.filter(component => component.audio)).toHaveLength(removeAudio ? 0 : 1);
	});
}
