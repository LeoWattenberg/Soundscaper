/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, importFiles } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

// Unchanged established BWF MetaEdit production recording, named with the
// conventional BWF suffix; no container bytes or project state are installed.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64');
const aifc = Buffer.from(readFileSync(new URL('../fixtures/python-uncompressed.aif.base64', import.meta.url), 'utf8').trim(), 'base64');

for (const format of [
	{ extension: 'bwf', bytes: recording, mimeType: 'application/octet-stream' },
	{ extension: 'aifc', bytes: aifc, mimeType: 'audio/x-aiff' },
]) for (const desktop of [false, true]) {
	test(`File Import saves and reopens the same ordinary ${desktop ? 'native picker' : 'browser'} ${format.extension.toUpperCase()} recording`, async ({ page }) => {
		const name = `production-take.${format.extension}`;
		const native = desktop ? await installNativeCaptionSidecar(page, name, format.bytes) : null;
		try {
			const editor = await bootEditor(page, '/framescaper/en/');
			const projectId = await editor.getAttribute('data-project-id');
			if (native) await chooseFileAction(page, editor, 'Import');
			else await importFiles(editor, [{ name, mimeType: format.mimeType, buffer: format.bytes }]);
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(editor.getByRole('group', { name: new RegExp(`^production-take\\.${format.extension} clip,`, 'u') })).toBeVisible();
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await expect(editor.locator('[role="alert"]')).toHaveCount(0);
			if (native) await expect.poll(() => native.releases.length).toBe(1);
			await page.reload();
			await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(editor.getByRole('group', { name: new RegExp(`^production-take\\.${format.extension} clip,`, 'u') })).toBeVisible();
		} finally { await native?.close(); }
	});
}
