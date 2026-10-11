/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

test('AE bridge is an idle File command available before a document is created', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand: (command: string) => { commands.push(command); }, hasProject: false };
	const find = (menus: ReturnType<typeof createMotionscaperShellMenus>) => menus.find(({ id }) => id === 'file')?.items.find(({ id }) => id === 'motion-after-effects');
	const item = find(createMotionscaperShellMenus(options)); assert.equal(item?.label, options.copy.motionscaperAfterEffectsBridge); item?.onClick?.(); assert.deepEqual(commands, ['after-effects']);
	assert.equal(find(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(find(createMotionscaperShellMenus({ ...options, copy: motionscaperCopy('de') }))?.label, motionscaperCopy('de').motionscaperAfterEffectsBridge);
});
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { createMotionscaperShellMenus } from '../src/common/editor/ui/motionscaper/shell-menu.ts';

test('manual Motion updates are a desktop-supplied Help action and coalesce while checking', () => {
	let calls = 0;
	const options = { copy: motionscaperCopy('de'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCheckForUpdates: () => { calls += 1; } };
	const find = (checkingUpdates: boolean) => createMotionscaperShellMenus({ ...options, checkingUpdates }).find(menu => menu.id === 'help')?.items.find(item => item.id === 'motion-check-updates');
	assert.equal(find(false)?.label, 'Nach Updates suchen'); find(false)?.onClick?.(); assert.equal(calls, 1);
	assert.equal(find(true)?.disabled, true); assert.equal(find(true)?.onClick, undefined);
});

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

test('expression authoring remains an idle-document menu with German command copy', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('de'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand: (command: string) => { commands.push(command); }, hasProject: true };
	const find = (menus: ReturnType<typeof createMotionscaperShellMenus>) => menus.find(({ id }) => id === 'tracks')?.items.find(({ id }) => id === 'motion-expressions');
	const item = find(createMotionscaperShellMenus(options)); assert.equal(item?.label, 'Ausdrücke'); item?.onClick?.(); assert.deepEqual(commands, ['expressions']);
	assert.equal(find(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(find(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
});

test('text and appearance editing opens only from its localized idle-document layer menu', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand: (command: string) => { commands.push(command); }, hasProject: true };
	const find = (menus: ReturnType<typeof createMotionscaperShellMenus>) => menus.find(({ id }) => id === 'tracks')?.items.find(({ id }) => id === 'motion-appearance');
	const item = find(createMotionscaperShellMenus(options)); assert.equal(item?.label, 'Text and Appearance'); item?.onClick?.(); assert.deepEqual(commands, ['appearance']);
	assert.equal(find(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(find(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(find(createMotionscaperShellMenus({ ...options, copy: motionscaperCopy('de') }))?.label, 'Text und Aussehen');
});

test('composition management is a localized File command that requires an idle project', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand: (command: string) => { commands.push(command); }, hasProject: true };
	const find = (menus: ReturnType<typeof createMotionscaperShellMenus>) => menus.find(({ id }) => id === 'file')?.items.find(({ id }) => id === 'motion-compositions');
	const item = find(createMotionscaperShellMenus(options)); assert.equal(item?.label, 'Compositions'); item?.onClick?.(); assert.deepEqual(commands, ['compositions']);
	assert.equal(find(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(find(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(find(createMotionscaperShellMenus({ ...options, copy: motionscaperCopy('de') }))?.label, 'Kompositionen');
});

test('3D scene authoring remains a localized idle-document Layer command', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand: (command: string) => { commands.push(command); }, hasProject: true };
	const find = (menus: ReturnType<typeof createMotionscaperShellMenus>) => menus.find(({ id }) => id === 'tracks')?.items.find(({ id }) => id === 'motion-scene');
	const item = find(createMotionscaperShellMenus(options)); assert.equal(item?.label, '3D Scene and Quality'); item?.onClick?.(); assert.deepEqual(commands, ['scene']);
	assert.equal(find(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(find(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(find(createMotionscaperShellMenus({ ...options, copy: motionscaperCopy('de') }))?.label, '3D-Szene und Qualität');
});


test('Help remains available without a document and while document work is busy', () => {
	const destinations: string[] = [];
	const options = { copy: motionscaperCopy('de'), workspaceOpen: false, onToggleWorkspace: () => undefined, hasProject: false, busy: true,
		onDocumentation: (destination: 'manual' | 'tutorials') => { destinations.push(destination); } };
	const help = createMotionscaperShellMenus(options).find(({ id }) => id === 'help');
	assert.equal(help?.label, 'Hilfe');
	assert.deepEqual(help?.items.map(({ label, disabled }) => ({ label, disabled })), [
		{ label: 'Motionscaper-Handbuch', disabled: false }, { label: 'Dein erstes Motion-Projekt', disabled: false },
	]);
	for (const item of help?.items ?? []) item.onClick?.();
	assert.deepEqual(destinations, ['manual', 'tutorials']);
});

test('Render Queue opens from File without requiring an active project', () => {
	const calls: string[] = [];
	const menus = createMotionscaperShellMenus({ copy: motionscaperCopy('de'), workspaceOpen: false, hasProject: false, onToggleWorkspace: () => undefined, onCommand: command => { calls.push(command); } });
	const queue = menus.find(menu => menu.id === 'file')?.items.find(item => item.id === 'motion-render-queue');
	assert.equal(queue?.label, 'Render-Warteschlange'); assert.equal(queue?.disabled, false); queue?.onClick?.(); assert.deepEqual(calls, ['render-queue']);
});

test('Composition Canvas is a localized opt-in View command requiring an idle project', () => {
	const commands: string[] = [];
	const options = { copy: motionscaperCopy('en'), workspaceOpen: false, onToggleWorkspace: () => undefined, onCommand: (command: string) => { commands.push(command); }, hasProject: true };
	const find = (menus: ReturnType<typeof createMotionscaperShellMenus>) => menus.find(({ id }) => id === 'view')?.items.find(({ id }) => id === 'motion-canvas');
	const item = find(createMotionscaperShellMenus(options)); assert.equal(item?.label, 'Composition Canvas'); item?.onClick?.(); assert.deepEqual(commands, ['canvas']);
	assert.equal(find(createMotionscaperShellMenus({ ...options, hasProject: false }))?.onClick, undefined);
	assert.equal(find(createMotionscaperShellMenus({ ...options, busy: true }))?.disabled, true);
	assert.equal(find(createMotionscaperShellMenus({ ...options, copy: motionscaperCopy('de') }))?.label, 'Kompositions-Canvas');
});
