/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';

test('removing an inactive camera from Project bin preserves its editable multicamera angle', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await closeWorkspacePanel(editor, 'metadata');
	const media = [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1'),
		videoSourceGeometryMedia.find(({ id }) => id === 'geometry-anamorphic-mp4-v1')];
	for (const [index, file] of media.entries()) await importFiles(editor, [{
		name: `camera-${index ? 'b' : 'a'}.mp4`, mimeType: file.file.mimeType, buffer: Buffer.from(file.file.buffer),
	}]);
	const cameraA = editor.getByRole('group', { name: 'Video clip: camera-a', exact: true });
	const cameraB = editor.getByRole('group', { name: 'Video clip: camera-b', exact: true });
	await cameraA.focus(); await cameraA.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await cameraB.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: camera-b', exact: true });
	await expect(card).toBeVisible();
	await expect(cameraB).toHaveCount(0);
	await card.locator('.kw-audio-editor__project-bin-overflow').click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	const confirmation = page.getByRole('alertdialog', { name: 'Remove from project', exact: true });
	await confirmation.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(card).toHaveCount(0);
	await expect(confirmation).toBeHidden();
	await cameraA.focus(); await cameraA.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
});
