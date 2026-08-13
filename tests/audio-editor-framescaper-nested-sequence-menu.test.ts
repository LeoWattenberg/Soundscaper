/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNestedSequenceMenuItems,
} from '../src/common/editor/ui/framescaper-nested-sequence-menu.ts';
import type { FramescaperProjectCommandV18 } from '../src/framescaper/editor-project-v18-subsequence.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { createFramescaperSequenceActionsV18 } from '../src/framescaper/editor-project-v18-sequence-actions.ts';

const COPY = Object.freeze({
	nestedSequences: 'Nested sequences',
	addNestedSequence: 'Add shared sequence',
	updateNestedSequence: 'Move nested sequence',
	removeNestedSequence: 'Remove nested sequence',
});

test('Framescaper exposes opt-in add, update, and remove leaves with exact commands', () => {
	const calls: unknown[] = [];
	const items = createFramescaperNestedSequenceMenuItems({
		productId: 'framescaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) });
	assert.ok(items);
	assert.equal(items.id, 'nested-sequences');
	assert.equal(items.label, 'Nested sequences');
	assert.deepEqual(items.items.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'nested-sequence-add', disabled: false },
		{ id: 'nested-sequence-update', disabled: false },
		{ id: 'nested-sequence-remove', disabled: false },
	]);
	for (const item of items.items) item.onClick();
	assert.deepEqual(calls, [
		{
			type: 'subsequence/add',
			subsequence: {
				id: 'nested-main-shared-1', sequenceId: 'main', sourceSequenceId: 'shared',
				sequenceStartFrame: 0, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 24,
			},
		},
		{
			type: 'subsequence/update', subsequenceId: 'nested-existing',
			changes: { sequenceStartFrame: 60 },
		},
		{ type: 'subsequence/remove', subsequenceId: 'nested-existing' },
	]);
	assert.equal(Object.isFrozen(items), true);
	assert.equal(Object.isFrozen(items.items), true);
});

test('Soundscaper has no nested-sequence menu and blocked or incomplete state stays inert', () => {
	const calls: unknown[] = [];
	assert.equal(createFramescaperNestedSequenceMenuItems({
		productId: 'soundscaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) }), null);
	for (const [name, value] of [
		['blocked', { ...project(), editingBlocked: true }],
		['one sequence', {
			...project(), sequences: [{ id: 'main', rate: { num: 30, den: 1 } }], subsequences: [],
		}],
		['malformed', {}],
	] as const) {
		const items = createFramescaperNestedSequenceMenuItems({
			productId: 'framescaper', project: value, editingBlocked: name === 'blocked', copy: COPY,
		}, { execute: (command) => calls.push(command) });
		assert.ok(items, name);
		assert.equal(items.items.every(({ disabled }) => disabled), true, name);
		for (const item of items.items) item.onClick();
	}
	assert.deepEqual(calls, []);
});

test('the existing Tracks submenu reaches the injected V18 controller actions only in Framescaper', () => {
	const calls: unknown[] = [];
	const controller = {
		actions: { sequences: {
			addNested: (value: unknown) => calls.push(['add', value]),
			updateNested: (id: unknown, changes: unknown) => calls.push(['update', id, changes]),
			removeNested: (id: unknown) => calls.push(['remove', id]),
		} },
	};
	const menus = createWorkspaceApplicationMenus(workspaceInput('framescaper', controller));
	const nested = menuItem(menus, 'nested-sequences');
	assert.equal(menuItem(topLevelMenu(menus, 'tracks').items ?? [], 'nested-sequences'), nested);
	for (const item of nested.items ?? []) item.onClick?.();
	assert.deepEqual(calls, [
		['add', {
			id: 'nested-main-shared-1', sequenceId: 'main', sourceSequenceId: 'shared',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 24,
		}],
		['update', 'nested-existing', { sequenceStartFrame: 60 }],
		['remove', 'nested-existing'],
	]);
	assert.equal(findMenuItem(
		createApplicationMenus(applicationMenuInput('soundscaper')),
		'nested-sequences',
	), null);
});

test('the product action owner snapshots strict exact commands before execution', () => {
	const calls: unknown[] = [];
	const actions = createFramescaperSequenceActionsV18((command: FramescaperProjectCommandV18) => calls.push(command));
	const subsequence = {
		id: 'nested', sequenceId: 'main', sourceSequenceId: 'shared',
		sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 24,
	};
	actions.addNested(subsequence);
	subsequence.sequenceStartFrame = 90;
	actions.updateNested('nested', { sequenceStartFrame: 60 });
	actions.removeNested('nested');
	assert.deepEqual(calls, [
		{ type: 'subsequence/add', subsequence: { ...subsequence, sequenceStartFrame: 0 } },
		{ type: 'subsequence/update', subsequenceId: 'nested', changes: { sequenceStartFrame: 60 } },
		{ type: 'subsequence/remove', subsequenceId: 'nested' },
	]);
	assert.throws(() => actions.addNested({ ...subsequence, surprise: true }), /unsupported field/iu);
	assert.throws(() => actions.updateNested('nested', {}), /must not be empty/iu);
	assert.throws(() => actions.updateNested('nested', { sequenceFrameCount: 0 }), /safe integer/iu);
	assert.throws(() => actions.removeNested(''), /non-empty/iu);
});

function project(): Record<string, unknown> {
	return {
		id: 'nested-menu', schemaVersion: 18, primarySequenceId: 'main',
		sequences: [
			{ id: 'main', rate: { num: 30, den: 1 } },
			{ id: 'shared', rate: { num: 24, den: 1 } },
		],
		subsequences: [{
			id: 'nested-existing', sequenceId: 'main', sourceSequenceId: 'shared',
			sequenceStartFrame: 30, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 24,
		}],
	};
}

interface MenuItem {
	readonly id?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function workspaceInput(productId: string, controller: object) {
	return new Proxy({
		...applicationMenuInput(productId), controller,
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation(),
	}, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}

function applicationMenuInput(productId: string) {
	const nestedProject = project();
	return {
		productId, aboutLabel: 'About', capabilities: {}, locale: 'en', copy: copyValues(),
		project: {
			...nestedProject, sampleRate: 48_000, sources: [], clips: [], tracks: [],
			selection: null, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		}, snapshot: {
			selectedTrackId: null,
			preferences: {
				workspace: {
					activeId: 'video-editor', custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
				},
				view: {},
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		recordLabel: '', selectionActive: false, selectedClip: null, durationFrames: 0,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		actions: actionPorts(),
	};
}

function actionPorts(): object {
	return new Proxy({}, { get: () => () => undefined });
}

function copyValues(): object {
	return new Proxy(COPY, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}

function topLevelMenu(values: unknown, id: string): MenuItem {
	const item = (values as readonly MenuItem[]).find(({ id: candidate }) => candidate === id);
	assert.ok(item);
	return item;
}

function menuItem(values: unknown, id: string): MenuItem {
	const item = findMenuItem(values, id);
	assert.ok(item, `Missing menu item ${id}.`);
	return item;
}

function findMenuItem(values: unknown, id: string): MenuItem | null {
	for (const item of values as readonly MenuItem[]) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}
