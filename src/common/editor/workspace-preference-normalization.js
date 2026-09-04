/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Normalization for the workspace half of the editor preferences: the layout a
 * preset or custom workspace supplies, and the toolbar, toolbar-button and
 * panel inventories saved against it. These take a stored value and answer with
 * a complete one, so a workspace saved before a toolbar or panel existed still
 * loads with that entry at its default.
 */

import {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	AUDIO_EDITOR_WORKSPACE_PRESETS,
	DEFAULT_FLOATING_PANEL_GEOMETRY,
	DEFAULT_PANELS,
	DEFAULT_TOOLBAR_BUTTONS,
	DEFAULT_TOOLBARS,
} from './workspace-layout-defaults.ts';
import { canonicalizeWorkspacePanelGroups, normalizeWorkspacePanelGroupFields } from './workspace-panel-layout.ts';
import { clone, finiteInRange, integer, nonEmptyString, oneOf } from './preferences-validators.js';

export const BUILT_IN_WORKSPACE_SET = new Set(AUDIO_EDITOR_BUILT_IN_WORKSPACES);
const DOCK_SET = new Set(['left', 'right', 'bottom', 'floating']);

export function workspaceLayout(activeId, custom) {
	if (BUILT_IN_WORKSPACE_SET.has(activeId)) return AUDIO_EDITOR_WORKSPACE_PRESETS[activeId];
	return custom.find((workspace) => workspace.id === activeId)?.layout || {};
}

export function normalizeToolbarEntries(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace.toolbars must be an object.');
	const entries = {};
	for (const [id, defaults] of Object.entries(DEFAULT_TOOLBARS)) {
		const entry = value[id] || {};
		entries[id] = {
			visible: entry.visible ?? defaults.visible,
			order: integer(entry.order ?? defaults.order, 0, `workspace.toolbars.${id}.order`),
		};
		if (typeof entries[id].visible !== 'boolean') throw new TypeError(`workspace.toolbars.${id}.visible must be boolean.`);
	}
	for (const [id, entry] of Object.entries(value)) {
		if (entries[id]) continue;
		nonEmptyString(id, 'toolbar ID');
		if (!entry || typeof entry !== 'object') throw new TypeError(`workspace.toolbars.${id} must be an object.`);
		entries[id] = {
			visible: entry.visible !== false,
			order: integer(entry.order ?? Object.keys(entries).length, 0, `workspace.toolbars.${id}.order`),
		};
	}
	return entries;
}

export function normalizeToolbarButtonEntries(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace.toolbarButtons must be an object.');
	const entries = { ...DEFAULT_TOOLBAR_BUTTONS };
	for (const [id, visible] of Object.entries(value)) {
		if (id === 'timecode-format') continue;
		nonEmptyString(id, 'toolbar button ID');
		if (typeof visible !== 'boolean') throw new TypeError(`workspace.toolbarButtons.${id} must be boolean.`);
		entries[id] = visible;
	}
	return entries;
}

export function normalizePanelEntries(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace.panels must be an object.');
	const entries = {};
	const ids = new Set([...Object.keys(DEFAULT_PANELS), ...Object.keys(value)].filter((id) => id !== 'spectrogram'));
	for (const id of ids) {
		nonEmptyString(id, 'panel ID');
		const defaults = DEFAULT_PANELS[id] || { visible: false, dock: 'right', order: Object.keys(entries).length, size: 320 };
		const floatingDefaults = DEFAULT_FLOATING_PANEL_GEOMETRY[id] || {
			x: 24 + Object.keys(entries).length * 24,
			y: 24 + Object.keys(entries).length * 24,
			width: Math.max(240, defaults.size),
			height: 320,
		};
		const entry = value[id] || {};
		if (!entry || typeof entry !== 'object') throw new TypeError(`workspace.panels.${id} must be an object.`);
		const visible = entry.visible ?? defaults.visible;
		if (typeof visible !== 'boolean') throw new TypeError(`workspace.panels.${id}.visible must be boolean.`);
		entries[id] = {
			visible,
			dock: oneOf(entry.dock ?? defaults.dock, DOCK_SET, `workspace.panels.${id}.dock`),
			order: integer(entry.order ?? defaults.order, 0, `workspace.panels.${id}.order`),
			size: finiteInRange(entry.size ?? defaults.size, 80, 4_096, `workspace.panels.${id}.size`),
			x: finiteInRange(entry.x ?? floatingDefaults.x, 0, 1_000_000, `workspace.panels.${id}.x`),
			y: finiteInRange(entry.y ?? floatingDefaults.y, 0, 1_000_000, `workspace.panels.${id}.y`),
			width: finiteInRange(entry.width ?? entry.size ?? floatingDefaults.width, 80, 4_096, `workspace.panels.${id}.width`),
			height: finiteInRange(entry.height ?? floatingDefaults.height, 80, 4_096, `workspace.panels.${id}.height`),
			...normalizeWorkspacePanelGroupFields(entry, `workspace.panels.${id}`),
		};
	}
	return canonicalizeWorkspacePanelGroups(entries);
}

export function normalizeCustomWorkspaces(value = []) {
	if (!Array.isArray(value)) throw new TypeError('workspace.custom must be an array.');
	const workspaces = value.map((workspace, index) => {
		if (!workspace || typeof workspace !== 'object') throw new TypeError(`workspace.custom[${index}] must be an object.`);
		const id = nonEmptyString(workspace.id, `workspace.custom[${index}].id`);
		if (BUILT_IN_WORKSPACE_SET.has(id)) throw new RangeError(`Custom workspace ID ${id} is reserved.`);
		return {
			id,
			name: nonEmptyString(workspace.name, `workspace.custom[${index}].name`),
			layout: clone(workspace.layout ?? {}),
		};
	});
	if (new Set(workspaces.map((workspace) => workspace.id)).size !== workspaces.length) {
		throw new RangeError('Custom workspace IDs must be unique.');
	}
	return workspaces;
}
