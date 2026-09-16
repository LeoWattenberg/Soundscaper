import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const projectManagementCommands = [
	'Local projects',
	'Consolidate media',
	'Trim media to what is used',
	'Save archive checksums',
	'Project properties',
	'Rename project',
	'Duplicate project',
	'Delete project',
	'Clear all local editor data',
];

test.describe('File project management submenu', () => {
	registerAudioEditorHooks();

	test('groups the project commands under an optional File submenu', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const file = editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'File', exact: true });
		await file.click();
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		const projectManagement = getMenuItem(fileMenu, 'Project management');
		await expect(projectManagement).toBeVisible();
		await expect(projectManagement.getByRole('menu')).toHaveCount(0);
		for (const label of projectManagementCommands) {
			await expect(getMenuItem(fileMenu, label)).toHaveCount(0);
		}

		await projectManagement.click();
		const submenu = projectManagement.getByRole('menu');
		await expect(submenu).toBeVisible();
		await expect(submenu.getByRole('menuitem')).toHaveCount(projectManagementCommands.length);
		await expect(submenu.getByRole('menuitem')).toContainText(projectManagementCommands);
		await expect(getMenuItem(submenu, 'Save archive checksums')).toHaveAttribute('aria-disabled', 'true');
		await getMenuItem(submenu, 'Project properties').click();
		await expect(fileMenu).toBeHidden();
		await expect(editor.locator('[data-workspace-panel="metadata"]')).toBeVisible();
	});

	test('supports keyboard entry, wraparound, exit, and command activation', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const file = editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'File', exact: true });
		await file.focus();
		await page.keyboard.press('ArrowDown');
		const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
		await expect(fileMenu.getByRole('menuitem').first()).toBeFocused();
		const projectManagement = getMenuItem(fileMenu, 'Project management');
		await page.keyboard.press('End');
		await expect(projectManagement).toBeFocused();
		await page.keyboard.press('ArrowRight');
		const submenu = projectManagement.getByRole('menu');
		const localProjects = getMenuItem(submenu, 'Local projects');
		const clearData = getMenuItem(submenu, 'Clear all local editor data');
		await expect(submenu).toBeVisible();
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('Home');
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('End');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(submenu).toBeHidden();
		await expect(projectManagement).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(localProjects).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(fileMenu).toBeHidden();
		const dialog = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(file).toBeFocused();
	});
});
