/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('Routing graph keeps authored group cards reachable beside a direct assignment', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const track = graph.locator('[data-routing-node^="track:"] .kw-routing-graph__node-main').first();
	const master = graph.locator('[data-routing-node="master"] .kw-routing-graph__node-main');
	await track.click();
	await expect(track).toHaveAttribute('aria-pressed', 'true');
	await master.click();
	await expect(master).toHaveAttribute('aria-pressed', 'true');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	const group = graph.locator('[data-routing-node^="mixer-node:"] .kw-routing-graph__node-main');
	await expect(group).toHaveCount(1);
	await expect(group).toHaveAttribute('aria-pressed', 'true');
	await group.press('Enter');
	await expect(graph.locator('input[name="name"]')).toHaveValue('Group bus 1');
	await master.click();
	await expect(master).toHaveAttribute('aria-pressed', 'true');
	// A real pointer follows the rendered card center; no forced locator action.
	const bounds = await group.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await expect(group).toHaveAttribute('aria-pressed', 'true');
	await expect(graph.locator('input[name="name"]')).toHaveValue('Group bus 1');
	await graph.locator('[data-routing-edge]').first().click();
	await expect(graph.locator('[data-routing-inspector="edge"]')).toBeVisible();
	expect(errors).toEqual([]);
});
