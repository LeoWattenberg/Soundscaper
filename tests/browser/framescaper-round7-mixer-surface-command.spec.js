/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel,
	collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

for (const kind of ['group', 'send']) {
	test(`native Framescaper Mixer retains an ordinary ${kind} bus and its edits`, async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await closeWorkspacePanel(editor, 'video-preview');
		await closeWorkspacePanel(editor, 'source-monitor');
		await importFiles(editor, [createWavFixture({ name: 'Mixer recording.wav', duration: .5,
			frequency: 440, channelCount: 2 })]);
		await chooseCommandAction(page, editor, 'Window', 'Mixer');
		const mixer = editor.locator('[data-mixer-panel]');
		const track = mixer.locator('.kw-audio-editor__mixer-channel--track')
			.filter({ hasText: 'Mixer recording' });
		const trackMute = track.getByRole('button', { name: 'Mute', exact: true });
		await expect(trackMute).toHaveAttribute('aria-pressed', 'false');
		await trackMute.click();
		await expect(trackMute).toHaveAttribute('aria-pressed', 'true');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(trackMute).toHaveAttribute('aria-pressed', 'false');
		const buses = mixer.locator(`.kw-audio-editor__mixer-channel--${kind}`);
		await expect(buses).toHaveCount(0);
		await mixer.getByRole('button', { name: `Add ${kind} bus`, exact: true }).click();
		await expect(buses).toHaveCount(1);
		const busMute = buses.getByRole('button', { name: 'Mute', exact: true });
		await busMute.click();
		await expect(busMute).toHaveAttribute('aria-pressed', 'true');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(busMute).toHaveAttribute('aria-pressed', 'false');
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(buses).toHaveCount(0);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(buses).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(busMute).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.getByRole('alert')).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
