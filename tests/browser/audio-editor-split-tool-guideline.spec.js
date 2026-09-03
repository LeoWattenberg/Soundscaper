import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Audacity Split Tool guideline', () => {
	registerAudioEditorHooks();

	test('tracks clip hover, expands with Shift, and yields Alt-click', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await editor.getByRole('button', { name: 'Split tool', exact: true }).click();

		const clip = clipByName(editor, toneA.name);
		const display = clip.locator('.clip-display');
		const box = await display.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		const x = box.x + box.width * 0.4;
		const y = box.y + box.height * 0.5;
		await page.mouse.move(x, y);

		const guideline = editor.locator('[data-split-tool-guideline]');
		await expect(guideline).toBeVisible();
		await expect(guideline).toHaveAttribute('data-split-tool-scope', 'track');
		const trackHeight = (await clip.locator('xpath=ancestor::div[@data-track-row][1]').boundingBox())?.height;
		expect((await guideline.boundingBox())?.height).toBe(trackHeight);

		await page.keyboard.down('Shift');
		await expect(guideline).toHaveAttribute('data-split-tool-scope', 'all-tracks');
		expect((await guideline.boundingBox())?.height).toBeGreaterThan(trackHeight ?? 0);
		await page.keyboard.up('Shift');
		await expect(guideline).toHaveAttribute('data-split-tool-scope', 'track');

		await page.keyboard.down('Alt');
		await page.mouse.click(x, y);
		await page.keyboard.up('Alt');
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		const pressFrame = await guideline.getAttribute('data-split-tool-guideline-frame');
		await page.mouse.move(x, y);
		await page.mouse.down();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await page.mouse.move(x + 20, y);
		await expect(guideline).toBeVisible();
		await expect.poll(() => guideline.getAttribute('data-split-tool-guideline-frame')).not.toBe(pressFrame);
		await page.mouse.up();
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		expect(errors).toEqual([]);
	});
});
