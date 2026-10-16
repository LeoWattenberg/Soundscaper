/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('routing ports reserve connection gestures for the primary pointer button', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const groupKey = await graph.locator('[data-routing-node^="mixer-node:"]').getAttribute('data-routing-node');
	const source = graph.getByRole('button', { name: 'Start connection from browser-mono-tone', exact: true });
	const destination = graph.locator(`[data-routing-destination="${groupKey}"]`);
	const edges = graph.locator('[data-routing-edge]');
	const original = await edges.count();
	await source.hover();
	await page.mouse.down();
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Choose a destination');
	await destination.hover();
	await page.mouse.up();
	await expect(edges).toHaveCount(original + 1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(edges).toHaveCount(original);
	await source.hover();
	await page.mouse.down({ button: 'right' });
	await destination.hover();
	await page.mouse.up({ button: 'right' });
	await expect(edges).toHaveCount(original);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(edges).toHaveCount(original + 1);
});
