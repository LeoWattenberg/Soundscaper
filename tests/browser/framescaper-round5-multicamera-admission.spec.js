/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';

test('the multicamera creation menu refuses a native frame-count mismatch before submission', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const camera = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
	const other = videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1');
	expect(camera).toBeTruthy(); expect(other).toBeTruthy();
	await importFiles(editor, [{ ...camera.file, name: 'camera-a.mp4' }, { ...other.file, name: 'camera-b.mp4' }]);
	const clip = editor.locator('[data-clip-kind="video"]').first();
	await clip.focus(); await clip.press('Enter');
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	const tracks = page.getByRole('menu', { name: 'Tracks', exact: true });
	const multicamera = tracks.getByRole('menuitem', { name: /^Multicamera(?:\s|$)/u });
	await expect(multicamera).toBeDisabled();
});

test('same-clock multicamera creation and switching remain available', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await closeWorkspacePanel(editor, 'metadata');
	const camera = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
	const other = videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1');
	expect(camera).toBeTruthy(); expect(other).toBeTruthy();
	await importFiles(editor, [{ ...camera.file, name: 'camera-a.mp4' }, { ...other.file, name: 'camera-b.mp4' }]);
	const clip = editor.locator('[data-clip-kind="video"]').first();
	await clip.focus(); await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
	await expect(page.getByRole('alert').filter({ hasText: 'The action failed' })).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Remove multicamera group']);
	await expect(page.getByRole('alert').filter({ hasText: 'The action failed' })).toHaveCount(0);
});
