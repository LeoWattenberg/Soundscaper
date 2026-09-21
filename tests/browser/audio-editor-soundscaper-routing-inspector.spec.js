/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { test, toneA } from './audio-editor-test-fixtures.js';

import {
	addRackEffect,
	bootEditor,
	chooseNestedCommandAction,
	closeDialog,
	closeEffectsPanel,
	collectClientErrors,
	importFiles,
	openEffectsForTrack,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper routing inspector', () => {
	registerAudioEditorHooks();

	test('edits and removes cue, output, and VCA nodes through their inspectors', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const graph = await openRoutingGraph(page, editor);
		const initialEdgeCount = await graph.locator('[data-routing-edge]').count();

		const cue = await addRoutingNode(graph, 'cue', 'mixer-node');
		await cue.locator('.kw-routing-graph__node-main').press('Enter');
		let inspector = graph.locator('[data-routing-inspector="node"]');
		await expect(inspector).toBeVisible();
		await inspector.getByLabel('Name', { exact: true }).fill('Dialogue Cue');
		await inspector.getByLabel('Channels', { exact: true }).fill('1');
		await inspector.getByRole('button', { name: 'Save node', exact: true }).click();
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Routing graph updated');
		await expect(cue).toContainText('Dialogue Cue');
		await expect(cue).toContainText('1 ch');

		await inspector.locator('select[name="destination"]').selectOption(JSON.stringify({ kind: 'master' }));
		await inspector.getByRole('button', { name: 'Add connection', exact: true }).click();
		await expect(graph.locator('[data-routing-edge]')).toHaveCount(initialEdgeCount + 1);
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');

		await cue.locator('.kw-routing-graph__node-main').press('Enter');
		inspector = graph.locator('[data-routing-inspector="node"]');
		await inspector.getByRole('button', { name: 'Delete node', exact: true }).click();
		await expect(inspector.getByRole('alert')).toContainText('1 incident connections');
		await inspector.getByRole('alert').getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(cue).toBeVisible();
		await inspector.getByRole('button', { name: 'Delete node', exact: true }).click();
		await inspector.getByRole('alert').getByRole('button', { name: 'Confirm delete', exact: true }).click();
		await expect(cue).toHaveCount(0);
		await expect(graph.locator('[data-routing-edge]')).toHaveCount(initialEdgeCount);

		const output = await addRoutingNode(graph, 'output', 'output');
		await output.locator('.kw-routing-graph__node-main').press('Enter');
		inspector = graph.locator('[data-routing-inspector="output"]');
		await inspector.getByLabel('Name', { exact: true }).fill('Studio Cue');
		await inspector.locator('select[name="role"]').selectOption('control-room');
		await inspector.getByLabel('Channels', { exact: true }).fill('1');
		await inspector.getByRole('button', { name: 'Save output', exact: true }).click();
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Routing graph updated');
		await expect(output).toContainText('Studio Cue');
		await expect(output).toContainText('1 ch');
		await inspector.getByRole('button', { name: 'Delete output', exact: true }).click();
		await expect(inspector.getByRole('alert')).toContainText('1 incident connections');
		await inspector.getByRole('alert').getByRole('button', { name: 'Confirm delete', exact: true }).click();
		await expect(output).toHaveCount(0);
		await expect(graph.locator('[data-routing-edge]')).toHaveCount(initialEdgeCount);
		await expect(inspector).toHaveCount(0);

		const mainOutput = graph.locator('[data-routing-node^="output:"]').first();
		await mainOutput.locator('.kw-routing-graph__node-main').press('Enter');
		inspector = graph.locator('[data-routing-inspector="output"]');
		await inspector.locator('select[name="role"]').selectOption('auxiliary');
		await inspector.getByRole('button', { name: 'Save output', exact: true }).click();
		await expect(graph.getByRole('alert')).toContainText('exactly one main output');

		const vca = await addRoutingNode(graph, 'vca', 'vca');
		await vca.locator('.kw-routing-graph__node-main').press('Enter');
		inspector = graph.locator('[data-routing-inspector="vca"]');
		await inspector.getByLabel('Name', { exact: true }).fill('Dialogue Control');
		await inspector.getByLabel('Gain', { exact: true }).fill('0.75');
		await inspector.getByRole('checkbox', { name: 'Mute', exact: true }).check();
		await inspector.locator('input[name="member"]').first().check();
		await inspector.getByRole('button', { name: 'Save VCA', exact: true }).click();
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Routing graph updated');
		await expect(vca).toContainText('Dialogue Control');
		await expect(graph.locator('[data-routing-vca-relation]')).toHaveCount(1);
		await inspector.getByRole('button', { name: 'Delete vca', exact: true }).click();
		await expect(inspector.getByRole('alert')).toContainText('1 memberships');
		await inspector.getByRole('alert').getByRole('button', { name: 'Confirm delete', exact: true }).click();
		await expect(vca).toHaveCount(0);
		await expect(graph.locator('[data-routing-vca-relation]')).toHaveCount(0);
		expect(clientErrors).toEqual([]);
	});

	test('keeps selected routing items safe while project undo removes and restores them', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const graph = await openRoutingGraph(page, editor);
		const undo = editor.getByRole('button', { name: 'Undo', exact: true });
		const redo = editor.getByRole('button', { name: 'Redo', exact: true });

		const cue = await addRoutingNode(graph, 'cue', 'mixer-node');
		await cue.locator('.kw-routing-graph__node-main').press('Enter');
		await undo.click();
		await expect(cue).toHaveCount(0);
		await expect(graph.getByText('The selected node no longer exists.', { exact: true })).toBeVisible();
		await redo.click();
		await expect(cue).toBeVisible();

		const output = await addRoutingNode(graph, 'output', 'output');
		await output.locator('.kw-routing-graph__node-main').press('Enter');
		await undo.click();
		await expect(output).toHaveCount(0);
		await expect(graph.getByText('The selected output no longer exists.', { exact: true })).toBeVisible();
		await redo.click();
		await expect(output).toBeVisible();

		const vca = await addRoutingNode(graph, 'vca', 'vca');
		await vca.locator('.kw-routing-graph__node-main').press('Enter');
		await undo.click();
		await expect(vca).toHaveCount(0);
		await expect(graph.getByText('The selected VCA no longer exists.', { exact: true })).toBeVisible();
		await redo.click();
		await expect(vca).toBeVisible();

		await graph.locator('[data-routing-source^="track:"]').first().press('Enter');
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Choose a destination');
		const edgeIds = new Set(await graph.locator('[data-routing-edge]').evaluateAll((edges) => (
			edges.map((edge) => edge.getAttribute('data-routing-edge'))
		)));
		await graph.locator('[data-routing-destination="master"]').press('Enter');
		const addedEdgeId = (await graph.locator('[data-routing-edge]').evaluateAll((edges) => (
			edges.map((edge) => edge.getAttribute('data-routing-edge'))
		))).find((id) => !edgeIds.has(id));
		expect(addedEdgeId).toBeTruthy();
		const addedEdge = graph.locator(`[data-routing-edge="${addedEdgeId}"]`);
		await undo.click();
		await expect(addedEdge).toHaveCount(0);
		await expect(graph.getByText('The selected connection no longer exists.', { exact: true })).toBeVisible();
		await redo.click();
		await expect(addedEdge).toBeVisible();
		expect(clientErrors).toEqual([]);
	});

	test('authors a sidechain and edits its connection through the shipped effect and graph UI', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const effectsPanel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, effectsPanel, 'track', 'Gate');
		await closeDialog(page.getByRole('dialog', { name: 'Gate', exact: true }));
		await closeEffectsPanel(effectsPanel);

		const graph = await openRoutingGraph(page, editor);
		await expect(graph.locator('[data-routing-node^="track:"]')).toHaveCount(2);
		const sidechainDestination = graph.locator('[data-routing-destination*="effect-sidechain"]').first();
		await expect(sidechainDestination).toBeVisible();
		const endpoint = JSON.parse(await sidechainDestination.getAttribute('data-routing-destination'));
		const sources = graph.locator('[data-routing-source^="track:"]');
		const sourceKeys = await sources.evaluateAll((ports) => ports.map((port) => port.getAttribute('data-routing-source')));
		const sourceIndex = sourceKeys.findIndex((key) => key !== `track:${endpoint.strip.id}`);
		expect(sourceIndex).toBeGreaterThanOrEqual(0);
		const source = sources.nth(sourceIndex);
		const edges = graph.locator('[data-routing-edge]');
		const edgeIdsBefore = new Set(await edges.evaluateAll((buttons) => (
			buttons.map((button) => button.getAttribute('data-routing-edge'))
		)));

		await source.press('Enter');
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Choose a destination');
		await sidechainDestination.press('Enter');
		await expect(edges).toHaveCount(edgeIdsBefore.size + 1);
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');
		const edgeId = (await edges.evaluateAll((buttons) => (
			buttons.map((button) => button.getAttribute('data-routing-edge'))
		))).find((id) => !edgeIdsBefore.has(id));
		expect(edgeId).toBeTruthy();

		const edge = graph.locator(`[data-routing-edge="${edgeId}"]`);
		await edge.click();
		const inspector = graph.locator('[data-routing-inspector="edge"]');
		await expect(inspector.locator('select[name="kind"]')).toHaveValue('sidechain');
		await expect(inspector.locator('select[name="kind"]')).toBeDisabled();
		await inspector.locator('select[name="position"]').selectOption('pre-fader');
		const level = inspector.getByLabel('Level (dB)', { exact: true });
		await level.focus();
		await level.fill('-6');
		await level.blur();
		await inspector.getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
		await inspector.locator('select[name="map-0"]').selectOption('1');
		await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Routing graph updated');
		await expect(edge).toHaveClass(/is-disabled/u);
		await expect(edge).toHaveAttribute('aria-label', /sidechain.*pre-fader.*Disabled/u);
		await expect(inspector.locator('p').first()).toContainText('-6 dB');
		await expect(inspector.locator('select[name="map-0"]')).toHaveValue('1');

		await inspector.getByRole('button', { name: 'Reset channel map', exact: true }).click();
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Routing graph updated');
		await expect(inspector.locator('select[name="map-0"]')).toHaveValue('0');

		const sourceKey = sourceKeys[sourceIndex];
		await graph.locator(`[data-routing-node="${sourceKey}"] .kw-routing-graph__node-main`).press('Enter');
		const stripInspector = graph.locator('[data-routing-inspector="track"]');
		await expect(stripInspector).toContainText('Managed by the project');
		const edgeCount = await edges.count();
		await stripInspector.locator('select[name="destination"]').selectOption(JSON.stringify({ kind: 'master' }));
		await stripInspector.getByRole('button', { name: 'Add connection', exact: true }).click();
		await expect(edges).toHaveCount(edgeCount + 1);
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');
		expect(clientErrors).toEqual([]);
	});
});

async function openRoutingGraph(page, editor) {
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	const toggle = mixer.getByRole('button', { name: 'Routing graph', exact: true });
	if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
	const graph = mixer.locator('[data-soundscaper-routing-graph]');
	await expect(graph).toBeVisible();
	return graph;
}

async function addRoutingNode(graph, kind, keyPrefix) {
	const nodes = graph.locator(`[data-routing-node^="${keyPrefix}:"]`);
	const known = new Set(await nodes.evaluateAll((items) => items.map((item) => item.getAttribute('data-routing-node'))));
	await graph.getByLabel('Add routing node', { exact: true }).selectOption(kind);
	await expect(graph.locator('.kw-routing-graph__status')).toContainText('Routing item added');
	await expect(nodes).toHaveCount(known.size + 1);
	const key = (await nodes.evaluateAll((items) => items.map((item) => item.getAttribute('data-routing-node'))))
		.find((candidate) => !known.has(candidate));
	expect(key).toBeTruthy();
	return graph.locator(`[data-routing-node="${key}"]`);
}
