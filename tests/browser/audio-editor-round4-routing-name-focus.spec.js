/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('saving a routing node name retains its field for continued keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.getByLabel('Add routing node', { exact: true }).selectOption('cue');
	const node = graph.locator('[data-routing-node^="mixer-node:"]').last();
	await node.locator('.kw-routing-graph__node-main').press('Enter');
	const inspector = graph.getByRole('complementary', { name: 'Routing inspector', exact: true });
	const name = inspector.getByLabel('Name', { exact: true });
	await name.fill('Dialogue cue');
	await name.press('Enter');
	await expect(node).toContainText('Dialogue cue');
	await expect(name).toBeFocused();
	await page.keyboard.type(' encore');
	await page.keyboard.press('Enter');
	await expect(node).toContainText('Dialogue cue encore');
	await expect(name).toBeFocused();
});
