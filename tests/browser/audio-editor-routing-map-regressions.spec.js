/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

async function connectionInspector(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await graph.locator('[data-routing-source^="track:"]').first().press('Enter');
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Choose a destination');
	await graph.locator('[data-routing-destination="master"]').press('Enter');
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');
	await graph.locator('[data-routing-edge]').last().click();
	return { graph, inspector: graph.locator('[data-routing-inspector="edge"]') };
}

test('routing channel choices only offer channels that exist in the source', async ({ page }) => {
	const { inspector } = await connectionInspector(page);
	await expect(inspector.locator('select[name="map-0"] option')).toHaveCount(3);
});
