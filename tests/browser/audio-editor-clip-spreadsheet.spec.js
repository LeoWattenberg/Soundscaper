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
});
