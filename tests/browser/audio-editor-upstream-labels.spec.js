import { capturePassingScreenshot } from './helpers/passing-screenshots.js';
import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

async function importAdjacentLabels(editor) {
	await importFiles(editor, [longTone]);
	await importFiles(editor, [{ name: 'sections.txt', mimeType: 'text/plain',
		buffer: Buffer.from('0.5\t1.5\tBefore\n1.5\t2.5\tAfter\n') }]);
	const before = editor.getByRole('group', { name: 'Edit labels: Before', exact: true });
	const after = editor.getByRole('group', { name: 'Edit labels: After', exact: true });
	await expect(before).toBeVisible();
	await expect(after).toBeVisible();
	return { before, after };
}

test('adjacent labels share a boundary that resizes both labels with one undo', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const { before, after } = await importAdjacentLabels(editor);
	await expect(before.locator('.label-marker__right-ear')).toHaveCount(0);
	await expect(after.locator('.label-marker__left-ear')).toHaveCount(0);
	const beforeBox = await before.locator('[data-label-banner]').boundingBox();
	const afterBox = await after.locator('[data-label-banner]').boundingBox();
	const stalk = await after.locator('[data-shared-boundary]').boundingBox();
	expect(stalk).not.toBeNull();
	await page.mouse.move(stalk.x + stalk.width / 2, stalk.y + 38);
	await page.mouse.down();
	await page.mouse.move(stalk.x + stalk.width / 2 + 30, stalk.y + 38, { steps: 5 });
	await page.mouse.up();
	await expect.poll(async () => (await before.locator('[data-label-banner]').boundingBox()).width).toBeCloseTo(beforeBox.width + 30, 0);
	await expect.poll(async () => (await after.locator('[data-label-banner]').boundingBox()).x).toBeCloseTo(afterBox.x + 30, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await before.locator('[data-label-banner]').boundingBox()).width).toBeCloseTo(beforeBox.width, 0);
	await expect.poll(async () => (await after.locator('[data-label-banner]').boundingBox()).x).toBeCloseTo(afterBox.x, 0);
	expect(errors).toEqual([]);
});

test('label text sizing is available from the label menu and scales the strap', async ({ page }, testInfo) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const { before } = await importAdjacentLabels(editor);
	const row = editor.locator('[data-label-track]');
	await row.getByRole('button', { name: 'Track options', exact: true }).click();
	await page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: 'Track color', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Track color: Orange', exact: true }).click();
	await expect(row).toHaveAttribute('data-track-color', 'orange');
	await expect(before.locator('.label-marker')).toHaveCSS('--label-track-color', '#FF9E65');
	await before.locator('[data-label-banner]').click({ button: 'right' });
	await page.getByRole('menuitem', { name: /^Label text size/ }).hover();
	await page.getByRole('menuitem', { name: '24 pt', exact: true }).click();
	await expect(before.locator('[data-label-banner]')).toHaveCSS('height', '48px');
	await expect(before.locator('.label-marker__label-text')).toHaveCSS('font-size', '32px');
	await expect(before.locator('[data-label-ear]').first().locator('svg')).toHaveAttribute('height', '20');
	await capturePassingScreenshot(row, { path: testInfo.outputPath('label-text-24pt.png') });
	await before.locator('[data-label-banner]').dblclick();
	const title = editor.getByRole('textbox', { name: 'Edit labels: Before', exact: true });
	await expect(title).toBeFocused();
	await title.fill('Changed');
	await title.press('Escape');
	await expect(before).toBeVisible();
	expect(errors).toEqual([]);
});

for (const { count, size } of [{ count: 9, size: 9 }, { count: 3, size: 48 }]) {
	test(`${String(size)} pt packed labels remain inside their track and editable through timeline scrolling`, async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [longTone]);
		await importFiles(editor, [{ name: 'packed-cues.txt', mimeType: 'text/plain',
			buffer: Buffer.from(Array.from({ length: count }, (_, index) => {
				const time = 0.5 + index / 100;
				return `${String(time)}\t${String(time)}\tCue ${String(index + 1)}\n`;
			}).join('')) }]);
		const row = editor.locator('[data-label-track]');
		await expect(row.locator('[data-label-id]')).toHaveCount(count);
		if (size !== 9) {
			await row.locator('[data-label-banner]').first().click({ button: 'right' });
			await page.getByRole('menuitem', { name: /^Label text size/ }).hover();
			await page.getByRole('menuitem', { name: `${String(size)} pt`, exact: true }).click();
		}
		await expect.poll(() => row.evaluate(element => {
			const bounds = element.getBoundingClientRect();
			return [...element.querySelectorAll('[data-label-banner]')].every(banner => {
				const rect = banner.getBoundingClientRect();
				return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
			});
		})).toBe(true);
		const last = row.getByRole('group', { name: `Edit labels: Cue ${String(count)}`, exact: true });
		await last.locator('[data-label-banner]').click();
		await expect(last).toHaveAttribute('data-selected-label', 'true');
		await last.locator('[data-label-banner]').dblclick();
		const title = last.getByRole('textbox');
		await expect(title).toBeFocused();
		await title.fill('Last cue edited');
		await title.press('Enter');
		await expect(row.getByRole('group', { name: 'Edit labels: Last cue edited', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
}
