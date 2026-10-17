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

test('label text sizing is available from the label menu and scales the strap', async ({ page }) => {
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
	await before.locator('[data-label-banner]').dblclick();
	const title = editor.getByRole('textbox', { name: 'Edit labels: Before', exact: true });
	await expect(title).toBeFocused();
	await title.fill('Changed');
	await title.press('Escape');
	await expect(before).toBeVisible();
	expect(errors).toEqual([]);
});
