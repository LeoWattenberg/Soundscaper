/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportVideoCaptionTrackV1, importVideoCaptionTrackV1 } from '../../src/common/editor/video-caption-track-v27.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

const track = importVideoCaptionTrackV1('1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n\n', {
	format: 'srt', sampleRate: 48_000, trackId: 'captions', sequenceId: 'main',
	trackName: 'Dialogue', language: 'en',
}).track;
const text = exportVideoCaptionTrackV1(track, { format: 'imsc1.1', sampleRate: 48_000 }).text;

for (const desktop of [false, true]) {
	test(`Caption Tracks imports its own ordinary IMSC export through the ${desktop ? 'native picker' : 'browser'}`, async ({ page }) => {
		const native = desktop ? await installNativeCaptionSidecar(page, 'dialogue.ttml', text) : null;
		try {
			const editor = await bootEditor(page, '/framescaper/en/');
			await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
			const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
			if (native) await dialog.getByRole('button', { name: 'Choose sidecar file', exact: true }).click();
			else await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
				name: 'dialogue.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(text),
			});
			await expect(dialog.getByRole('status')).toContainText('dialogue.ttml:');
			const document = JSON.parse(await dialog.getByRole('textbox', {
				name: 'Canonical finishing document', exact: true,
			}).inputValue());
			expect(document[0].cues[0].text).toBe('A normal caption');
			if (native) expect(native.releases).toHaveLength(1);
		} finally { await native?.close(); }
	});
}
