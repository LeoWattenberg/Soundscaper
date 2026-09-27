/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect,
	bootEditor,
	collectClientErrors,
	openEffectsForTrack,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('realtime effect replacement picker', () => {
	registerAudioEditorHooks();

	test('replaces the tall slot menu with the two-column picker and slot actions', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const effectsPanel = await openEffectsForTrack(editor, 0);
		await addRackEffect(page, effectsPanel, 'track', 'Invert');

		const rack = effectsPanel.locator('[data-effect-rack]');
		await openSlotPicker(rack.getByRole('group', { name: 'Invert', exact: true }));
		let flyout = page.getByRole('group', { name: 'Choose an effect', exact: true });
		await expect(flyout.getByRole('button', { name: 'Remove effect', exact: true })).toBeVisible();
		await expect(flyout.getByRole('button', { name: 'Copy effect', exact: true })).toBeVisible();
		const search = flyout.getByRole('searchbox', { name: 'Search effects', exact: true });
		await expect(search).toBeFocused();
		const choices = flyout.getByRole('menu', { name: 'Choose an effect', exact: true });
		await expect(choices).toHaveCSS('grid-template-columns', /\S+\s+\S+/u);
		await search.fill('reverb');
		await choices.getByRole('menuitem', { name: 'Reverb', exact: true }).click();
		const reverbSlots = rack.getByRole('group', { name: 'Reverb', exact: true });
		await expect(reverbSlots).toHaveCount(1);
		await expect(reverbSlots.first().getByRole('button', { name: 'More options', exact: true })).toBeFocused();

		await openSlotPicker(reverbSlots.first());
		flyout = page.getByRole('group', { name: 'Choose an effect', exact: true });
		await flyout.getByRole('button', { name: 'Copy effect', exact: true }).click();
		await expect(reverbSlots).toHaveCount(2);
		await expect(reverbSlots.first().getByRole('button', { name: 'More options', exact: true })).toBeFocused();

		await openSlotPicker(reverbSlots.first());
		flyout = page.getByRole('group', { name: 'Choose an effect', exact: true });
		await flyout.getByRole('button', { name: 'Remove effect', exact: true }).click();
		await expect(reverbSlots).toHaveCount(1);
		await expect(reverbSlots.first().getByRole('button', { name: 'More options', exact: true })).toBeFocused();
		expect(errors).toEqual([]);
	});
});

async function openSlotPicker(slot) {
	await slot.getByRole('button', { name: 'More options', exact: true }).click();
}
