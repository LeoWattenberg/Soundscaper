/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { createMotionscaperShellMenus } from '../src/common/editor/ui/motionscaper/shell-menu.ts';

test('Motionscaper starts with only menu-reached motion surfaces and refuses unavailable authoring', () => {
	let opened = 0;
	const menus = createMotionscaperShellMenus({
		copy: motionscaperCopy('en'), workspaceOpen: false,
		onToggleWorkspace: () => { opened += 1; },
	});
	const create = menus.find(({ id }) => id === 'file')?.items[0];
	assert.equal(create?.label, 'New Composition');
	assert.equal(create?.disabled, true);
	assert.equal(create?.onClick, undefined);
	const workspace = menus.find(({ id }) => id === 'view')?.items[0];
	assert.equal(workspace?.label, 'Motion Workspace');
	assert.equal(workspace?.checked, false);
	workspace?.onClick?.();
	assert.equal(opened, 1);
});

test('a supplied composition action becomes reachable only through the File menu', () => {
	let created = 0;
	const menus = createMotionscaperShellMenus({
		copy: motionscaperCopy('de'), workspaceOpen: true,
		onToggleWorkspace: () => undefined, onNewComposition: () => { created += 1; },
	});
	const create = menus.find(({ id }) => id === 'file')?.items[0];
	assert.equal(create?.label, 'Neue Komposition');
	assert.equal(create?.disabled, false);
	create?.onClick?.();
	assert.equal(created, 1);
	assert.equal(menus.find(({ id }) => id === 'view')?.items[0]?.checked, true);
});
