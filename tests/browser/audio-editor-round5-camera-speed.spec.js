/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipField, closeClipProperties,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('linked camera speed refuses clearly until ordinary Unlink, then changes audio with one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('speed-camera.webm')]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	const audio = editor.getByRole('group', { name: /^speed-camera Audio clip,/u });
	const properties = await openClipProperties(page, editor, audio);
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	const originalDuration = Number(await clipField(properties, 'durationFrame').inputValue());
	const speed = properties.locator('[data-clip-field="speedRatio"] input');
	const video = editor.locator('[data-clip-kind="video"]');
	const originalVideoStyle = await video.getAttribute('style');
	await speed.fill('2');
	await speed.press('Enter');
	await expect(properties.getByRole('alert')).toContainText('Unlink audio');
	await expect(speed).toHaveValue('1');
	await expect(clipField(properties, 'durationFrame')).toHaveValue(String(originalDuration));
	await expect(video).toHaveAttribute('style', originalVideoStyle);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await closeClipProperties(properties);
	await audio.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
	const unlinked = await openClipProperties(page, editor, audio);
	await unlinked.getByText('Pitch and tempo', { exact: true }).click();
	const unlinkedSpeed = unlinked.locator('[data-clip-field="speedRatio"] input');
	await unlinkedSpeed.fill('2'); await unlinkedSpeed.press('Enter');
	await expect(unlinkedSpeed).toHaveValue('2');
	await expect(clipField(unlinked, 'durationFrame')).toHaveValue(String(Math.round(originalDuration / 2)));
	await expect(unlinked.getByRole('alert')).toHaveCount(0);
	await expect(video).toHaveAttribute('style', originalVideoStyle);
	await closeClipProperties(unlinked);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, audio);
	await expect(clipField(restored, 'durationFrame')).toHaveValue(String(originalDuration));
	await closeClipProperties(restored);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await openClipProperties(page, editor, audio);
	await expect(clipField(redone, 'durationFrame')).toHaveValue(String(Math.round(originalDuration / 2)));
	await expect(video).toHaveAttribute('style', originalVideoStyle);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
