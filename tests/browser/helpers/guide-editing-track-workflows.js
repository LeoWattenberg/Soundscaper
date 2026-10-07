/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { chooseCommandAction } from '../audio-editor-test-helpers.js';

const CLIP_ROLE = { name: / clip, starts at [\d.]+ seconds?, [\d.]+ seconds? long$/u };
const clipsIn = (row) => row.getByRole('group', CLIP_ROLE);
const rowsWithClips = (editor) => editor.locator('[data-track-row]:has(.clip-display)');

/** Assert structural, timing, ordering, and view outcomes for the track-workflow recipes. */
export async function verifyEditingTrackWorkflowResults(page, id) {
	const editor = page.locator('[data-audio-editor]');
	const clips = editor.getByRole('group', CLIP_ROLE);
	if (id === 'lift-a-passage-to-a-new-track') {
		const rows = rowsWithClips(editor);
		await expect(rows).toHaveCount(2);
		await expect(clips).toHaveCount(3);
		await expect(clipsIn(rows.nth(0))).toHaveCount(2);
		await expect(clipsIn(rows.nth(0)).nth(0)).toHaveAttribute('aria-label', /starts at 0 seconds, 0\.5 seconds long$/u);
		await expect(clipsIn(rows.nth(0)).nth(1)).toHaveAttribute('aria-label', /starts at 1\.5 seconds, 0\.5 seconds long$/u);
		await expect(clipsIn(rows.nth(1))).toHaveCount(1);
		await expect(clipsIn(rows.nth(1))).toHaveAttribute('aria-label', /starts at 0\.5 seconds, 1 second long$/u);
	}
	if (id === 'split-clips-at-silent-pauses') {
		await expect(clips).toHaveCount(4);
		const expected = [
			/starts at 0 seconds, 0\.6 seconds long$/u,
			/starts at 1\.3 seconds, 0\.6 seconds long$/u,
			/starts at 2\.6 seconds, 0\.6 seconds long$/u,
			/starts at 3\.9 seconds, 0\.1 seconds long$/u,
		];
		for (const [index, pattern] of expected.entries()) await expect(clips.nth(index)).toHaveAttribute('aria-label', pattern);
	}
	if (id === 'ungroup-linked-clips') {
		await expect(clips).toHaveCount(2);
		await expect(clips.nth(0)).toHaveAttribute('aria-label', /starts at 0 seconds, 1 second long$/u);
		await expect(clips.nth(1)).toHaveAttribute('aria-label', /starts at 1 second, 1 second long$/u);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(0);
		await clips.nth(0).press('Enter');
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(1);
	}
	if (id === 'align-a-track-to-the-playhead') {
		await expect(clips).toHaveAttribute('aria-label', /starts at 2 seconds, 2 seconds long$/u);
	}
	if (id === 'sort-tracks-by-name') {
		const names = await rowsWithClips(editor).locator('.track-control-panel__track-name-text').allTextContents();
		expect(names).toEqual(['guide-music-loop', 'guide-second-loop']);
		await expect(clips).toHaveCount(2);
		for (const clip of await clips.all()) await expect(clip).toHaveAttribute('aria-label', /starts at 0 seconds, 2 seconds long$/u);
	}
	if (id === 'move-a-track-to-the-top') {
		const rows = rowsWithClips(editor);
		const names = await rows.locator('.track-control-panel__track-name-text').allTextContents();
		expect(names).toEqual(['guide-second-loop', 'guide-music-loop']);
		await expect(clips).toHaveCount(2);
		for (const clip of await clips.all()) await expect(clip).toHaveAttribute('aria-label', /starts at 0 seconds, 2 seconds long$/u);
	}
	if (id === 'view-a-track-as-a-spectrogram') {
		const row = rowsWithClips(editor).first();
		await expect(row).toHaveAttribute('data-display-mode', 'spectrogram');
		await expect(clips).toHaveCount(1);
		await expect(clips).toHaveAttribute('aria-label', /starts at 0 seconds, 2 seconds long$/u);
	}
}
