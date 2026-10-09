/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeWorkspacePanel,
	importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test.describe('ordinary cycle take media ownership', () => {
	registerAudioEditorHooks();
	test('removing a placed recorded take from Project bin preserves its editable take lane', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await installOscillatorMicrophone(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		const options = page.getByRole('dialog', { name: 'Record options', exact: true });
		await options.getByRole('button', { name: 'Record loop into takes', exact: true }).click();
		await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button'))
			.toHaveAttribute('aria-pressed', 'true');
		const start = await page.evaluate(() => globalThis.__complexWorkflowStreams.at(-1).context.currentTime);
		await expect.poll(() => page.evaluate(() => globalThis.__complexWorkflowStreams.at(-1).context.currentTime)).toBeGreaterThan(start + 1.1);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect.poll(async () => (await persistedProject(page, await editor.getAttribute('data-project-id'))).takeGroups.length).toBe(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
		expect(project.takeGroups).toHaveLength(1);
		const group = project.takeGroups[0];
		expect(group.takes.length).toBeGreaterThan(0);
		const sourceId = group.takes[0].sourceId;
		const placementTrack = project.tracks.find(candidate => candidate.type === 'audio' && candidate.id !== group.trackId);
		expect(placementTrack).toBeDefined();
		const track = editor.locator(`[data-track-row][data-track-id="${group.trackId}"]`);
		await chooseTrackMenuAction(page, editor, track, 'Take lanes and comps');
		const takes = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
		await expect(takes.getByRole('button', { name: /^Audition /u }).first()).toBeEnabled();
		await page.keyboard.press('Escape');
		await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
		const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
		await grid.focus();
		await page.keyboard.press('Escape');
		await page.evaluate(text => navigator.clipboard.writeText(text), ['Placed take', placementTrack.id, '2', sourceId, '0', '0.05'].join('\t'));
		await page.keyboard.press('ControlOrMeta+v');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await closeWorkspacePanel(editor, 'clip-spreadsheet');
		const clip = clipByName(editor, 'Placed take');
		await clip.locator('.clip-header').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		const card = editor.getByRole('listitem', { name: 'Project bin: Placed take', exact: true });
		await expect(card).toBeVisible();
		await card.locator('.kw-audio-editor__project-bin-overflow').click();
		await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
		const confirmation = page.getByRole('alertdialog', { name: 'Remove from project', exact: true });
		await confirmation.getByRole('button', { name: 'Remove from project', exact: true }).click();
		await expect(card).toHaveCount(0);
		await chooseTrackMenuAction(page, editor, track, 'Take lanes and comps');
		await expect(takes.getByRole('button', { name: /^Audition /u }).first()).toBeEnabled();
		await takes.getByRole('button', { name: /^Audition /u }).first().click();
		await expect(takes.getByRole('status').last()).not.toContainText('missing source');
	});
});
