/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel,
	collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('Freeze captures the ordinary switched multicamera programme picture', async ({ page }) => {
	test.setTimeout(90_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Exact composited Freeze requires WebGL2.');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Freeze requires IndexedDB Blob storage.');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const properties = editor.locator('[data-workspace-panel="metadata"]');
	await properties.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await properties.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await closeWorkspacePanel(editor, 'metadata');
	const media = [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1'),
		videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1')];
	for (const [index, fixture] of media.entries()) await importFiles(editor, [{
		name: `camera-${index ? 'b' : 'a'}.mp4`, mimeType: fixture.file.mimeType, buffer: Buffer.from(fixture.file.buffer),
	}]);
	await editor.getByRole('button', { name: 'Hide video', exact: true }).last().click();
	const camera = editor.getByRole('group', { name: 'Video clip: camera-a', exact: true });
	await camera.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:10');
	const freeze = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Freeze Video']);
		const dialog = page.getByRole('dialog', { name: 'Freeze Selected Video', exact: true });
		await dialog.locator('[data-framescaper-authoring-freeze]').click();
		await expect(dialog.getByRole('status')).toHaveText('Exact playhead freeze created.', { timeout: 15_000 });
		await dialog.press('Escape');
		return dialog;
	};
	await freeze();
	await expect(editor.getByRole('group', { name: 'Video clip: camera-a.mp4 Freeze', exact: true })).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.getByRole('group', { name: 'Video clip: camera-a.mp4 Freeze', exact: true })).toHaveCount(0);
	await camera.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await expect(editor.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'ready');
	await freeze();
	await expect(editor.getByRole('group', { name: 'Video clip: camera-b.mp4 Freeze', exact: true })).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.getByRole('group', { name: 'Video clip: camera-b.mp4 Freeze', exact: true })).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.getByRole('group', { name: 'Video clip: camera-b.mp4 Freeze', exact: true })).toHaveCount(1);
	expect(errors).toEqual([]);
});
