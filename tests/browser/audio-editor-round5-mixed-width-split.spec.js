/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, clipField, closeClipProperties,
	commitInput, disableNativeSavePicker, importFiles, openClipProperties,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const stereo = createWavFixture({ name: 'mixed-width-stereo.wav', frequency: 330 });
const mono = createWavFixture({ name: 'mixed-width-mono.wav', frequency: 440, channelCount: 1 });
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test('splitting a mixed mono and stereo track preserves each recording level', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [stereo, mono]);
	const source = clipByName(editor, mono.name);
	const destination = clipByName(editor, stereo.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const destinationId = await destination.getAttribute('data-track-id');
	const properties = await openClipProperties(page, editor, source);
	await properties.getByText('Media settings', { exact: true }).click();
	await commitInput(clipField(properties, 'startFrame'), '48000');
	await closeClipProperties(properties);
	const clipBox = await source.boundingBox(), trackBox = await destination.boundingBox();
	expect(clipBox).not.toBeNull(); expect(trackBox).not.toBeNull();
	await page.keyboard.down('Control');
	await page.mouse.move(clipBox.x + 32, clipBox.y + 10);
	await page.mouse.down();
	await page.mouse.move(clipBox.x + 32, trackBox.y + 60, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up('Control');
	await expect(source.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', destinationId);
	const before = await exportSamples(page, editor);
	await chooseTrackMenuAction(page, editor, destination, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	const after = await exportSamples(page, editor);
	expect(rms(after.slice(55_200, 64_800))).toBeCloseTo(rms(before.slice(55_200, 64_800)), 4);
	expect(rms(after.slice(7_200, 16_800))).toBeCloseTo(rms(before.slice(7_200, 16_800)), 4);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	expect(rms((await exportSamples(page, editor)).slice(55_200, 64_800))).toBeCloseTo(rms(before.slice(55_200, 64_800)), 4);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	expect(rms((await exportSamples(page, editor)).slice(55_200, 64_800))).toBeCloseTo(rms(before.slice(55_200, 64_800)), 4);
});
