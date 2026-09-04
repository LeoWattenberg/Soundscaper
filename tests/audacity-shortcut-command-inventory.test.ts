/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isAudacityShortcutCommandDisabled } from '../src/common/editor/audacity-action-parity.js';
import { audacityShortcutCommandUnassignable } from '../src/common/editor/audacity-shortcut-command-inventory.ts';
import { collectAudacityShortcutCommands } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';
import { groupAudacityShortcutCommands } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-groups.ts';

const MENUS = Object.freeze([
	{
		id: 'file',
		label: 'File',
		items: [
			{ id: 'file-new', label: 'New' },
			{ divider: true },
			{ id: 'file-open', label: 'Open' },
		],
	},
	{
		id: 'view',
		label: 'View',
		items: [
			{ id: 'zoom-in', label: 'Zoom in' },
			{
				id: 'snap',
				label: 'Snapping',
				items: [
					{ id: 'snap-enabled', label: 'Snap to grid' },
					{ id: 'snap-1-128', label: '1/128', shortcutAssignable: false },
					{ id: 'snap-bar', label: 'Bar', shortcutAssignable: false },
				],
			},
		],
	},
	{
		id: 'help',
		label: 'Help',
		items: [
			{ id: 'online-handbook', label: 'Manual' },
			{ id: 'about-audacity', label: 'About Soundscaper' },
			{ id: 'desktop-view-source', label: 'View source' },
		],
	},
]);

test('shortcut preferences expose one canonical Insert row', () => {
	const commands = collectAudacityShortcutCommands([]);
	assert.equal(commands.filter(({ id }) => id === 'insert').length, 1);
	assert.equal(commands.some(({ id }) => id === 'action://trackedit/paste-insert'), false);
});

test('the values of a dropdown are not offered as commands of their own', () => {
	const ids = new Set(collectAudacityShortcutCommands(MENUS).map(({ id }) => id));
	assert.equal(ids.has('snap-enabled'), true);
	assert.equal(ids.has('snap-1-128'), false);
	assert.equal(ids.has('snap-bar'), false);
});

test('commands that only report on the application are not offered a shortcut', () => {
	const ids = new Set(collectAudacityShortcutCommands(MENUS).map(({ id }) => id));
	assert.equal(ids.has('about-audacity'), false);
	assert.equal(ids.has('desktop-view-source'), false);
	assert.equal(ids.has('tutorials'), false);
	assert.equal(ids.has('local://support'), false);
	// The manual keeps its row because Audacity itself binds F1 to it.
	assert.equal(ids.has('online-handbook'), true);
});

test('a dynamic action template is not offered as a bindable command', () => {
	const ids = new Set(collectAudacityShortcutCommands([]).map(({ id }) => id));
	assert.equal(ids.has('action://trackedit/clip/change-color?colorindex=%1'), false);
	assert.equal(ids.has('action://effects/open?effectId=%1'), false);
	assert.equal(ids.has('menu-align'), false);
	assert.equal(ids.has('menu-macros'), false);
});

test('the categorized view follows the menubar, and the alphabetical view is one run', () => {
	const commands = collectAudacityShortcutCommands(MENUS);
	const groups = groupAudacityShortcutCommands(commands, 'categorized');
	const groupIds = groups.map(({ id }) => id);
	assert.deepEqual(groupIds.slice(0, 3), ['menu:file', 'menu:view', 'menu:help']);

	const file = groups.find(({ id }) => id === 'menu:file');
	assert.equal(file?.label, 'File');
	assert.deepEqual(
		file?.commands.slice(0, 2).map(({ id }) => id),
		['file-new', 'file-open'],
	);

	// A submenu is walked through, not listed: Snapping keeps its own row under
	// the surface the inventory records it at, and its values are gone entirely.
	const view = groups.find(({ id }) => id === 'menu:view');
	assert.deepEqual(view?.commands.slice(0, 2).map(({ id }) => id), ['zoom-in', 'snap-enabled']);
	assert.equal(view?.commands.some(({ id }) => id === 'snap'), false);
	assert.equal(
		groups.find(({ id }) => id === 'location:Transport toolbar')?.commands.some(({ id }) => id === 'snap'),
		true,
	);

	const alphabetical = groupAudacityShortcutCommands(commands, 'alphabetical');
	assert.equal(alphabetical.length, 1);
	assert.equal(alphabetical[0].label, '');
	assert.deepEqual(alphabetical[0].commands, commands);
});

test('commands the menubar never shows are grouped by where the inventory records them', () => {
	const groups = groupAudacityShortcutCommands(collectAudacityShortcutCommands(MENUS), 'categorized');
	const byId = new Map(groups.map((group) => [group.id, group]));

	// A toolbar command joins its own group, named for that surface.
	assert.equal(byId.get('location:Tools toolbar')?.label, 'Tools toolbar');
	assert.equal(
		byId.get('location:Tools toolbar')?.commands.some(({ id }) => id === 'split-tool'),
		true,
	);

	// A command the inventory files under a menu the menubar also shows joins
	// that menu's group rather than starting one of its own.
	assert.equal(byId.has('location:File'), false);
	assert.equal(byId.get('menu:file')?.commands.some(({ id }) => id === 'file-close'), true);

	// Menu groups come first; the surfaces the menubar has no entry for follow.
	const order = groups.map(({ id }) => id);
	assert.ok(order.indexOf('menu:help') < order.indexOf('location:Tools toolbar'));
});

test('grouping an empty inventory yields no groups in either view', () => {
	assert.deepEqual(groupAudacityShortcutCommands([], 'categorized'), []);
	assert.deepEqual(groupAudacityShortcutCommands([], 'alphabetical'), []);
});

test('a command without a shortcut row is still a command the product reference lists', () => {
	// Refusing a command a keyboard binding says nothing about whether the
	// product can run it, and the generated command reference asks the second
	// question. Conflating the two silently dropped nine rows from the handbook.
	for (const id of [
		'about-audacity',
		'local://support',
		'action://effects/open?effectId=%1',
		'action://trackedit/track/change-rate?rate=%1',
	]) {
		assert.equal(audacityShortcutCommandUnassignable(id), true);
		assert.equal(isAudacityShortcutCommandDisabled(id), false);
	}

	// A submenu header is not a command on either surface.
	assert.equal(isAudacityShortcutCommandDisabled('menu-align'), true);

	// Product capability filters keep working through the same predicate.
	assert.equal(isAudacityShortcutCommandDisabled('effect://builtin/change-pitch', ['selection-effect']), true);
});
