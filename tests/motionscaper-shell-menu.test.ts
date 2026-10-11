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

test('document menus admit saves and history only for an available idle document', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: true, onToggleWorkspace: () => undefined,
		onCommand: (command: string) => { commands.push(command); }, hasProject: true, busy: false, canUndo: true, canRedo: false };
	const menus = createMotionscaperShellMenus(options);
	const save = menus.find(({ id }) => id === 'file')?.items.find(({ id }) => id === 'motion-save');
	assert.equal(save?.disabled, false);
	save?.onClick?.();
	assert.deepEqual(commands, ['save']);
	assert.equal(menus.find(({ id }) => id === 'edit')?.items[0]?.disabled, false);
	assert.equal(menus.find(({ id }) => id === 'edit')?.items[1]?.disabled, true);
	const busyMenus = createMotionscaperShellMenus({ ...options, busy: true });
	assert.ok(busyMenus.find(({ id }) => id === 'file')?.items.every(({ disabled }) => disabled));
});

test('tracking is a localized opt-in layer command that requires an idle document', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: true, onToggleWorkspace: () => undefined,
		onCommand: (command: string) => { commands.push(command); }, hasProject: true, busy: false };
	const tracking = (values: ReturnType<typeof createMotionscaperShellMenus>) => values.find(({ id }) => id === 'tracks')?.items.find(({ id }) => id === 'motion-tracking');
	const item = tracking(createMotionscaperShellMenus(options)); assert.equal(item?.label, 'Tracking and Stabilization'); assert.equal(item?.disabled, false);
	item?.onClick?.(); assert.deepEqual(commands, ['tracking']);
	assert.equal(tracking(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(tracking(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(tracking(createMotionscaperShellMenus({ ...options, copy: motionscaperCopy('de') }))?.label, 'Tracking und Stabilisierung');
});

test('compositing is localized, opt-in and available only for an idle document', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('de'), workspaceOpen: true, onToggleWorkspace: () => undefined,
		onCommand: (command: string) => { commands.push(command); }, hasProject: true, busy: false };
	const entry = (values: ReturnType<typeof createMotionscaperShellMenus>) => values.find(({ id }) => id === 'tracks')?.items.find(({ id }) => id === 'motion-compositing');
	assert.equal(entry(createMotionscaperShellMenus(options))?.label, 'Masken und Compositing');
	entry(createMotionscaperShellMenus(options))?.onClick?.(); assert.deepEqual(commands, ['compositing']);
	assert.equal(entry(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(entry(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(options.copy.videoEffectGaussianBlur, 'Gaußscher Weichzeichner');
});
