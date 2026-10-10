/* SPDX-License-Identifier: AGPL-3.0-only */

import { open } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

for (const changed of [false, true]) test(`a pending native caption import ${changed ? 'cannot publish in the newly opened project' : 'publishes in its original project'}`, async ({ page }) => {
	const reading = Promise.withResolvers();
	let readStarted = false;
	const native = await installNativeCaptionSidecar(page, 'dialogue.srt',
		'1\n00:00:00,100 --> 00:00:00,500\nOriginal dialogue\n\n', {
			async openSelectedFile(...args) {
				readStarted = true;
				await reading.promise;
				return open(...args);
			},
		});
	try {
		const editor = await bootEditor(page, '/framescaper/en/');
		const originalId = await editor.getAttribute('data-project-id');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		let dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		await dialog.getByRole('button', { name: 'Choose sidecar file', exact: true }).click();
		await expect.poll(() => readStarted).toBe(true);
		await expect(dialog.getByRole('button', { name: 'Choose sidecar file', exact: true })).toBeDisabled();
		if (changed) {
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await editor.getByRole('button', { name: 'New project', exact: true }).click();
			await expect(editor).not.toHaveAttribute('data-project-id', originalId);
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
			dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
			await expect(dialog.getByRole('button', { name: 'Choose sidecar file', exact: true })).toBeEnabled();
		}
		reading.resolve();
		await expect.poll(() => native.releases.length).toBe(1);
		if (!changed) await expect(dialog.getByRole('status')).toHaveText('dialogue.srt: No interchange losses.');
		if (changed) {
			// A positive normal import fences the observer after completed document
			// publication, rather than treating an initially empty draft as proof.
			await dialog.getByRole('textbox', { name: 'Track ID', exact: true }).fill('new-captions');
			await dialog.getByRole('textbox', { name: 'Sidecar text', exact: true }).fill(
				'1\n00:00:00,100 --> 00:00:00,500\nNew dialogue\n\n');
			await dialog.getByRole('button', { name: 'Import sidecar text', exact: true }).click();
			await expect(dialog.getByRole('status')).toHaveText('No interchange losses.');
		}
		await expect.poll(async () => JSON.parse(await dialog.getByRole('textbox', {
			name: 'Canonical finishing document', exact: true,
		}).inputValue())).toHaveLength(1);
		if (changed) {
			const tracks = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
			expect(tracks[0].id).toBe('new-captions');
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
			dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
			expect(JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue())).toHaveLength(0);
		}
	} finally {
		reading.resolve();
		await native.close();
	}
});
