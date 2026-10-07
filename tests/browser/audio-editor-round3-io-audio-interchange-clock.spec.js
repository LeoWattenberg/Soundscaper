/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';

for (const format of ['FCPXML', 'OpenTimelineIO']) {
	test(`${format} retains the half-second source trim of an ordinary 32 kHz WAV`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'native-rate.wav', frequency: 440,
			duration: 1, sampleRate: 32_000, channelCount: 1 })]);
		const clip = clipByName(editor, 'native-rate.wav');
		for (let step = 0; step < 5; step += 1) await clip.press('Control+Shift+ArrowRight');
		await expect(clip).toHaveAccessibleName(/starts at 0\.5 seconds, 0\.5 seconds long/u);
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', `Export ${format}`]);
		const text = new TextDecoder().decode(await downloadBytes(await downloading));
		if (format === 'FCPXML') {
			expect(/<asset-clip[^>]*\bstart="([^"]+)"/u.exec(text)?.[1]).toBe('1/2s');
		} else {
			const timeline = JSON.parse(text);
			const audio = timeline.tracks.children.find(track => track.kind === 'Audio' && track.children.some(child => child.OTIO_SCHEMA === 'Clip.1'));
			const delivered = audio.children.find(child => child.OTIO_SCHEMA === 'Clip.1');
			expect(delivered.source_range.start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', value: 24_000, rate: 48_000 });
		}
	});
}
