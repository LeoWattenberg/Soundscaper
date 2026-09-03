/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertProducts, page, productNames, reviewedLabel, table } from './markdown.mjs';

/**
 * Each built-in workspace takes its name from the application menu, so the page
 * calls a layout what the menu calls it. The mapping is reviewed rather than
 * derived because `video-editor` is presented as `workspaceVideo`.
 */
const WORKSPACE_COPY_KEYS = Object.freeze({
	classic: 'workspaceClassic',
	music: 'workspaceMusic',
	modern: 'workspaceModern',
	audacity: 'workspaceAudacity',
	'video-editor': 'workspaceVideo',
});

const TOOLBAR_COPY_KEYS = Object.freeze({
	transport: 'toolbarTransport',
	tools: 'toolbarTools',
	edit: 'toolbarEdit',
	meter: 'toolbarMeter',
});

function copyText(copy, key, kind) {
	const value = copy[key];
	if (typeof value !== 'string' || !value) throw new Error(`The editor copy has no ${kind} name under ${key}.`);
	return value;
}

function visibility(entry) {
	return entry?.visible === true ? 'Visible' : 'Hidden';
}

export function renderWorkspaceReference({
	products,
	copy,
	builtInWorkspaces,
	presets,
	defaultPanels,
	panelIds,
	toolbarIds,
	dockIds,
	panelLabel,
	dockLabel,
	isProductCommandDisabled,
}) {
	assertProducts(products);
	if (!Array.isArray(builtInWorkspaces) || builtInWorkspaces.length === 0) throw new TypeError('The built-in workspace list is required.');
	if (typeof isProductCommandDisabled !== 'function') throw new TypeError('The product command filter is required.');

	const workspaces = builtInWorkspaces.map((id) => {
		const preset = presets[id];
		if (!preset) throw new Error(`Built-in workspace ${id} has no layout preset.`);
		const commandId = `workspace-${id}`;
		return {
			id,
			commandId,
			label: copyText(copy, reviewedLabel(WORKSPACE_COPY_KEYS, id, 'built-in workspace'), 'workspace'),
			preset,
			products: productNames(products.filter((product) => !isProductCommandDisabled(
				commandId,
				product.shortcuts?.disabledCommandIds ?? [],
			))) || 'None',
		};
	});
	const headers = workspaces.map((workspace) => workspace.label);

	const body = [
		'A workspace is a saved arrangement of the panels and toolbars around the timeline. Choosing one replaces the current arrangement; you can then move anything and save your own workspace, which this page does not describe.',
		'',
		'## Built-in workspaces',
		'',
		table(
			['Workspace', 'Command ID', 'Products'],
			workspaces.map((workspace) => [workspace.label, `\`${workspace.commandId}\``, workspace.products]),
		),
		'',
		'## Panels',
		'',
		'“Default dock” is where a panel sits before any workspace moves it. A workspace can place the same panel somewhere else.',
		'',
		table(
			['Panel', 'Panel ID', 'Default dock', ...headers],
			panelIds.map((panelId) => [
				panelLabel(copy, panelId),
				`\`${panelId}\``,
				dockLabel(copy, defaultPanels[panelId]?.dock ?? 'floating'),
				...workspaces.map((workspace) => visibility(workspace.preset.panels?.[panelId])),
			]),
		),
		'',
		'## Toolbars',
		'',
		table(
			['Toolbar', 'Toolbar ID', ...headers],
			toolbarIds.map((toolbarId) => [
				copyText(copy, reviewedLabel(TOOLBAR_COPY_KEYS, toolbarId, 'toolbar'), 'toolbar'),
				`\`${toolbarId}\``,
				...workspaces.map((workspace) => visibility(workspace.preset.toolbars?.[toolbarId])),
			]),
		),
		'',
		'## Docks',
		'',
		'A panel occupies one of these positions. “Floating” means a panel window you can place freely.',
		'',
		table(
			['Dock', 'Dock ID'],
			dockIds.map((dockId) => [dockLabel(copy, dockId), `\`${dockId}\``]),
		),
	].join('\n');
	return page({
		title: 'Workspaces and panels',
		description: 'Built-in workspace layouts and the panels, toolbars, and docks each one arranges.',
		order: 8,
		body,
	});
}
