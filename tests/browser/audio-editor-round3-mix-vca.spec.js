/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const recording = createWavFixture({ name: 'vca-recording.wav', frequency: 330,
	channelCount: 1, channelAmplitudes: [0.35] });

test('replacing one mixed track does not apply its baked VCA gain again', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	const trackId = await clip.locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
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
	await expect(graph.locator('[data-routing-vca-relation]')).toHaveCount(1);
	const original = await exportSamples(page, editor);
	await clip.locator('.clip-header__name').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
	const dialog = page.locator('[data-mix-render-dialog]');
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
	const rendered = await exportSamples(page, editor);
	const originalPeak = Math.max(...original.map(Math.abs));
	const renderedPeak = Math.max(...rendered.map(Math.abs));
	expect(renderedPeak / originalPeak).toBeCloseTo(1, 3);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(Math.max(...restored.map(Math.abs)) / originalPeak).toBeCloseTo(1, 3);
});
