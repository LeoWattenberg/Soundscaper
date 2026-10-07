/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('splitting a VCA-controlled stereo recording retains membership on both mono tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const track = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	const trackId = await track.getAttribute('data-track-id');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.getByLabel('Add routing node', { exact: true }).selectOption('vca');
	await graph.locator('[data-routing-node^="vca:"] .kw-routing-graph__node-main').click();
	const inspector = graph.getByRole('complementary', { name: 'Routing inspector', exact: true });
	await inspector.locator('input[name="gain"]').fill('0.5');
	await inspector.locator(`input[name="member"][value='{"kind":"track","id":"${trackId}"}']`).check();
	await inspector.getByRole('button', { name: 'Save VCA', exact: true }).click();
	const membership = graph.locator('[data-routing-vca-relation]');
	await expect(membership).toHaveCount(1);
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(membership).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(membership).toHaveCount(1);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(membership).toHaveCount(2);
});
