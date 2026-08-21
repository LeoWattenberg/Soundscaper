/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createApplicationMenuAccessKeyController,
	resolveApplicationMenuAccessKeys,
	type ApplicationMenuAccessKeyEvent,
} from '../src/common/editor/ui/application-menu-access-key.ts';

interface EventFixture {
	event: ApplicationMenuAccessKeyEvent;
	prevented: () => boolean;
}

function keyEvent(
	key: string,
	modifiers: Partial<Pick<ApplicationMenuAccessKeyEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {},
	target: object = {},
): EventFixture {
	let defaultPrevented = false;
	return {
		event: {
			key,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			target,
			preventDefault: () => { defaultPrevented = true; },
			...modifiers,
		},
		prevented: () => defaultPrevented,
	};
}

function fixture() {
	const focused: string[] = [];
	const opened: string[] = [];
	const excludedTarget = {};
	const accessKeys = resolveApplicationMenuAccessKeys([
		{ id: 'file', label: 'File' },
		{ id: 'edit', label: 'Edit' },
		{ id: 'effect', label: 'Effect' },
	]);
	return {
		controller: createApplicationMenuAccessKeyController({
			focusFileMenu: () => focused.push('file'),
			openMenuByAccessKey: (key) => {
				const menu = accessKeys.find((candidate) => candidate.key === key);
				if (!menu) return false;
				opened.push(menu.menuId);
				return true;
			},
		}),
		excludedTarget,
		focused,
		opened,
	};
}

test('localized labels receive deterministic unique access keys', () => {
	assert.deepEqual(resolveApplicationMenuAccessKeys([
		{ id: 'file', label: 'File' },
		{ id: 'edit', label: 'Edit' },
		{ id: 'select', label: 'Select' },
		{ id: 'view', label: 'View' },
		{ id: 'tracks', label: 'Tracks' },
		{ id: 'generate', label: 'Generate' },
		{ id: 'effect', label: 'Effect' },
		{ id: 'analyze', label: 'Analyze' },
		{ id: 'tools', label: 'Tools' },
		{ id: 'extra', label: 'Extra' },
		{ id: 'project', label: 'Project' },
		{ id: 'help', label: 'Help' },
	]).map(({ menuId, key }) => `${menuId}:${key}`), [
		'file:f', 'edit:e', 'select:s', 'view:v', 'tracks:t', 'generate:g',
		'effect:c', 'analyze:a', 'tools:o', 'extra:x', 'project:p', 'help:h',
	]);

	assert.deepEqual(resolveApplicationMenuAccessKeys([
		{ id: 'file', label: 'Datei' },
		{ id: 'edit', label: 'Bearbeiten' },
		{ id: 'select', label: 'Auswählen' },
		{ id: 'view', label: 'Ansicht' },
	]).map(({ menuId, key }) => `${menuId}:${key}`), [
		'file:d', 'edit:b', 'select:a', 'view:n',
	]);
});

test('plain F10 focuses File globally while modified combinations remain untouched', () => {
	const { controller, excludedTarget, focused } = fixture();
	const f10 = keyEvent('F10');
	controller.onKeyDown(f10.event);
	assert.equal(f10.prevented(), true);
	assert.deepEqual(focused, ['file']);

	const modifiedF10 = keyEvent('F10', { shiftKey: true });
	controller.onKeyDown(modifiedF10.event);
	assert.equal(modifiedF10.prevented(), false);

	const editedF10 = keyEvent('F10', {}, excludedTarget);
	controller.onKeyDown(editedF10.event);
	assert.equal(editedF10.prevented(), true);
	assert.deepEqual(focused, ['file', 'file']);
});

test('standalone Alt focuses File only after its matching release', () => {
	const { controller, focused } = fixture();
	const down = keyEvent('Alt', { altKey: true });
	controller.onKeyDown(down.event);
	assert.equal(down.prevented(), true);
	assert.deepEqual(focused, []);

	const up = keyEvent('Alt');
	controller.onKeyUp(up.event);
	assert.equal(up.prevented(), true);
	assert.deepEqual(focused, ['file']);
});

