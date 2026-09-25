/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

test.describe('application menu action journeys', () => {
	test('View visibility items use open and closed eyes while recording and snapping retain checks', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const viewMenu = await openNestedCommandMenu(page, editor, 'View', []);
		const eye = (item) => item.locator(':scope > .context-menu-item-content .context-menu-item-icon .musescore-icon');

		const rulers = getMenuItem(viewMenu, 'Vertical rulers');
		await expect(rulers).toHaveAttribute('aria-checked', 'true');
		await expect(eye(rulers)).toHaveText('\uEF53');
		const rms = getMenuItem(viewMenu, 'RMS in waveform');
		await expect(rms).toHaveAttribute('aria-checked', 'false');
		await expect(eye(rms)).toHaveText('\uEF54');
		for (const label of ['Fade shape handles', 'Clipping in waveform', 'Master track', 'Markers', 'Status bar']) {
			await expect(eye(getMenuItem(viewMenu, label))).toHaveCount(1);
		}
		await expect(eye(getMenuItem(viewMenu, 'Enable multi-track recording'))).toHaveCount(0);

		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		for (const label of ['Project bin', 'Video preview', 'Effects']) {
			await expect(eye(getMenuItem(panels, label))).toHaveCount(1);
		}
		const tracks = getMenuItem(panels, 'Tracks panel');
		await expect(tracks).toHaveAttribute('aria-checked', 'true');
		await expect(eye(tracks)).toHaveText('\uEF53');
		await tracks.click();
		const hiddenTracks = getMenuItem(await openNestedCommandMenu(page, editor, 'View', ['Panels']), 'Tracks panel');
		await expect(hiddenTracks).toHaveAttribute('aria-checked', 'false');
		await expect(eye(hiddenTracks)).toHaveText('\uEF54');

		const snapping = await openNestedCommandMenu(page, editor, 'View', ['Snapping']);
		await expect(eye(getMenuItem(snapping, 'Snap to grid'))).toHaveCount(0);
	});

	test('routes view, track, and ripple edits through their visible menus', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await expect(editor).toHaveAttribute('data-track-count', '2');

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Tracks panel']);
		await expect(editor.locator('[data-track-list]')).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Tracks panel']);
		await expect(editor.locator('[data-track-list]')).toBeVisible();

		await chooseCommandAction(page, editor, 'View', 'Master track');
		await expect(editor.locator('[data-output-track-row][data-output-id="master"]')).toBeVisible();
		let viewMenu = await openNestedCommandMenu(page, editor, 'View', []);
		await expect(getMenuItem(viewMenu, 'Master track')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'View', 'Master track');
		await expect(editor.locator('[data-output-track-row][data-output-id="master"]')).toHaveCount(0);

		await chooseCommandAction(page, editor, 'View', 'RMS in waveform');
		viewMenu = await openNestedCommandMenu(page, editor, 'View', []);
		await expect(getMenuItem(viewMenu, 'RMS in waveform')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'View', 'RMS in waveform');

		await chooseCommandAction(page, editor, 'View', 'Vertical rulers');
		viewMenu = await openNestedCommandMenu(page, editor, 'View', []);
		await expect(getMenuItem(viewMenu, 'Vertical rulers')).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'View', 'Vertical rulers');

		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom in']);
		const timelineScroll = editor.locator('.audio-editor-timeline-scroll');
		await timelineScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
		await expect.poll(() => timelineScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Center view on playhead']);
		await expect.poll(() => timelineScroll.evaluate((element) => element.scrollLeft)).toBe(0);

		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await expect(editor.locator('[data-status]')).toHaveText('');
		await chooseCommandAction(page, editor, 'View', 'Status bar');
		await expect(editor.locator('[data-status]')).toHaveText('Done');

		await chooseCommandAction(page, editor, 'View', 'Fullscreen');
		await expect(editor).toHaveClass(/kw-audio-editor--viewport-fullscreen/u);
		await chooseCommandAction(page, editor, 'View', 'Fullscreen');
		await expect(editor).not.toHaveClass(/kw-audio-editor--viewport-fullscreen/u);

		await selectClipHeader(editor);
		await chooseCommandAction(page, editor, 'Tracks', 'Duplicate track');
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await selectClipHeader(editor);
		await chooseCommandAction(page, editor, 'Edit', 'Copy');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Insert and preserve synchronisation']);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await undoToOneClip(editor);

		for (const action of [
			['Cut', 'Cut and leave gap'],
			['Cut', 'Cut and close gap per clip'],
			['Cut', 'Cut and close gap on all tracks'],
			['Delete', 'Delete and close gap per clip'],
		]) {
			await selectClipHeader(editor);
			await chooseNestedCommandAction(page, editor, 'Edit', action);
			await expect(editor).toHaveAttribute('data-clip-count', '0');
			await undoToOneClip(editor);
		}

		viewMenu = await openNestedCommandMenu(page, editor, 'View', []);
		await expect(getMenuItem(viewMenu, 'Status bar')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
	});
});

async function selectClipHeader(editor) {
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
}

async function undoToOneClip(editor) {
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
}
