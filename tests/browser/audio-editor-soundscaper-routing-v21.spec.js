/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper V21 structured routing editor', () => {
	registerAudioEditorHooks();

	test('authors collections, endpoints, maps, and VCA membership as one full graph operation', async ({ browserName, page }) => {
		test.setTimeout(90_000);
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.locator('[data-editor-surface="soundscaper-production"]')).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Routing graph', exact: true })).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		const track = editor.locator('[data-track-row]').last();
		await track.locator('[data-track-header]').click();
		const trackId = await track.getAttribute('data-track-id');
		expect(trackId).toBeTruthy();

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		const history = editor.locator('[data-workspace-panel="history"]');
		await expect(history).toBeVisible();
		const historyBefore = await history.locator('[data-history-list] > li').count();

		const viewTrigger = applicationMenuTrigger(editor, 'View');
		let dialog = await openRoutingEditor(page, editor);
		await expect(dialog.getByRole('tab', { name: 'Routing graph', exact: true })).toBeFocused();
		await expect(dialog.locator('[data-soundscaper-routing-editor="structured"]')).toBeVisible();
		await expect(dialog.getByText('Mixer node collections', { exact: true })).toBeVisible();
		await expect(dialog.getByText('Output placeholders', { exact: true })).toBeVisible();
		await expect(dialog.getByText('VCA membership', { exact: true })).toBeVisible();
		await expect(dialog.getByText('Routing edges', { exact: true })).toBeVisible();
		const advanced = dialog.getByText('Advanced canonical JSON', { exact: true });
		await expect(advanced).toBeVisible();
		await expect(dialog.getByRole('textbox', { name: 'Canonical mixer graph document', exact: true })).toBeHidden();
		const operationStatus = dialog.getByRole('status').last();
		await expect(operationStatus).toHaveAttribute('aria-live', 'polite');
		await expect(operationStatus).toHaveAttribute('aria-atomic', 'true');
		await assertAccessibleBasics(dialog);
		await page.emulateMedia({ forcedColors: 'active' });
		await expect(dialog).toHaveCSS('border-top-style', 'solid');
		// WebKit does not implement forced-color-adjust, so its computed value is
		// empty there rather than the inherited 'auto'.
		if (browserName !== 'webkit') {
			await expect(dialog).toHaveCSS('forced-color-adjust', 'auto');
			await expect(dialog.locator('[data-soundscaper-routing-editor="structured"]'))
				.toHaveCSS('forced-color-adjust', 'auto');
		}
		await page.emulateMedia({ forcedColors: 'none' });
		await assertNoSeriousAxeViolations(page, '[data-soundscaper-production-dialog]');

		const group = dialog.getByRole('form', { name: 'Add Groups node', exact: true });
		await group.getByRole('textbox', { name: 'Node ID', exact: true }).fill('dialogue');
		await group.getByRole('textbox', { name: 'Node name', exact: true }).fill('Dialogue');
		await group.getByRole('spinbutton', { name: 'Channel count', exact: true }).fill('2');
		await group.getByRole('button', { name: 'Add Groups node', exact: true }).click();
		const draftStatus = dialog.getByText(
			'Structured routing draft updated. Apply the routing graph to commit it.', { exact: true },
		);
		await expect(draftStatus).toBeVisible();
		await expect(draftStatus).toHaveAttribute('role', 'status');

		const vca = dialog.getByRole('form', { name: 'Add VCA', exact: true });
		await vca.getByRole('textbox', { name: 'VCA ID', exact: true }).fill('all');
		await vca.getByRole('textbox', { name: 'VCA name', exact: true }).fill('All');
		await vca.getByRole('checkbox', { name: /^Track:/u }).first().check();
		await vca.getByRole('button', { name: 'Add VCA', exact: true }).click();

		// The map is destination-indexed: entry i names the source channel feeding
		// destination channel i. So reading channel 2 of a stereo track is a source error,
		// and only a map longer than the destination is a destination error.
		const badEdge = dialog.getByRole('form', { name: 'Add routing edge', exact: true });
		await badEdge.getByRole('textbox', { name: 'Edge ID', exact: true }).fill('bad-map');
		await badEdge.getByRole('combobox', { name: 'Destination endpoint', exact: true }).selectOption({ label: 'Group: Dialogue' });
		await badEdge.getByRole('textbox', { name: /Channel map/u }).fill('0, 2');
		await badEdge.getByRole('button', { name: 'Add routing edge', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('channel map reads a missing source channel');
		await expect(dialog.getByRole('button', { name: 'Apply routing graph', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Remove edge bad-map', exact: true }).click();
		await expect(dialog.getByRole('alert')).toHaveCount(0);

		const wideEdge = dialog.getByRole('form', { name: 'Add routing edge', exact: true });
		await wideEdge.getByRole('textbox', { name: 'Edge ID', exact: true }).fill('wide-map');
		await wideEdge.getByRole('combobox', { name: 'Destination endpoint', exact: true }).selectOption({ label: 'Group: Dialogue' });
		await wideEdge.getByRole('textbox', { name: /Channel map/u }).fill('0, 1, 0, 1');
		await wideEdge.getByRole('button', { name: 'Add routing edge', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('channel map exceeds its destination width');
		await expect(dialog.getByRole('button', { name: 'Apply routing graph', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Remove edge wide-map', exact: true }).click();
		await expect(dialog.getByRole('alert')).toHaveCount(0);

		const edge = dialog.getByRole('form', { name: 'Add routing edge', exact: true });
		await edge.getByRole('textbox', { name: 'Edge ID', exact: true }).fill('track-dialogue');
		await edge.getByRole('combobox', { name: 'Destination endpoint', exact: true }).selectOption({ label: 'Group: Dialogue' });
		await edge.getByRole('textbox', { name: /Channel map/u }).fill('0, 1');
		await edge.getByRole('combobox', { name: 'Edge position', exact: true }).selectOption('pre-fader');
		await edge.getByRole('button', { name: 'Add routing edge', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Apply routing graph', exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Apply routing graph', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Production audio change complete.');
		await expect(history.locator('[data-history-list] > li')).toHaveCount(historyBefore + 1);

		await advanced.click();
		const graph = JSON.parse(await dialog
			.getByRole('textbox', { name: 'Canonical mixer graph document', exact: true }).inputValue());
		expect(graph.groups.map(({ id }) => id)).toContain('dialogue');
		expect(graph.vcas.find(({ id }) => id === 'all').members).toHaveLength(1);
		expect(graph.edges.find(({ id }) => id === 'track-dialogue')).toMatchObject({
			position: 'pre-fader', channelMap: [0, 1],
		});

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(viewTrigger).toBeFocused();

		await historyButton(editor, 'Undo').click();
		dialog = await openRoutingEditor(page, editor);
		expect((await routingGraph(dialog)).groups.map(({ id }) => id)).not.toContain('dialogue');
		await page.keyboard.press('Escape');
		await expect(viewTrigger).toBeFocused();
		await historyButton(editor, 'Redo').click();
		dialog = await openRoutingEditor(page, editor);
		expect((await routingGraph(dialog)).groups.map(({ id }) => id)).toContain('dialogue');
		await page.keyboard.press('Escape');
		await expect(viewTrigger).toBeFocused();

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const reopened = await bootEditor(page, `/embed/en/?project=${encodeURIComponent(projectId)}`);
		await expect(reopened).toHaveAttribute('data-project-id', projectId);
		const reopenedTrack = reopened.locator(`[data-track-row][data-track-id="${trackId}"]`);
		await reopenedTrack.locator('[data-track-header]').click();
		dialog = await openRoutingEditor(page, reopened);
		const reopenedGraph = await routingGraph(dialog);
		expect(reopenedGraph.groups.map(({ id }) => id)).toContain('dialogue');
		expect(reopenedGraph.vcas.find(({ id }) => id === 'all').members).toHaveLength(1);
		expect(reopenedGraph.edges.find(({ id }) => id === 'track-dialogue')).toMatchObject({
			position: 'pre-fader', channelMap: [0, 1],
		});
		expect(clientErrors).toEqual([]);
	});
});

async function openRoutingEditor(page, editor) {
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Routing graph…']);
	const dialog = page.getByRole('dialog', { name: 'Production audio', exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('tab', { name: 'Routing graph', exact: true })).toBeFocused();
	return dialog;
}

async function routingGraph(dialog) {
	const advanced = dialog.getByText('Advanced canonical JSON', { exact: true });
	if (!(await dialog.getByRole('textbox', { name: 'Canonical mixer graph document', exact: true }).isVisible())) {
		await advanced.click();
	}
	return JSON.parse(await dialog
		.getByRole('textbox', { name: 'Canonical mixer graph document', exact: true }).inputValue());
}

function applicationMenuTrigger(editor, label) {
	return editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: label, exact: true });
}

function historyButton(editor, label) {
	return editor.locator('[data-action-bar]')
		.getByRole('button', { name: label, exact: true });
}
