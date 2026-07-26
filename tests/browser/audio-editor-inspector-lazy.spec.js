import { expect, test } from '@playwright/test';

const TRANSLATIONS_ROOT = 'https://translations.soundscaper.org/runtime/translations/audacity/4';
const INSPECTOR_FEATURE_CHUNKS = Object.freeze([
	'AnalysisPanel',
	'AudioEditorEffectsOverlay',
	'AudioEditorMacroManagerDialog',
	'ClipPropertiesDialog',
	'ExportDialog',
	'SelectionEffectsDialog',
]);

test.describe('Inspector lazy feature boundaries', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: JSON.stringify({ schemaVersion: 1, locales: {} }),
		}));
	});

	test('opening Analysis loads its entry without preloading sibling Inspector features', async ({ page }) => {
		const requestedScripts = collectRequestedScripts(page);
		const editor = await bootEditorWithTone(page);
		requestedScripts.length = 0;

		await chooseCommand(page, editor, 'Analyze', 'Analysis');
		await expect(editor.locator('[data-workspace-panel="analysis"]')).toBeVisible();
		await expect.poll(() => requestedScripts.some((name) => name.startsWith('AnalysisPanel-'))).toBe(true);
		expectLoadedOnly(requestedScripts, 'AnalysisPanel');
	});

	test('opening Export loads its entry without preloading sibling Inspector features', async ({ page }) => {
		const requestedScripts = collectRequestedScripts(page);
		const editor = await bootEditorWithTone(page);
		requestedScripts.length = 0;

		await chooseCommand(page, editor, 'File', 'Export audio');
		await expect(page.getByRole('dialog', { name: 'Export audio', exact: true })).toBeVisible();
		await expect.poll(() => requestedScripts.some((name) => name.startsWith('ExportDialog-'))).toBe(true);
		expectLoadedOnly(requestedScripts, 'ExportDialog');
	});
});

function collectRequestedScripts(page) {
	const requestedScripts = [];
	page.on('response', (response) => {
		const name = new URL(response.url()).pathname.split('/').at(-1) || '';
		if (name.endsWith('.js')) requestedScripts.push(name);
	});
	return requestedScripts;
}

function expectLoadedOnly(requestedScripts, expectedFeature) {
	for (const feature of INSPECTOR_FEATURE_CHUNKS) {
		if (feature === expectedFeature) continue;
		expect(requestedScripts.some((name) => name.startsWith(`${feature}-`)), requestedScripts.join('\n')).toBe(false);
	}
}

async function bootEditorWithTone(page) {
	await page.goto('/embed/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();

	await chooseCommand(page, editor, 'Generate', 'Tone');
	const generator = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = generator.locator('[data-generator-field="durationSeconds"] input');
	await duration.fill('0.05');
	await duration.press('Tab');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	return editor;
}

async function chooseCommand(page, editor, menuName, commandName) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await expect(menu).toBeVisible();
	const escapedName = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const command = menu.getByRole('menuitem', { name: new RegExp(`^${escapedName}(?:\\s|$)`) }).first();
	await command.focus();
	await page.keyboard.press('Enter');
}
