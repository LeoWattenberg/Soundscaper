import { AxeBuilder, expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	commitInput,
	importFiles,
} from './audio-editor-test-helpers.js';

async function renameProject(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.locator('[data-project-name-input] input'), title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(editor.locator('[data-project-name]')).toHaveText(title);
}

test.describe('project tab close controls', () => {
	test('closes an inactive tab without activating it and preserves its saved audio', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'Saved audio');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Active blank');
		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs' });
		const accessibility = await new AxeBuilder({ page }).include('nav[aria-label="Project tabs"]')
			.withRules(['aria-required-children', 'aria-required-parent', 'aria-valid-attr-value']).analyze();
		expect(accessibility.violations).toEqual([]);
		const close = projectTabs.getByRole('button', { name: 'Close project: Saved audio', exact: true });
		await expect(close).toHaveText('×');
		await expect(close).not.toHaveAttribute('title');
		await close.hover();
		await expect(editor.locator('[data-audio-editor-button-tooltip]')).toHaveText('Close project: Saved audio');
		await page.mouse.move(0, 0);
		await close.click();

		await expect(projectTabs.getByRole('tab')).toHaveCount(1);
		const active = projectTabs.getByRole('tab', { name: 'Active blank', exact: true });
		await expect(active).toHaveAttribute('aria-selected', 'true');
		await expect(active).toBeFocused();
		await expect(editor).toHaveAttribute('data-clip-count', '0');

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Local projects']);
		const projects = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await projects.locator('[data-project-list]').getByRole('button', { name: /^Saved audio Last edited:/u }).click();
		await expect(projects).toHaveCount(0);
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await expect(projectTabs.getByRole('tab', { name: 'Saved audio', exact: true })).toHaveAttribute('aria-selected', 'true');
		expect(errors).toEqual([]);
	});

	test('keyboard closure selects the right neighbor and closing the final tab selects the left', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'First');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Middle');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Last');
		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs' });
		const middle = projectTabs.getByRole('tab', { name: 'Middle', exact: true });
		await middle.click();
		await expect(middle).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Tab');
		await expect(projectTabs.getByRole('button', { name: 'Close project: Middle', exact: true })).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(projectTabs.getByRole('tab')).toHaveCount(2);
		const last = projectTabs.getByRole('tab', { name: 'Last', exact: true });
		await expect(last).toHaveAttribute('aria-selected', 'true');
		await expect(last).toHaveAttribute('tabindex', '0');
		await expect(last).toBeFocused();
		await projectTabs.getByRole('button', { name: 'Close project: Last', exact: true }).click();

		await expect(projectTabs.getByRole('tab')).toHaveCount(1);
		const first = projectTabs.getByRole('tab', { name: 'First', exact: true });
		await expect(first).toHaveAttribute('aria-selected', 'true');
		await expect(first).toHaveAttribute('tabindex', '0');
		await expect(first).toBeFocused();
		expect(errors).toEqual([]);
	});

	test('closing the only project tab opens a focused blank project', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'Only project');
		await importFiles(editor, [toneA]);
		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs' });
		await projectTabs.getByRole('button', { name: 'Close project: Only project', exact: true }).click();
		await expect(projectTabs.getByRole('tab', { name: 'Only project', exact: true })).toHaveCount(0);

		const remaining = projectTabs.getByRole('tab');
		await expect(remaining).toHaveCount(1);
		await expect(remaining).not.toHaveText('Only project');
		await expect(remaining).toHaveAttribute('aria-selected', 'true');
		await expect(remaining).toHaveAttribute('tabindex', '0');
		await expect(remaining).toBeFocused();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		expect(errors).toEqual([]);
	});
});
