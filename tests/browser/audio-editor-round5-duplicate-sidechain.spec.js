/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	clipByName, closeDialog, closeEffectsPanel, importFiles, openEffectsForTrack,
} from './audio-editor-test-helpers.js';

test('Duplicate preserves the copied Gate external detector connection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const programme = clipByName(editor, toneA.name);
	const control = clipByName(editor, toneB.name);
	const programmeTrack = await programme.evaluate(clip => clip.closest('[data-track-id]')?.getAttribute('data-track-id'));
	const controlTrack = await control.evaluate(clip => clip.closest('[data-track-id]')?.getAttribute('data-track-id'));
	expect(programmeTrack).toBeTruthy();
	expect(controlTrack).toBeTruthy();
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Gate');
	await closeDialog(page.getByRole('dialog', { name: 'Gate', exact: true }));
	await closeEffectsPanel(effects);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	const destination = graph.locator('[data-routing-destination*="effect-sidechain"]').first();
	await expect(destination).toBeVisible();
	await graph.locator(`[data-routing-source="track:${controlTrack}"]`).press('Enter');
	await destination.press('Enter');
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');
	const sidechains = graph.locator('[data-routing-edge][aria-label*="sidechain"]');
	await expect(sidechains).toHaveCount(1);
	await programme.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(graph.locator('[data-routing-destination*="effect-sidechain"]')).toHaveCount(2);
	await expect(sidechains).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(sidechains).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(sidechains).toHaveCount(2);
});
