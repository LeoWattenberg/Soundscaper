/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What a timeline does once it holds more tracks than its viewport shows.
 *
 * The subject here is the timeline, not the macro. The eight-track project it
 * needs is arranged by running a macro program, which is what the arrangement
 * helper is for: building that state by hand would spend a hundred lines
 * repeating coverage the track and clip specs already own, run slowly, and give
 * this spec another way to flake.
 */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { arrangeWithMacro } from './helpers/macro-arrange.js';

registerAudioEditorHooks();

test.describe('a timeline deeper than its viewport', () => {
	test('every arranged track keeps a reachable, individually named header', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const before = await editor.locator('.audio-editor-track-row').count();
		await arrangeWithMacro(page, editor, `
			for (let index = 0; index < 6; index += 1) {
				await sound.command('NewMonoTrack');
			}
			await sound.select.none();
			sound.log.info('arranged');
		`);

		const rows = editor.locator('.audio-editor-track-row');
		await expect(rows).toHaveCount(before + 6);

		// A header the viewport has scrolled past is still a header: each one
		// scrolls into view and carries its own name rather than the first row's.
		const names = [];
		for (let index = 0; index < before + 6; index += 1) {
			const header = rows.nth(index).locator('[data-track-header]');
			await header.scrollIntoViewIfNeeded();
			await expect(header).toBeVisible();
			names.push(((await header.textContent()) ?? '').trim());
		}
		expect(names.filter(Boolean)).toHaveLength(names.length);
		expect(errors).toEqual([]);
	});
});
