/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const DATABASE_NAME = 'kw-media-framescaper-editor-v18';

test.describe('Framescaper V18 nested-sequence authoring', () => {
	registerAudioEditorHooks();

	test('creates, places, moves, reopens, removes, and deletes through Tracks', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/framescaper/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		await nestedAction(page, editor, 'Create shared sequence');
		await assertNestedMenuAccessibility(page, editor);
		await saveProject(page, editor);
		await expect.poll(() => storedNestedState(page, projectId)).toMatchObject({
			sequenceIds: ['main-sequence', 'shared-sequence-1'],
			subsequences: [],
			requirementIds: [],
		});

		await nestedAction(page, editor, 'Add nested placement');
		await saveProject(page, editor);
		await expect.poll(() => storedNestedState(page, projectId)).toMatchObject({
			sequenceIds: ['main-sequence', 'shared-sequence-1'],
			subsequences: [{
				id: 'nested-main-sequence-shared-sequence-1-1',
				sequenceId: 'main-sequence',
				sourceSequenceId: 'shared-sequence-1',
				sequenceStartFrame: 0,
				sequenceFrameCount: 30,
				sourceInFrame: 0,
				sourceFrameCount: 30,
			}],
			requirementIds: ['framescaper.nested-sequences'],
		});

		await nestedAction(page, editor, 'Move nested sequence');
		await saveProject(page, editor);
		await expect.poll(() => storedNestedState(page, projectId)).toMatchObject({
			subsequences: [{ sequenceStartFrame: 30 }],
			requirementIds: ['framescaper.nested-sequences'],
		});

		await page.reload();
		editor = await readyFramescaper(page, projectId);
		await expect.poll(() => storedNestedState(page, projectId)).toMatchObject({
			sequenceIds: ['main-sequence', 'shared-sequence-1'],
			subsequences: [{ sequenceStartFrame: 30 }],
		});

		await nestedAction(page, editor, 'Remove nested sequence');
		await saveProject(page, editor);
		await expect.poll(() => storedNestedState(page, projectId)).toMatchObject({
			sequenceIds: ['main-sequence', 'shared-sequence-1'],
			subsequences: [],
			requirementIds: [],
		});

		await nestedAction(page, editor, 'Delete shared sequence');
		await saveProject(page, editor);
		await expect.poll(() => storedNestedState(page, projectId)).toMatchObject({
			sequenceIds: ['main-sequence'],
			subsequences: [],
			requirementIds: [],
		});
		expect(errors).toEqual([]);
	});
});

async function assertNestedMenuAccessibility(page, editor) {
	await page.emulateMedia({ forcedColors: 'active' });
	const tracks = editor.getByRole('menubar', { name: /^(Application menu|Anwendungsmenü)$/ })
		.getByRole('menuitem', { name: 'Tracks', exact: true });
	await tracks.click();
	const tracksMenu = page.getByRole('menu', { name: 'Tracks', exact: true });
	const nested = tracksMenu.getByRole('menuitem', { name: /^Nested sequences(?:\s|$)/u });
	await nested.focus();
	await page.keyboard.press('ArrowRight');
	const submenu = nested.getByRole('menu');
	await expect(submenu).toBeVisible();
	await submenu.evaluate((element) => { element.id = 'framescaper-nested-accessibility-menu'; });
	await assertAccessibleBasics(submenu);
	await assertNoSeriousAxeViolations(page, '#framescaper-nested-accessibility-menu');
	await expect(submenu.getByRole('menuitem', { name: /^Create shared sequence(?:\s|$)/u }))
		.toHaveCSS('forced-color-adjust', 'auto');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await page.emulateMedia({ forcedColors: 'none' });
}

async function nestedAction(page, editor, action) {
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', action]);
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
}

async function saveProject(page, editor) {
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}

async function readyFramescaper(page, projectId) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	await expect(editor).toHaveAttribute('data-product', 'framescaper');
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function storedNestedState(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error || new Error(`Could not open ${databaseName}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				const project = request.result;
				database.close();
				resolve(project ? {
					sequenceIds: project.sequences.map(({ id: sequenceId }) => sequenceId),
					subsequences: project.subsequences,
					requirementIds: project.featureRequirements.requirements
						.map(({ id: requirementId }) => requirementId)
						.filter((requirementId) => requirementId === 'framescaper.nested-sequences'),
				} : null);
			};
		};
	}), { databaseName: DATABASE_NAME, id: projectId });
}
