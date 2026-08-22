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
	createSequence: 'Create shared sequence',
	addNestedSequence: 'Add nested placement',
	updateNestedSequence: 'Move nested sequence',
	removeNestedSequence: 'Remove nested sequence',
	deleteSequence: 'Delete shared sequence',
});

test('Framescaper exposes sequence and placement authoring leaves with exact commands', () => {
	const calls: unknown[] = [];
	const items = createFramescaperNestedSequenceMenuItems({
		productId: 'framescaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) });
	assert.ok(items);
	assert.equal(items.id, 'nested-sequences');
	assert.equal(items.label, 'Nested sequences');
	assert.deepEqual(items.items.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'nested-sequence-create', disabled: false },
		{ id: 'nested-sequence-add', disabled: false },
		{ id: 'nested-sequence-update', disabled: false },
		{ id: 'nested-sequence-remove', disabled: false },
		{ id: 'nested-sequence-delete', disabled: true },
	]);
	for (const item of items.items) item.onClick();
	assert.deepEqual(calls, [
		{
			type: 'sequence/create',
			sequence: {
				id: 'shared-sequence-1', name: 'Shared sequence 1', rate: { num: 30, den: 1 },
				dropFrame: false,
				startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
				trackIds: [], trackNodes: [],
			},
		},
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
	assert.equal(createFramescaperNestedSequenceMenuItems({
		productId: 'framescaper', project: { ...project(), schemaVersion: 19 }, editingBlocked: false, copy: COPY,
	}, { execute: () => undefined })?.disabled, false);
	assert.equal(createFramescaperNestedSequenceMenuItems({
		productId: 'framescaper', project: { ...project(), schemaVersion: 20 }, editingBlocked: false, copy: COPY,
	}, { execute: () => undefined })?.disabled, false);
});

test('a fresh Framescaper project can create its first secondary sequence while unsafe state stays inert', () => {
	const calls: unknown[] = [];
	assert.equal(createFramescaperNestedSequenceMenuItems({
		productId: 'soundscaper', project: project(), editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) }), null);
	const fresh = {
		...project(), sequences: [sequence('main', 30)], subsequences: [],
	};
	const freshItems = createFramescaperNestedSequenceMenuItems({
		productId: 'framescaper', project: fresh, editingBlocked: false, copy: COPY,
	}, { execute: (command) => calls.push(command) });
	assert.ok(freshItems);
	assert.deepEqual(freshItems.items.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'nested-sequence-create', disabled: false },
		{ id: 'nested-sequence-add', disabled: true },
		{ id: 'nested-sequence-update', disabled: true },
		{ id: 'nested-sequence-remove', disabled: true },
		{ id: 'nested-sequence-delete', disabled: true },
	]);
	freshItems.items[0]?.onClick();
	assert.equal((calls[0] as { type?: unknown }).type, 'sequence/create');

	for (const [name, value] of [
		['blocked', project()],
		['malformed', {}],
	] as const) {
		const items = createFramescaperNestedSequenceMenuItems({
			productId: 'framescaper', project: value, editingBlocked: name === 'blocked', copy: COPY,
		}, { execute: (command) => calls.push(command) });
		assert.ok(items, name);
		assert.equal(items.items.every(({ disabled }) => disabled), true, name);
		for (const item of items.items) item.onClick();
	}
	assert.equal(calls.length, 1);
});

test('the existing Tracks submenu reaches the injected V18 controller actions only in Framescaper', () => {
	const calls: unknown[] = [];
	const controller = {
		actions: { sequences: {
			createSequence: (value: unknown) => calls.push(['create-sequence', value]),
			addNested: (value: unknown) => calls.push(['add', value]),
			updateNested: (id: unknown, changes: unknown) => calls.push(['update', id, changes]),
			removeNested: (id: unknown) => calls.push(['remove', id]),
			deleteSequence: (id: unknown) => calls.push(['delete-sequence', id]),
		} },
	};
	const menus = createWorkspaceApplicationMenus(workspaceInput('framescaper', controller));
	const nested = menuItem(menus, 'nested-sequences');
	assert.equal(menuItem(topLevelMenu(menus, 'tracks').items ?? [], 'nested-sequences'), nested);
	for (const item of nested.items ?? []) item.onClick?.();
	assert.deepEqual(calls, [
		['create-sequence', {
			id: 'shared-sequence-1', name: 'Shared sequence 1', rate: { num: 30, den: 1 },
			dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
			trackIds: [], trackNodes: [],
		}],
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
	const shared = sequence('shared', 24);
	actions.createSequence(shared);
	actions.addNested(subsequence);
	subsequence.sequenceStartFrame = 90;
	actions.updateNested('nested', { sequenceStartFrame: 60 });
	actions.removeNested('nested');
	actions.deleteSequence('shared');
	assert.deepEqual(calls, [
		{ type: 'sequence/create', sequence: shared },
		{ type: 'subsequence/add', subsequence: { ...subsequence, sequenceStartFrame: 0 } },
		{ type: 'subsequence/update', subsequenceId: 'nested', changes: { sequenceStartFrame: 60 } },
		{ type: 'subsequence/remove', subsequenceId: 'nested' },
		{ type: 'sequence/delete', sequenceId: 'shared' },
	]);
	assert.throws(() => actions.createSequence({ ...shared, surprise: true }), /unsupported field|exact/iu);
	assert.throws(() => actions.createSequence({ ...shared, trackIds: ['occupied'] }), /empty/iu);
	assert.throws(() => actions.addNested({ ...subsequence, surprise: true }), /unsupported field/iu);
	assert.throws(() => actions.updateNested('nested', {}), /must not be empty/iu);
	assert.throws(() => actions.updateNested('nested', { sequenceFrameCount: 0 }), /safe integer/iu);
	assert.throws(() => actions.removeNested(''), /non-empty/iu);
	assert.throws(() => actions.deleteSequence(''), /non-empty/iu);
});

function project(): Record<string, unknown> {
	return {
		id: 'nested-menu', schemaVersion: 18, primarySequenceId: 'main',
		sequences: [
			sequence('main', 30),
			sequence('shared', 24),
		],
		subsequences: [{
			id: 'nested-existing', sequenceId: 'main', sourceSequenceId: 'shared',
			sequenceStartFrame: 30, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 24,
		}],
	};
}

function sequence(id: string, rate: number): Record<string, unknown> {
	return {
		id, name: id === 'main' ? 'Main sequence' : 'Shared sequence',
		rate: { num: rate, den: 1 }, dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		trackIds: [], trackNodes: [],
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
