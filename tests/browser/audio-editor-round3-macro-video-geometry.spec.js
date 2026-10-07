/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('macro project reads report a normally imported video clip in project sample frames', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		"const video = (await sound.project.tracks()).find(track => track.kind === 'video');",
		'const clip = (await sound.project.clips(video.id))[0];',
		"sound.log.info('video durationFrames=' + clip.durationFrames);",
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('video durationFrames=104000');
});
