/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, readFile, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	closeDialog,
	collectClientErrors,
	commitInput,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

const FADE_STEPS = [
	'Select: start 0, end 1', 'Fade In',
	'Select: start 0, end 1, relativeTo project-end', 'Fade Out',
	'Select: start 0, end 0',
];

async function openManager(page, editor) {
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await expect(manager).toBeVisible();
	await expect(manager).toHaveAttribute('data-macros-palette', '');
	return manager;
}

function macrosPaletteStyleLoaded(page) {
	return page.evaluate(() => Array.from(document.styleSheets).some((sheet) => {
		try {
			return Array.from(sheet.cssRules).some((rule) =>
				rule instanceof CSSStyleRule && rule.selectorText.includes('.audio-editor-macros-palette__content'));
		} catch {
			return false;
		}
	}));
}

test.describe('macros palette libraries', () => {
	test('loads its layout styles when the menu opens the dialog', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		expect(await macrosPaletteStyleLoaded(page)).toBe(false);

		const manager = await openManager(page, editor);
		await expect.poll(() => macrosPaletteStyleLoaded(page)).toBe(true);
		await expect(manager.locator('.audio-editor-macros-palette__content')).toHaveCSS('display', 'grid');
		await expect(manager.locator('.audio-editor-macros-palette__content')).toHaveCSS('grid-template-columns', /^240px /u);
		await expect(manager.locator('[data-macro-id][aria-current="true"]')).toHaveCSS('min-height', '40px');
	});

	test('Tools > Macros lists the saved macros instead of fixed placeholders', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const manager = await openManager(page, editor);
		await expect(manager.locator('[data-macro-id]')).toHaveText(['Restoration', 'Fade ends']);
		await closeDialog(manager);
		await editor.getByRole('menubar', { name: 'Application menu' })
			.getByRole('menuitem', { name: 'Tools', exact: true }).click();
		const macrosItem = page.getByRole('menu', { name: 'Tools', exact: true })
			.getByRole('menuitem', { name: /^Macros\s+▸$/u });
		await macrosItem.press('ArrowRight');
		const macros = macrosItem.getByRole('menu');
		await expect(macros).toBeVisible();

		await expect(macros.getByRole('menuitem')).toHaveCount(2);
		await expect(macros.getByRole('menuitem', { name: /^Restoration(?:\s|—)/u })).toBeDisabled();
		await expect(macros.getByRole('menuitem', { name: 'Fade ends', exact: true })).toBeEnabled();
		await expect(macros.getByRole('menuitem', { name: 'Apply macro', exact: true })).toHaveCount(0);
		await expect(macros.getByRole('menuitem', { name: 'MP3 conversion', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('default macros are selected and edited in place, and deleted defaults stay deleted', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		let manager = await openManager(page, editor);
		const macros = () => manager.locator('[data-macro-list]');
		await expect(macros().getByRole('button')).toHaveText(['Restoration', 'Fade ends']);
		await expect(manager.locator('[data-macro-templates]')).toHaveCount(0);
		await expect(manager.getByRole('heading', { name: 'Built-in templates', exact: true })).toHaveCount(0);

		await macros().getByRole('button', { name: 'Fade ends', exact: true }).click();
		await expect(manager.getByLabel('Macro name', { exact: true })).toHaveValue('Fade ends');
		await expect(manager.locator('.effect-slot__name-text')).toHaveText(FADE_STEPS);
		await macros().getByRole('button', { name: 'Restoration', exact: true }).click();
		await expect(manager.locator('.effect-slot__name-text')).toHaveText([
			'Click Removal', 'Noise Reduction', 'Filter Curve EQ',
		]);
		await macros().getByRole('button', { name: 'Fade ends', exact: true }).click();
		await expect(macros().getByRole('button')).toHaveText(['Restoration', 'Fade ends']);
		await commitInput(manager.getByLabel('Macro name', { exact: true }), 'My fades');
		await expect(macros().getByRole('button')).toHaveText(['Restoration', 'My fades']);
		await macros().getByRole('button', { name: 'Restoration', exact: true }).click();
		await manager.getByRole('button', { name: 'Delete macro', exact: true }).click();
		await expect(macros().getByRole('button')).toHaveText(['My fades']);

		await page.reload();
		editor = await waitForEditor(page);
		manager = await openManager(page, editor);
		await expect(macros().getByRole('button')).toHaveText(['My fades']);
		await expect(manager.getByLabel('Macro name', { exact: true })).toHaveValue('My fades');
		await expect(manager.locator('.effect-slot__name-text')).toHaveText(FADE_STEPS);
		await manager.getByRole('button', { name: 'Delete macro', exact: true }).click();
		await expect(manager.locator('[data-macro-library-empty]')).toBeVisible();
		await expect(manager.getByRole('button', { name: 'Delete macro', exact: true })).toBeDisabled();

		await page.reload();
		editor = await waitForEditor(page);
		manager = await openManager(page, editor);
		await expect(manager.locator('[data-macro-library-empty]')).toBeVisible();
		await expect(manager.locator('[data-macro-id]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('programs use the same icon actions for creation, file sharing, and deletion', async ({ page }, testInfo) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		let manager = await openManager(page, editor);
		const programs = () => manager.locator('[data-macro-programs]');
		const actions = () => programs().locator('header').getByRole('button');
		await expect(actions()).toHaveCount(4);
		for (const label of ['New program', 'Import program', 'Export program', 'Delete program']) {
			const button = programs().locator('header').getByRole('button', { name: label, exact: true });
			await expect(button).toBeVisible();
			await expect(button.locator('.icon[aria-hidden="true"]')).toHaveCount(1);
		}
		await expect(programs().getByRole('button', { name: 'New program', exact: true })).toHaveCount(1);
		await expect(programs().getByRole('button', { name: 'Export program', exact: true })).toBeDisabled();
		await expect(programs().getByRole('button', { name: 'Delete program', exact: true })).toBeDisabled();
		await programs().getByRole('button', { name: 'New program', exact: true }).click();
		await expect(manager.getByLabel('Program name', { exact: true })).toHaveValue('New program');
		await commitInput(manager.getByLabel('Program name', { exact: true }), 'My program');
		const source = "sound.log.info('my program');";
		await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
		await expect(programs().locator('[data-macro-script-id]')).toHaveText(['My program']);
		await manager.screenshot({ path: testInfo.outputPath('macro-manager-program-actions.png') });

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			programs().getByRole('button', { name: 'Export program', exact: true }).click(),
		]);
		expect(download.suggestedFilename()).toBe('My-program.soundscapemacro');
		const downloadPath = await download.path();
		expect(downloadPath).not.toBeNull();
		const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
		expect(exported).toMatchObject({ kind: 'script', name: 'My program', source });

		await programs().getByRole('button', { name: 'Delete program', exact: true }).click();
		await expect(programs().locator('[data-macro-script-id]')).toHaveCount(0);
		await expect(manager.locator('[data-macro-script-source]')).toHaveCount(0);
		await expect(programs().getByRole('button', { name: 'Delete program', exact: true })).toBeDisabled();
		await expect(manager.locator('[data-macro-id]')).toHaveText(['Restoration', 'Fade ends']);
		const [fileChooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			programs().getByRole('button', { name: 'Import program', exact: true }).click(),
		]);
		await fileChooser.setFiles({
			name: 'My-program.soundscapemacro',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(exported)),
		});
		await expect(manager.getByLabel('Program name', { exact: true })).toHaveValue('My program');
		await expect(manager.getByRole('textbox', { name: 'Program', exact: true })).toHaveValue(source);
		await expect(programs().locator('[data-macro-script-id]')).toHaveCount(1);
		await expect(programs().locator('[data-macro-script-id]')).toHaveAttribute('data-macro-script-trust', 'imported-untrusted');
		await programs().getByRole('button', { name: 'Delete program', exact: true }).click();

		await page.reload();
		editor = await waitForEditor(page);
		manager = await openManager(page, editor);
		await expect(programs().locator('[data-macro-script-id]')).toHaveCount(0);
		await expect(programs().getByRole('button', { name: 'Delete program', exact: true })).toBeDisabled();
		expect(errors).toEqual([]);
	});
});
