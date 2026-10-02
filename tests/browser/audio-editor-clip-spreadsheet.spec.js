/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, collectClientErrors, dockWorkspacePanel, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

const firstName = toneA.name.replace(/\.[^.]+$/u, '');
const secondName = toneB.name.replace(/\.[^.]+$/u, '');
const cell = (grid, row, column) => grid.getByRole('gridcell')
	.and(grid.locator(`[data-row="${row}"][data-column="${column}"]`));

async function openSpreadsheet(page, editor) {
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Clip spreadsheet']);
	return editor.locator('[data-workspace-panel="clip-spreadsheet"]');
}

async function editCell(grid, row, column, label, value) {
	await cell(grid, row, column).dblclick();
	const input = grid.getByLabel(label, { exact: true });
	await input.fill(value);
	await input.press('Enter');
}

async function pasteText(page, text) {
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await page.keyboard.press('ControlOrMeta+v');
}

async function copiedText(page) {
	await page.keyboard.press('ControlOrMeta+c');
	return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('clip spreadsheet', () => {
	test.beforeEach(async ({ context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	});

	test('opens from View Panels for an empty project and closes through panel controls', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-workspace-panel="clip-spreadsheet"]')).toHaveCount(0);
		const panel = await openSpreadsheet(page, editor);
		await expect(panel.getByText('This project has no clips.', { exact: true })).toBeVisible();
		await closeWorkspacePanel(editor, 'clip-spreadsheet');
		await expect(panel).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('shows every clip and edits properties in place with undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText(secondName);
		await expect(cell(grid, 0, 'source')).toHaveText(toneA.name);
		await expect(cell(grid, 0, 'source')).toHaveAttribute('aria-readonly', 'true');
		await editCell(grid, 0, 'name', 'Name', 'Spreadsheet edit');
		await expect(cell(grid, 0, 'name')).toHaveText('Spreadsheet edit');
		await editCell(grid, 0, 'position', 'Position (s)', '1.25');
		await expect.poll(async () => Number(await cell(grid, 0, 'position').textContent())).toBe(1.25);
		await cell(grid, 0, 'gain').click();
		await page.keyboard.press('Enter');
		const gain = grid.getByLabel('Gain (dB)', { exact: true });
		await gain.fill('-6');
		await gain.press('Enter');
		await expect.poll(async () => Number(await cell(grid, 0, 'gain').textContent())).toBeCloseTo(-6);
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(async () => Number(await cell(grid, 0, 'gain').textContent())).toBe(0);
		await panel.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect.poll(async () => Number(await cell(grid, 0, 'gain').textContent())).toBeCloseTo(-6);
		await closeWorkspacePanel(editor, 'clip-spreadsheet');
		await expect(panel).toBeHidden();
		await openSpreadsheet(page, editor);
		await expect(cell(panel.getByRole('grid'), 0, 'name')).toHaveText('Spreadsheet edit');
		expect(errors).toEqual([]);
	});

	test('docks, floats, resizes and restores its saved panel placement', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		await expect(editor.locator('[data-panel-dock="bottom"] [data-workspace-panel="clip-spreadsheet"]')).toBeVisible();
		await dockWorkspacePanel(editor, 'clip-spreadsheet', 'right');
		await dockWorkspacePanel(editor, 'clip-spreadsheet', 'floating');
		const width = Number(await panel.getAttribute('data-workspace-panel-width'));
		await panel.locator('[data-floating-panel-resize-handle="clip-spreadsheet"]').press('Shift+ArrowLeft');
		await expect(panel).toHaveAttribute('data-workspace-panel-width', String(width - 48));
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const restoredEditor = await waitForEditor(page);
		const restored = restoredEditor.locator('[data-panel-dock="floating"] [data-workspace-panel="clip-spreadsheet"]');
		await expect(restored).toBeVisible();
		await expect(restored).toHaveAttribute('data-workspace-panel-width', String(width - 48));
		await expect(cell(restored.getByRole('grid'), 0, 'name')).toHaveText(firstName);
		expect(errors).toEqual([]);
	});

	test('cancels drafts, keeps typed characters and commits each edit as one undo step', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const name = cell(grid, 0, 'name');
		await name.click();
		await page.keyboard.press('r');
		const input = grid.getByLabel('Name', { exact: true });
		await expect(input).toHaveValue('r');
		await input.pressSequentially('ename');
		await expect(input).toHaveValue('rename');
		await input.press('Escape');
		await expect(name).toHaveText(firstName);
		await expect(panel).toBeVisible();

		await editCell(grid, 0, 'name', 'Name', 'Committed with Enter');
		await expect(name).toHaveText('Committed with Enter');
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(name).toHaveText(firstName);

		await name.dblclick();
		await input.fill('Committed by leaving the cell');
		await cell(grid, 0, 'gain').click();
		await expect(name).toHaveText('Committed by leaving the cell');
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(name).toHaveText(firstName);
		await name.dblclick();
		await input.fill('Committed with Tab');
		await input.press('Tab');
		await expect(name).toHaveText('Committed with Tab');
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(name).toHaveText(firstName);
		await name.click();
		await page.keyboard.press('Shift+Tab');
		await expect(name).not.toBeFocused();
		await expect(panel).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('copies and pastes cells, rectangular ranges, columns and full rows as spreadsheet text', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await cell(grid, 0, 'name').click();
		expect(await copiedText(page)).toBe(firstName);
		await pasteText(page, 'Renamed in a spreadsheet');
		await expect(cell(grid, 0, 'name')).toHaveText('Renamed in a spreadsheet');

		await cell(grid, 0, 'pitch').click();
		await cell(grid, 1, 'speed').click({ modifiers: ['Shift'] });
		await pasteText(page, '2\t1.5\r\n-3\t0.75\r\n');
		await expect.poll(async () => Number(await cell(grid, 0, 'pitch').textContent())).toBe(2);
		await expect.poll(async () => Number(await cell(grid, 1, 'pitch').textContent())).toBe(-3);
		await expect.poll(async () => Number(await cell(grid, 0, 'speed').textContent())).toBe(1.5);
		await expect.poll(async () => Number(await cell(grid, 1, 'speed').textContent())).toBe(0.75);
		expect((await copiedText(page)).trim().split(/\r?\n/u).map((row) => row.split('\t').map(Number)))
			.toEqual([[2, 1.5], [-3, 0.75]]);
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(async () => Number(await cell(grid, 0, 'pitch').textContent())).toBe(0);
		await expect.poll(async () => Number(await cell(grid, 1, 'speed').textContent())).toBe(1);

		await grid.getByRole('button', { name: 'Name', exact: true }).click();
		expect((await copiedText(page)).trim().split(/\r?\n/u)).toEqual(['Renamed in a spreadsheet', secondName]);
		await pasteText(page, 'First spreadsheet row\nSecond spreadsheet row');
		await expect(cell(grid, 0, 'name')).toHaveText('First spreadsheet row');
		await expect(cell(grid, 1, 'name')).toHaveText('Second spreadsheet row');

		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		await expect(cell(grid, 0, 'name')).toBeInViewport();
		const rowText = await copiedText(page);
		expect(rowText).toContain(toneA.name);
		expect(rowText.split('\t').length).toBeGreaterThanOrEqual(14);
		await pasteText(page, rowText.replace('First spreadsheet row', 'Full row round trip'));
		await expect(cell(grid, 0, 'name')).toHaveText('Full row round trip');
		expect(errors).toEqual([]);
	});

	test('rejects a whole invalid paste without changing valid cells in the same range', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await grid.getByRole('button', { name: 'Speed (×)', exact: true }).click();
		await pasteText(page, '1.5\n0');
		await expect(panel.getByRole('alert')).toBeVisible();
		await expect.poll(async () => Number(await cell(grid, 0, 'speed').textContent())).toBe(1);
		await expect.poll(async () => Number(await cell(grid, 1, 'speed').textContent())).toBe(1);
		expect(errors).toEqual([]);
	});

	test('appends rows using imported audio and creates named tracks in one undo step', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const row = ['New clip', 'Spreadsheet track', '2', toneA.name, '0.05', '0.1', '3', '1.5', '-6', '0.01', '0.02', 'true', 'false'];
		await page.evaluate((value) => navigator.clipboard.writeText(value), row.join('\t'));
		await panel.getByRole('button', { name: 'Paste new rows', exact: true }).click();
		await expect(cell(grid, 1, 'name')).toHaveText('New clip');
		await expect(cell(grid, 1, 'track')).toHaveText('Spreadsheet track');
		await expect(cell(grid, 1, 'position')).toHaveText('2');
		await expect(cell(grid, 1, 'offset')).toHaveText('0.05');
		await expect(cell(grid, 1, 'duration')).toHaveText('0.1');
		await expect(cell(grid, 1, 'pitch')).toHaveText('3');
		await expect(cell(grid, 1, 'speed')).toHaveText('1.5');
		await expect(cell(grid, 1, 'gain')).toHaveText('-6');
		await expect(cell(grid, 1, 'reversed')).toHaveText('true');
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(cell(grid, 1, 'name')).toHaveCount(0);
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await panel.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(cell(grid, 1, 'name')).toHaveText('New clip');
		expect(errors).toEqual([]);
	});

	test('loads a missing disk source for pasted rows in an empty project and rejects invalid media bounds atomically', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		const row = ['From disk', 'Imported row', '3', `/recordings/${toneA.name}`, '0.05', '0.1', '-2', '2'];
		await page.evaluate((value) => navigator.clipboard.writeText(value), row.join('\t'));
		await panel.getByRole('button', { name: 'Paste', exact: true }).click();
		await expect(panel.getByText(`/recordings/${toneA.name}`, { exact: true })).toBeVisible();
		const choose = page.waitForEvent('filechooser');
		await panel.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choose).setFiles(toneA);
		await expect(cell(grid, 0, 'name')).toHaveText('From disk');
		await expect(cell(grid, 0, 'source')).toHaveText(toneA.name);
		await expect(cell(grid, 0, 'position')).toHaveText('3');
		await expect(cell(grid, 0, 'pitch')).toHaveText('-2');
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(cell(grid, 0, 'name')).toHaveCount(0);
		row[5] = '999';
		await page.evaluate((value) => navigator.clipboard.writeText(value), row.join('\t'));
		await panel.getByRole('button', { name: 'Paste', exact: true }).click();
		const invalidChoose = page.waitForEvent('filechooser');
		await panel.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await invalidChoose).setFiles(toneA);
		await expect(panel.getByRole('alert')).toBeVisible();
		await expect(cell(grid, 0, 'name')).toHaveCount(0);
		await expect(panel.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
		expect(errors).toEqual([]);
	});

	test('pastes a taller table to update existing rows and add clips beyond its end', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		const original = await copiedText(page);
		const first = original.split('\t');
		first[0] = 'Updated row';
		const second = [...first];
		second[0] = 'Added row';
		second[2] = '2';
		await pasteText(page, `${first.join('\t')}\n${second.join('\t')}`);
		await expect(cell(grid, 0, 'name')).toHaveText('Updated row');
		await expect(cell(grid, 1, 'name')).toHaveText('Added row');
		await expect(cell(grid, 1, 'track')).toHaveText(firstName);
		await panel.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('keeps missing-source pastes pending after a mismatched file and allows cancellation', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = await openSpreadsheet(page, editor);
		await page.evaluate((value) => navigator.clipboard.writeText(value), ['Pending', 'New track', '0', toneA.name].join('\t'));
		await panel.getByRole('button', { name: 'Paste', exact: true }).click();
		const choose = page.waitForEvent('filechooser');
		await panel.getByRole('button', { name: 'Load referenced files', exact: true }).click();
		await (await choose).setFiles(toneB);
		await expect(panel.getByRole('alert')).toBeVisible();
		await expect(panel.getByRole('gridcell')).toHaveCount(0);
		await panel.getByRole('button', { name: 'Cancel paste', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Load referenced files', exact: true })).toHaveCount(0);
		await expect(panel.getByRole('alert')).toHaveCount(0);
		await expect(panel.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
		expect(errors).toEqual([]);
	});

	test('keyboard paste appends safely when clipboard reading is unavailable', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const panel = await openSpreadsheet(page, editor);
		const grid = panel.getByRole('grid');
		await grid.getByRole('button', { name: 'Select row 1', exact: true }).click();
		const row = (await copiedText(page)).split('\t');
		row[0] = 'Keyboard append';
		row[2] = '2';
		await page.evaluate(() => {
			Object.defineProperty(navigator.clipboard, 'readText', { configurable: true,
				value: () => Promise.reject(new DOMException('Clipboard permission denied', 'NotAllowedError')) });
		});
		await cell(grid, 0, 'name').click();
		await panel.getByRole('button', { name: 'Paste new rows', exact: true }).click();
		await expect(panel.locator('[data-clip-spreadsheet-append]')).toBeFocused();
		await pasteText(page, row.join('\t'));
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText('Keyboard append');
		row[0] = 'Second keyboard append';
		row[2] = '4';
		await pasteText(page, row.join('\t'));
		await expect(cell(grid, 0, 'name')).toHaveText(firstName);
		await expect(cell(grid, 1, 'name')).toHaveText('Keyboard append');
		await expect(cell(grid, 2, 'name')).toHaveText('Second keyboard append');
		expect(errors).toEqual([]);
	});
});
