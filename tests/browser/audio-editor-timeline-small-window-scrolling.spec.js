import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('small-window timeline scrolling', () => {
	registerAudioEditorHooks();

	test('keeps fitted tracks inside the visible scrollport and scrolls them vertically', async ({ page }) => {
		await page.setViewportSize({ width: 1_100, height: 330 });
		const editor = await bootEditor(page, '/embed/en/');
		const addTrack = editor.getByRole('button', { name: 'Add track', exact: true });
		for (let track = 0; track < 2; track += 1) {
			await addTrack.click();
			await page.getByRole('menu', { name: 'Add track', exact: true })
				.getByRole('menuitem', { name: 'Audio track', exact: true })
				.click();
		}

		const panel = editor.locator('.audio-editor-timeline-panel');
		const timeline = editor.locator('[data-timeline]');
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);
		await expect.poll(() => timeline.evaluate((element) => (
			element.scrollHeight - element.clientHeight
		))).toBeGreaterThan(100);
		const [panelBox, timelineBox] = await Promise.all([panel.boundingBox(), timeline.boundingBox()]);
		expect(panelBox).not.toBeNull();
		expect(timelineBox).not.toBeNull();
		expect(timelineBox.height).toBeLessThanOrEqual(panelBox.height + 1);

		await timeline.hover({ position: { x: 200, y: Math.min(80, timelineBox.height / 2) } });
		await page.mouse.wheel(0, 120);
		await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		expect(await timeline.evaluate((element) => element.scrollLeft)).toBe(0);
	});
});