test('Alt plus a localized mnemonic opens its menu and suppresses the Alt release', () => {
	const { controller, excludedTarget, focused, opened } = fixture();
	controller.onKeyDown(keyEvent('Alt', { altKey: true }).event);
	const file = keyEvent('F', { altKey: true });
	controller.onKeyDown(file.event);
	controller.onKeyUp(keyEvent('Alt').event);
	assert.equal(file.prevented(), true);
	assert.deepEqual(opened, ['file']);
	assert.deepEqual(focused, []);

	controller.onKeyDown(keyEvent('Alt', { altKey: true }).event);
	const editFromInput = keyEvent('e', { altKey: true }, excludedTarget);
	controller.onKeyDown(editFromInput.event);
	controller.onKeyUp(keyEvent('Alt', {}, excludedTarget).event);
	assert.equal(editFromInput.prevented(), true);
	assert.deepEqual(opened, ['file', 'edit']);

	const modified = keyEvent('c', { altKey: true, ctrlKey: true });
	controller.onKeyDown(modified.event);
	assert.equal(modified.prevented(), false);
	assert.deepEqual(opened, ['file', 'edit']);
});

test('an intervening modifier or other key cancels Alt until release', () => {
	const { controller, focused } = fixture();
	controller.onKeyDown(keyEvent('Alt', { altKey: true }).event);
	controller.onKeyDown(keyEvent('Shift', { altKey: true, shiftKey: true }).event);
	controller.onKeyDown(keyEvent('ArrowLeft', { altKey: true, shiftKey: true }).event);
	controller.onKeyUp(keyEvent('Alt').event);
	assert.deepEqual(focused, []);

	controller.onKeyDown(keyEvent('Alt', { altKey: true }).event);
	controller.onKeyDown(keyEvent('x', { altKey: true }).event);
	controller.onKeyUp(keyEvent('Alt').event);
	assert.deepEqual(focused, []);

	controller.onKeyDown(keyEvent('Alt', { altKey: true }).event);
	controller.cancel();
	controller.onKeyUp(keyEvent('Alt').event);
	assert.deepEqual(focused, []);
});

test('standalone Alt reaches File even when focus begins or ends in an edited control', () => {
	const { controller, excludedTarget, focused } = fixture();
	const firstDown = keyEvent('Alt', { altKey: true }, excludedTarget);
	const firstUp = keyEvent('Alt', {}, excludedTarget);
	controller.onKeyDown(firstDown.event);
	controller.onKeyUp(firstUp.event);

	controller.onKeyDown(keyEvent('Alt', { altKey: true }).event);
	const secondUp = keyEvent('Alt', {}, excludedTarget);
	controller.onKeyUp(secondUp.event);
	assert.equal(firstDown.prevented(), true);
	assert.equal(firstUp.prevented(), true);
	assert.equal(secondUp.prevented(), true);
	assert.deepEqual(focused, ['file', 'file']);
});

test('the React menubar owns symmetric desktop-only access-key listeners', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/ui/AudioEditorMenuBar.jsx',
		import.meta.url,
	), 'utf8');

	assert.match(source, /createApplicationMenuAccessKeyController/u);
	assert.match(source, /desktopChromeSupportsMenuAccessKeys\(desktopChrome\?\.platform\)/u);
	assert.match(source, /addEventListener\('keydown', accessKeys\.onKeyDown, true\)/u);
	assert.match(source, /addEventListener\('keyup', accessKeys\.onKeyUp, true\)/u);
	assert.match(source, /removeEventListener\('keydown', accessKeys\.onKeyDown, true\)/u);
	assert.match(source, /removeEventListener\('keyup', accessKeys\.onKeyUp, true\)/u);
	assert.match(source, /window\.addEventListener\('blur', accessKeys\.cancel\)/u);
	assert.match(source, /window\.removeEventListener\('blur', accessKeys\.cancel\)/u);
	assert.match(source, /accessKeys\.cancel\(\)/u);
});
