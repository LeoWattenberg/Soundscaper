import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Audacity track mixer shortcuts', () => {
	registerAudioEditorHooks();

	test('targets DOM-focused tracks and atomically mutes the durable selection', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		const firstTrackName = toneA.name.replace(/\.[^.]+$/u, '');
		const secondTrackName = toneB.name.replace(/\.[^.]+$/u, '');
		const firstControls = editor.getByRole('group', { name: `${firstTrackName} track controls`, exact: true });
		const secondControls = editor.getByRole('group', { name: `${secondTrackName} track controls`, exact: true });
		const firstTrack = firstControls.locator('xpath=ancestor::div[@data-track-row][1]');
		const secondTrack = secondControls.locator('xpath=ancestor::div[@data-track-row][1]');
		const firstMute = firstControls.getByRole('button', { name: 'Mute', exact: true });
		const secondMute = secondControls.getByRole('button', { name: 'Mute', exact: true });
		const timeline = editor.locator('[data-timeline]');

		await firstTrack.locator('[data-track-lane]').click();
		await secondControls.evaluate((element) => element.focus({ preventScroll: true }));
		await timeline.evaluate((element) => { element.scrollLeft = 0; });
		await expect(secondTrack.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
		await page.keyboard.press('Shift+u');
		await expect(secondMute).toHaveAttribute('aria-pressed', 'true');
		await expect(firstMute).toHaveAttribute('aria-pressed', 'false');
		await page.keyboard.press('Shift+s');
		await expect(secondControls.getByRole('button', { name: 'Solo', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await expect(secondControls.getByRole('group', { name: 'Pan', exact: true }).getByRole('slider'))
			.toHaveAttribute('aria-valuenow', '10');

		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });
		await page.keyboard.press('Control+Alt+u');
		await expect(firstMute).toHaveAttribute('aria-pressed', 'true');
		await expect(secondMute).toHaveAttribute('aria-pressed', 'true');
		await page.keyboard.press('Control+Alt+Shift+u');
		await expect(firstMute).toHaveAttribute('aria-pressed', 'false');
		await expect(secondMute).toHaveAttribute('aria-pressed', 'false');
		expect(errors).toEqual([]);
	});
});
