/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, clipByName, closeEffectsPanel,
	commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('a track noise profile retains the authored automation of its earlier filter', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	const tone = createWavFixture({ name: 'automated-filter.wav', frequency: 750, channelCount: 1 });
	await importFiles(editor, [tone]);
	const clip = clipByName(editor, tone.name);
	const row = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	let panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Resonant low-pass filter');
	let filter = page.getByRole('dialog', { name: 'Resonant low-pass filter', exact: true });
	await commitInput(filter.locator('[data-effect-param="frequency"] input'), '750');
	await filter.getByRole('button', { name: 'Close', exact: true }).click();
	await closeEffectsPanel(panel);
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	await row.getByRole('combobox', { name: 'Automation parameter', exact: true }).selectOption({ label: 'Q' });
	await row.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	const points = row.locator('[data-automation-point-id]');
	await expect(points).toHaveCount(2);
	for (const point of [points.first(), points.last()]) {
		for (let step = 0; step < 10; step++) await point.press('Shift+ArrowUp');
	}
	const authoredQ = await points.first().getAttribute('aria-valuenow');
	await expect(points.last()).toHaveAttribute('aria-valuenow', authoredQ);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const noise = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await noise.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(noise.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
	await noise.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const automated = await persistedProject(page, projectId);
	const profile = project => project.tracks.flatMap(track => track.effects ?? [])
		.find(effect => effect.type === 'audacity-noise-reduction').context.noiseProfile;
	const firstProfile = profile(automated);
	await closeEffectsPanel(panel);
	const curve = row.getByRole('button', { name: /^Insert automation point:/u });
	await curve.press('Shift+F10');
	await row.getByRole('menuitem', { name: 'Delete automation lane', exact: true }).click();
	panel = await openEffectsForTrack(editor, 1);
	await panel.getByRole('group', { name: 'Resonant low-pass filter', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	filter = page.getByRole('dialog', { name: 'Resonant low-pass filter', exact: true });
	await commitInput(filter.locator('[data-effect-param="q"] input'), authoredQ);
	await filter.getByRole('button', { name: 'Close', exact: true }).click();
	await panel.getByRole('group', { name: 'Noise Reduction', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	await noise.getByRole('button', { name: 'Replace noise profile', exact: true }).click();
	await noise.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const equivalentStatic = profile(await persistedProject(page, projectId));
	await test.info().attach('equivalent-prefix-profiles', { body: Buffer.from(JSON.stringify({ authoredQ,
		automated: firstProfile, static: equivalentStatic })), contentType: 'application/json' });
	expect(firstProfile).toEqual(equivalentStatic);
});
