/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles, registerAudioEditorHooks, showToolbarButton,
	openClipProperties, clipField, closeClipProperties,
} from './audio-editor-test-helpers.js';

test.describe('ordinary editing regression workflows', () => {
	registerAudioEditorHooks();

	test('Paste puts copied audio on the selected destination track', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const original = clipByName(editor, toneA.name);
		const originalTrackId = await original.locator('xpath=ancestor::div[@data-track-row][1]').getAttribute('data-track-id');
		const destination = clipByName(editor, toneB.name).locator('xpath=ancestor::div[@data-track-row][1]');
		await original.locator('.clip-header').click();
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await clipByName(editor, toneB.name).locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(destination.locator('[data-clip-id]')).toHaveCount(2);
		await expect(editor.locator(`[data-track-row][data-track-id="${originalTrackId}"] [data-clip-id]`)).toHaveCount(1);
	});

	test('Jump to project end seeks to the last audio frame', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
		await expect(editor.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuenow', '38400');
	});

	test('per-track ripple closes overlapping selected clips once', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await clipByName(editor, monoTone.name).locator('.clip-header').click();
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		const clips = clipByName(editor, monoTone.name);
		await expect(clips).toHaveCount(3);
		const ids = await clips.evaluateAll((items) => items.map((item) => item.getAttribute('data-clip-id')));
		const clipAt = (index) => editor.locator(`[data-clip-id="${ids[index]}"]`);
		for (const [index, frame] of [[1, '24000'], [2, '96000']]) {
			const properties = await openClipProperties(page, editor, clipAt(index));
			await properties.getByText('Media settings', { exact: true }).click();
			await clipField(properties, 'startFrame').fill(frame);
			await clipField(properties, 'startFrame').press('Tab');
			await closeClipProperties(properties);
		}
		await clipAt(0).press('Enter');
		await clipAt(1).press('Shift+Enter');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and close gap per track']);
		await expect(clips).toHaveCount(1);
		const properties = await openClipProperties(page, editor, clips);
		await properties.getByText('Media settings', { exact: true }).click();
		await expect(clipField(properties, 'startFrame')).toHaveValue('33600');
	});

	test('copy and paste retain loop repetitions', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await clip.locator('.clip-header').click();
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		await expect(editor.locator('[data-clip-id]')).toHaveCount(2);
		await expect(editor.locator('[data-loop-boundary-frame]')).toHaveCount(2);
	});

	test('split clips at silences cuts every repeated silent interval', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: 'tone-with-pause.wav', frequency: 440, channelCount: 1 });
		recording.buffer.fill(0, 44 + 9_600 * 2, 44 + 14_400 * 2);
		await importFiles(editor, [recording]);
		const clip = clipByName(editor, recording.name);
		await clip.locator('.clip-header').click();
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split clips at silences']);
		await expect(editor.locator('[data-clip-id]')).toHaveCount(3);
	});

	test('Select all tracks preserves an exact range when Snap is enabled', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const timecodes = editor.locator('[data-selection-toolbar] .timecode');
		const before = await timecodes.allTextContents();
		await showToolbarButton(page, editor, 'Snap');
		await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
		await expect.poll(() => timecodes.allTextContents()).toEqual(before);
	});

	test('Track start to end uses the clip bounds with Snap enabled', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		const timecodes = editor.locator('[data-selection-toolbar] .timecode');
		const before = await timecodes.allTextContents();
		await showToolbarButton(page, editor, 'Snap');
		await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
		await expect.poll(() => timecodes.allTextContents()).toEqual(before);
	});

	test('keyboard track moves preserve the existing clip position with Snap enabled', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const moving = clipByName(editor, toneA.name);
		await moving.locator('.clip-header').click();
		await moving.press('Control+ArrowRight');
		const before = await moving.boundingBox();
		expect(before).not.toBeNull();
		await showToolbarButton(page, editor, 'Snap');
		await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
		await moving.press('Control+ArrowDown');
		const target = clipByName(editor, toneB.name).locator('xpath=ancestor::div[@data-track-row][1]');
		await expect(target.locator('[data-clip-id]')).toHaveCount(2);
		await expect.poll(async () => (await moving.boundingBox()).x).toBeCloseTo(before.x, 1);
	});

	test('trim outside selected clips keeps independent ranges on each selected track', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await clipByName(editor, toneA.name).locator('.clip-header').click();
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
		const copies = clipByName(editor, toneA.name);
		await expect(copies).toHaveCount(2);
		for (const clip of [copies.nth(1), clipByName(editor, toneB.name)]) {
			const properties = await openClipProperties(page, editor, clip);
			await properties.getByText('Media settings', { exact: true }).click();
			await clipField(properties, 'startFrame').fill('96000');
			await clipField(properties, 'startFrame').press('Tab');
			await closeClipProperties(properties);
		}
		await copies.first().locator('.clip-header').click();
		await clipByName(editor, toneB.name).locator('.clip-header').click({ modifiers: ['Shift'] });
		await chooseNestedCommandAction(page, editor, 'Edit', ['Remove special', 'Trim audio outside selection']);
		await expect(copies).toHaveCount(1);
		await expect(clipByName(editor, toneB.name)).toHaveCount(1);
	});

		test('No tracks prevents Delete from acting on the whole project', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete']);
		await expect(editor.locator('[data-clip-id]')).toHaveCount(2);
	});

	test('clip peak normalization reads an ordinary imported recording', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
		await properties.getByText('Normalize', { exact: true }).click();
		await properties.getByRole('button', { name: 'Normalize to −1 dBFS', exact: true }).click();
		await expect(clipField(properties, 'gain')).toHaveValue('8.12');
	});
});
