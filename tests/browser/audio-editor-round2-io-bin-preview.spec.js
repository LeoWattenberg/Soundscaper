/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('a rate-stretched video keeps its authored speed in Project Bin preview', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('rate-preview.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:02:00');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Rate stretch right edge to playhead']);
	const badge = clip.locator('[data-video-rate-badge]');
	const rate = Number(await badge.getAttribute('data-video-playback-rate'));
	expect(rate).toBeGreaterThan(0.2);
	expect(rate).toBeLessThan(0.75);
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await expect(card.locator('.kw-audio-editor__project-bin-meta')).toContainText('0:02.0');
	await card.getByRole('button', { name: /^Play:/u }).click();
	const media = card.locator('video');
	await expect(media).toBeVisible();
	await expect.poll(() => media.evaluate(video => video.playbackRate)).toBeCloseTo(rate, 6);
});

for (const [frame, earliestSourceTime] of [[12, 0.39], [2, 0.06]]) {
	test(`a video trimmed at frame ${frame} previews its retained source span from Project Bin`, async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicSilentVideoFixture('trim-preview.webm')]);
		const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
		await clip.press('Enter');
		await seekFramescaperTimecode(page, editor, `00:00:00:${String(frame).padStart(2, '0')}`);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Trim left edge to playhead']);
		await clip.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		const card = editor.locator('[data-project-bin-item]').first();
		await card.evaluate(element => {
			const observer = new MutationObserver(() => {
				const video = element.querySelector('video');
				if (!video) return;
				observer.disconnect();
				video.addEventListener('playing', () => {
					element.setAttribute('data-observed-first-preview-time', String(video.currentTime));
				}, { once: true });
			});
			observer.observe(element, { childList: true, subtree: true });
		});
		await card.getByRole('button', { name: /^Play:/u }).click();
		const media = card.locator('video');
		await expect(media).toBeVisible();
		await expect.poll(async () => Number(await card.getAttribute('data-observed-first-preview-time')))
			.toBeGreaterThanOrEqual(earliestSourceTime);
	});
}
