/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

const COMMANDS = [
	['local-projects', 'projectsTitle', 'openProjects'],
	['consolidate-media', 'consolidateMedia', 'consolidateMedia'],
	['trim-media', 'trimMedia', 'trimMedia'],
	['save-archive-manifest', 'saveArchiveManifest', 'saveArchiveManifest'],
	['project-properties', 'metadata', 'openMetadata'],
	['rename-project', 'renameProject', 'renameProject'],
	['duplicate-project', 'duplicateProject', 'duplicateProject'],
	['delete-project', 'deleteProject', 'deleteProject'],
	['clear-data', 'clearData', 'clearData'],
] as const;

test('File groups all nine project commands under Project management in both products and locales', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		for (const locale of ['en', 'de'] as const) {
			const { file, management, copy } = menuFixture({ productId, locale });
			assert.equal(management.label, locale === 'en' ? 'Project management' : 'Projektverwaltung');
			assert.deepEqual(management.items?.filter((item) => item.id).map((item) => item.id),
				COMMANDS.map(([id]) => id));
			for (const [id, copyKey] of COMMANDS) {
				assert.equal(file.items?.some((item) => item.id === id), false, `${id} remains in File`);
				const label = id === 'project-properties' && locale === 'en'
					? 'Project properties' : copy[copyKey];
				assert.equal(management.items?.find((item) => item.id === id)?.label, label);
			}
			for (const id of ['new-project', 'open-project', 'recent-projects', 'save-project', 'export-audio']) {
				assert.ok(file.items?.some((item) => item.id === id), `${id} stays in File`);
			}
		}
	}
});

test('Project management preserves every command action', () => {
	const { management, calls } = menuFixture({ manifest: true });
	for (const [id] of COMMANDS) {
		const item = management.items?.find((entry) => entry.id === id);
		assert.equal(item?.disabled, false, id);
		assert.equal(typeof item?.onClick, 'function', id);
		item?.onClick?.();
	}
	assert.deepEqual(calls, COMMANDS.map(([, , action]) => action));
});

test('nested commands preserve busy, read-only and archive availability rules', () => {
	const editingCommands = new Set(['consolidate-media', 'trim-media', 'rename-project', 'delete-project']);
	for (const state of [
		{ blocked: false, editBlocked: false, manifest: false },
		{ blocked: false, editBlocked: true, manifest: true },
		{ blocked: true, editBlocked: true, manifest: true },
	]) {
		const { management } = menuFixture(state);
		for (const [id] of COMMANDS) {
			const expected = id === 'save-archive-manifest' ? !state.manifest
				: editingCommands.has(id) ? state.editBlocked : state.blocked;
			assert.equal(management.items?.find((item) => item.id === id)?.disabled, expected, id);
		}
	}
});

function menuFixture({ productId = 'soundscaper', locale = 'en', blocked = false,
	editBlocked = false, manifest = false }: {
	productId?: string; locale?: 'en' | 'de'; blocked?: boolean; editBlocked?: boolean; manifest?: boolean;
} = {}) {
	const calls: string[] = [];
	const copy = locale === 'de' ? GERMAN_COPY : ENGLISH_COPY;
	const project = createCurrentAudioEditorProject();
	const menus = createApplicationMenus({
		productId, aboutLabel: 'About', capabilities: {}, locale, copy, project,
		snapshot: {
			project, selectedTrackId: null,
			archiveManifest: manifest ? { manifest: { members: [] } } : null,
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked, editBlocked, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 0,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({}, { get: (_target, key) => () => { calls.push(String(key)); } }),
	}) as readonly MenuItem[];
	const file = menus.find((menu) => menu.id === 'file');
	assert.ok(file);
	const management = file.items?.find((item) => item.id === 'project-management');
	assert.ok(management, 'File offers Project management');
	calls.length = 0;
	return { file, management, copy, calls };
}
