/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
	setDocumentTheme,
} from './audio-editor-test-helpers.js';

test.describe('Soundscaper mixer routing graph', () => {
	registerAudioEditorHooks();

	test('opts into a spatial graph with pointer and keyboard editing, validation, and focused inspectors', async ({ page }) => {
		const clientErrors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const mixer = editor.locator('[data-mixer-panel]');
		const toggle = mixer.getByRole('button', { name: 'Routing graph', exact: true });
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await expect(mixer.locator('[data-soundscaper-routing-graph]')).toHaveCount(0);

		await toggle.click();
		await expect(mixer.getByRole('button', { name: 'Channel strips', exact: true })).toHaveAttribute('aria-pressed', 'true');
		const graph = mixer.locator('[data-soundscaper-routing-graph]');
		await expect(graph).toBeVisible();
		await expect(graph.locator('[data-routing-node^="track:"]')).toHaveCount(1);
		await expect(graph.locator('[data-routing-node="master"]')).toBeVisible();
		await expect(graph.locator('[data-routing-node^="output:"]')).toBeVisible();
		await expect(mixer.locator('.mixer-panel')).toHaveCount(0);

		const edgesBefore = await graph.locator('[data-routing-edge]').count();
		await graph.locator('[data-routing-source^="track:"]').press('Enter');
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Choose a destination');
		await graph.locator('[data-routing-destination="master"]').press('Enter');
		await expect(graph.locator('[data-routing-edge]')).toHaveCount(edgesBefore + 1);
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');

		await graph.locator('[data-routing-edge]').first().click();
		const inspector = graph.getByRole('complementary', { name: 'Connection inspector', exact: true });
		await expect(inspector.getByText('Channel map', { exact: true })).toBeVisible();
		await expect(inspector.getByText('Technical details', { exact: true })).toBeVisible();
		await expect(graph.locator('textarea')).toHaveCount(0);

		await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
		const group = graph.locator('[data-routing-node^="mixer-node:"]');
		await expect(group).toHaveCount(1);
		const groupKey = await group.getAttribute('data-routing-node');
		expect(groupKey).toBeTruthy();
		await graph.locator('[data-routing-source="master"]').press('Enter');
		await graph.locator(`[data-routing-destination="${groupKey}"]`).press('Enter');
		await expect(graph.getByRole('alert')).toContainText('routing cycle');
		await expect(graph.locator('[data-routing-edge]')).toHaveCount(edgesBefore + 2);

		const edgeIdsBeforePointer = new Set(await graph.locator('[data-routing-edge]').evaluateAll((edges) => (
			edges.map((edge) => edge.getAttribute('data-routing-edge'))
		)));
		const sourcePort = graph.locator('[data-routing-source^="track:"]');
		const destinationPort = graph.locator(`[data-routing-destination="${groupKey}"]`);
		const sourceBox = await sourcePort.boundingBox();
		const destinationBox = await destinationPort.boundingBox();
		expect(sourceBox).not.toBeNull();
		expect(destinationBox).not.toBeNull();
		await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(destinationBox.x + destinationBox.width / 2, destinationBox.y + destinationBox.height / 2);
		await page.mouse.up();
		await expect(graph.locator('[data-routing-edge]')).toHaveCount(edgesBefore + 3);
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection added');
		const pointerEdgeId = (await graph.locator('[data-routing-edge]').evaluateAll((edges) => (
			edges.map((edge) => edge.getAttribute('data-routing-edge'))
		))).find((id) => !edgeIdsBeforePointer.has(id));
		expect(pointerEdgeId).toBeTruthy();

		const pointerEdge = graph.locator(`[data-routing-edge="${pointerEdgeId}"]`);
		await pointerEdge.click();
		const masterEndpoint = JSON.stringify({ kind: 'master' });
		const destinationSelect = graph.locator('[data-routing-inspector="edge"] select[name="destination"]');
		await destinationSelect.selectOption(masterEndpoint);
		await inspector.getByRole('button', { name: 'Save connection', exact: true }).click();
		await expect(graph.locator('.kw-routing-graph__status')).toContainText('Connection rewired');
		await expect(pointerEdge).toBeVisible();
		await expect(destinationSelect).toHaveValue(masterEndpoint);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(pointerEdge).toBeVisible();
		await expect(destinationSelect).not.toHaveValue(masterEndpoint);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(destinationSelect).toHaveValue(masterEndpoint);
		await inspector.getByRole('button', { name: 'Delete connection', exact: true }).click();
		await inspector.getByRole('alert').getByRole('button', {
			name: /^(Confirm delete|Delete permanently)$/u,
		}).click();
		await expect(pointerEdge).toHaveCount(0);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(pointerEdge).toBeVisible();

		await graph.getByLabel('Add routing node', { exact: true }).selectOption('vca');
		const vca = graph.locator('[data-routing-node^="vca:"]');
		await expect(vca).toHaveCount(1);
		await vca.locator('.kw-routing-graph__node-main').click();
		const vcaInspector = graph.getByRole('complementary', { name: 'Routing inspector', exact: true });
		const firstMember = vcaInspector.locator('input[name="member"]').first();
		await firstMember.check();
		await vcaInspector.getByRole('button', { name: 'Save VCA', exact: true }).click();
		await expect(graph.locator('[data-routing-vca-relation]')).toHaveCount(1);

		await graph.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await expect(graph.getByLabel('Graph zoom level', { exact: true })).toHaveText('110%');
		await graph.getByRole('button', { name: 'Fit', exact: true }).click();
		const themedNode = graph.locator('[data-routing-node="master"]');
		await setDocumentTheme(page, 'light');
		const lightNodeStyle = await themedNode.evaluate((element) => {
			const style = getComputedStyle(element);
			return { background: style.backgroundColor, color: getComputedStyle(element.querySelector('strong')).color };
		});
		await setDocumentTheme(page, 'dark');
		const darkNodeStyle = await themedNode.evaluate((element) => {
			const style = getComputedStyle(element);
			return { background: style.backgroundColor, color: getComputedStyle(element.querySelector('strong')).color };
		});
		await expect(themedNode).toBeVisible();
		expect(lightNodeStyle.background).not.toBe(darkNodeStyle.background);
		expect(lightNodeStyle.color).not.toBe(darkNodeStyle.color);
		await assertNoSeriousAxeViolations(page, '[data-soundscaper-routing-graph]');
		await page.emulateMedia({ forcedColors: 'active' });
		const supportsForcedColors = await page.evaluate(() => (
			matchMedia('(forced-colors: active)').matches
			&& CSS.supports('forced-color-adjust', 'none')
		));
		if (supportsForcedColors) {
			await expect(graph.locator('[data-routing-node="master"]')).toHaveCSS('forced-color-adjust', 'none');
		}
		await page.emulateMedia({ forcedColors: 'none' });

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const reopened = await bootEditor(page, `/embed/en/?project=${encodeURIComponent(projectId)}`);
		const reopenedMixer = reopened.locator('[data-mixer-panel]');
		if (!await reopenedMixer.isVisible()) {
			await chooseNestedCommandAction(page, reopened, 'View', ['Panels', 'Mixer']);
		}
		await expect(reopenedMixer).toBeVisible();
		await expect(reopenedMixer.getByRole('button', { name: 'Routing graph', exact: true }))
			.toHaveAttribute('aria-pressed', 'false');
		await reopenedMixer.getByRole('button', { name: 'Routing graph', exact: true }).click();
		await expect(reopenedMixer.locator('[data-routing-node^="vca:"]')).toHaveCount(1);
		await expect(reopenedMixer.locator(`[data-routing-edge="${pointerEdgeId}"]`)).toBeVisible();
		expect(clientErrors).toEqual([]);
	});
});
