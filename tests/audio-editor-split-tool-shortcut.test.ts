/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SPLIT_TOOL_HOLD_MILLISECONDS,
	createSplitToolShortcutLifecycle,
	isSplitToolShortcutTargetExcluded,
	isSplitToolShortcutTargetWithinRoot,
	matchesSplitToolShortcut,
} from '../src/common/editor/ui/timeline/split-tool-shortcut.ts';

interface TestKeyEvent {
	readonly altKey: boolean;
	readonly code: string;
	readonly ctrlKey: boolean;
	readonly key: string;
	readonly metaKey: boolean;
	readonly repeat: boolean;
	readonly shiftKey: boolean;
	readonly prevented: boolean;
	readonly stopped: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

function keyEvent(
	key: string,
	options: Partial<Pick<TestKeyEvent, 'altKey' | 'code' | 'ctrlKey' | 'metaKey' | 'repeat' | 'shiftKey'>> = {},
): TestKeyEvent {
	let prevented = false;
	let stopped = false;
	return {
		altKey: options.altKey ?? false,
		code: options.code ?? (key.toLowerCase() === 's' ? 'KeyS' : ''),
		ctrlKey: options.ctrlKey ?? false,
		key,
		metaKey: options.metaKey ?? false,
		repeat: options.repeat ?? false,
		shiftKey: options.shiftKey ?? false,
		get prevented() { return prevented; },
		get stopped() { return stopped; },
		preventDefault() { prevented = true; },
		stopPropagation() { stopped = true; },
	};
}

function lifecycleFixture(bindings: readonly string[], persistentEnabled = false) {
	const momentaryChanges: boolean[] = [];
	let toggles = 0;
	let persistent = persistentEnabled;
	let scheduled: (() => void) | null = null;
	let scheduledDelay = 0;
	let cancelled = 0;
	const lifecycle = createSplitToolShortcutLifecycle({
		bindings,
		persistentEnabled,
		onMomentaryChange: (enabled) => {
			momentaryChanges.push(enabled);
		},
		onTogglePersistent: () => {
			toggles += 1;
			persistent = !persistent;
		},
		schedule: (callback, delay) => {
			scheduled = callback;
			scheduledDelay = delay;
			return callback;
		},
		cancelScheduled: () => { cancelled += 1; },
	});
	return {
		lifecycle,
		momentaryChanges,
		get toggles() { return toggles; },
		get persistentEnabled() { return persistent; },
		get scheduledDelay() { return scheduledDelay; },
		fireHoldThreshold: () => scheduled?.(),
		get cancelled() { return cancelled; },
	};
}

test('split-tool shortcut target exclusions retain editing/menu keys without stranding tool keys on controls', () => {
	let selector = '';
	const excludedTarget = {
		closest: (candidate: string) => {
			selector = candidate;
			return {} as Element;
		},
	} as unknown as EventTarget;
	assert.equal(isSplitToolShortcutTargetExcluded(excludedTarget), true);
	for (const fragment of [
		'input', 'textarea', 'select', '[contenteditable]',
		'[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', '[role="menu"]', '[role="menubar"]',
		'[role="menuitem"]',
	]) {
		assert.equal(selector.includes(fragment), true, fragment);
	}
	const controlTarget = {
		closest: (candidate: string) => candidate.includes('button') ? {} as Element : null,
	} as unknown as EventTarget;
	assert.equal(isSplitToolShortcutTargetExcluded(controlTarget), true);
	assert.equal(isSplitToolShortcutTargetExcluded(controlTarget, keyEvent('s')), false);
	assert.equal(isSplitToolShortcutTargetExcluded(controlTarget, keyEvent('Enter', { code: 'Enter' })), true);
	assert.equal(isSplitToolShortcutTargetExcluded({} as EventTarget), false);
	assert.equal(isSplitToolShortcutTargetExcluded(null), false);
});

test('split-tool shortcut stays scoped to the owning editor root', () => {
	const ownedTarget = {} as EventTarget;
	const outsideTarget = {} as EventTarget;
	const root = {
		contains: (candidate: unknown) => candidate === ownedTarget,
	} as unknown as Element;

	assert.equal(isSplitToolShortcutTargetWithinRoot(ownedTarget, root), true);
	assert.equal(isSplitToolShortcutTargetWithinRoot(outsideTarget, root), false);
	assert.equal(isSplitToolShortcutTargetWithinRoot(ownedTarget, null), false);
	assert.equal(isSplitToolShortcutTargetWithinRoot(null, root), false);
});

test('an open modal excludes Split Tool even when focus remains behind it', () => {
	const modal = {
		getAttribute: (name: string) => name === 'role' ? 'alertdialog' : null,
	};
	const target = {
		closest: () => null,
		ownerDocument: {
			querySelectorAll: (selector: string) => selector === '[aria-modal="true"]' ? [modal] : [],
		},
	} as unknown as EventTarget;

	assert.equal(isSplitToolShortcutTargetExcluded(target), true);
});

test('split tool starts only for an exact configured chord and consumes handled keydowns', () => {
	const plain = lifecycleFixture(['S']);
	const shiftedS = keyEvent('S', { shiftKey: true });
	assert.equal(plain.lifecycle.handleKeyDown(shiftedS), false);
	assert.equal(shiftedS.prevented, false);
	assert.equal(shiftedS.stopped, false);
	assert.deepEqual(plain.momentaryChanges, []);

	const plainS = keyEvent('s');
	assert.equal(plain.lifecycle.handleKeyDown(plainS), true);
	assert.equal(plainS.prevented, true);
	assert.equal(plainS.stopped, true);
	assert.deepEqual(plain.momentaryChanges, [true]);

	const shifted = lifecycleFixture(['Shift+S']);
	assert.equal(shifted.lifecycle.handleKeyDown(keyEvent('s')), false);
	assert.equal(shifted.lifecycle.handleKeyDown(keyEvent('S', { shiftKey: true })), true);

	const reassigned = lifecycleFixture(['K']);
	assert.equal(reassigned.lifecycle.handleKeyDown(keyEvent('s')), false);
	assert.equal(reassigned.lifecycle.handleKeyDown(keyEvent('k', { code: 'KeyK' })), true);
});

test('split-tool matching supports custom shifted-punctuation bindings from browser key codes', () => {
	for (const [binding, key, code] of [
		['Shift+`', '~', 'Backquote'],
		['Shift+,', '<', 'Comma'],
		['Shift+.', '>', 'Period'],
	] as const) {
		assert.equal(matchesSplitToolShortcut(keyEvent(key, { code, shiftKey: true }), [binding]), true, binding);
		assert.equal(matchesSplitToolShortcut(keyEvent(key, { code }), [binding]), false, `${binding} requires Shift`);
	}
});

test('split-tool tap toggles persistently before the Audacity hold threshold', () => {
	const fixture = lifecycleFixture(['S']);
	const down = keyEvent('s');
	assert.equal(fixture.lifecycle.handleKeyDown(down), true);
	assert.equal(fixture.scheduledDelay, SPLIT_TOOL_HOLD_MILLISECONDS);
	assert.equal(SPLIT_TOOL_HOLD_MILLISECONDS, 250);

	const up = keyEvent('s');
	assert.equal(fixture.lifecycle.handleKeyUp(up), true);
	assert.equal(up.prevented, true);
	assert.equal(up.stopped, true);
	assert.deepEqual(fixture.momentaryChanges, [true, false]);
	assert.equal(fixture.toggles, 1);
	assert.equal(fixture.persistentEnabled, true);
});

test('split-tool hold is momentary and keyup always leaves persistent mode off', () => {
	for (const persistentEnabled of [false, true]) {
		const fixture = lifecycleFixture(['S'], persistentEnabled);
		assert.equal(fixture.lifecycle.handleKeyDown(keyEvent('s')), true);
		fixture.fireHoldThreshold();
		assert.equal(fixture.lifecycle.handleKeyUp(keyEvent('s')), true);
		assert.deepEqual(fixture.momentaryChanges, [true, false]);
		assert.equal(fixture.toggles, persistentEnabled ? 1 : 0);
		assert.equal(fixture.persistentEnabled, false);
	}
});

test('split-tool repeat stays consumed without restarting the press lifecycle', () => {
	const fixture = lifecycleFixture(['S']);
	assert.equal(fixture.lifecycle.handleKeyDown(keyEvent('s')), true);
	const repeated = keyEvent('s', { repeat: true });
	assert.equal(fixture.lifecycle.handleKeyDown(repeated), true);
	assert.equal(repeated.prevented, true);
	assert.equal(repeated.stopped, true);
	assert.deepEqual(fixture.momentaryChanges, [true]);
});

test('Escape and blur end both momentary and persistent split-tool states', () => {
	const escaped = lifecycleFixture(['Shift+S'], true);
	assert.equal(escaped.lifecycle.handleKeyDown(keyEvent('S', { shiftKey: true })), true);
	const escape = keyEvent('Escape', { code: 'Escape' });
	assert.equal(escaped.lifecycle.handleKeyDown(escape), true);
	assert.equal(escape.prevented, true);
	assert.equal(escape.stopped, true);
	assert.deepEqual(escaped.momentaryChanges, [true, false]);
	assert.equal(escaped.toggles, 1);
	assert.equal(escaped.persistentEnabled, false);
	assert.equal(escaped.lifecycle.handleKeyUp(keyEvent('s')), false);

	const blurred = lifecycleFixture(['S'], true);
	assert.equal(blurred.lifecycle.handleKeyDown(keyEvent('s')), true);
	assert.equal(blurred.lifecycle.handleBlur(), true);
	assert.deepEqual(blurred.momentaryChanges, [true, false]);
	assert.equal(blurred.toggles, 1);
	assert.equal(blurred.persistentEnabled, false);

	const persistentOnly = lifecycleFixture(['S'], true);
	assert.equal(persistentOnly.lifecycle.handleBlur(), true);
	assert.equal(persistentOnly.persistentEnabled, false);

	const escapedPersistent = lifecycleFixture(['S'], true);
	const persistentEscape = keyEvent('Escape', { code: 'Escape' });
	assert.equal(escapedPersistent.lifecycle.handleKeyDown(persistentEscape), true);
	assert.equal(persistentEscape.prevented, true);
	assert.equal(persistentEscape.stopped, true);
	assert.equal(escapedPersistent.persistentEnabled, false);
});

test('an Escape rebind activates Split Tool only from its inactive state', () => {
	const inactive = lifecycleFixture(['Escape']);
	const down = keyEvent('Escape', { code: 'Escape' });
	assert.equal(inactive.lifecycle.handleKeyDown(down), true);
	assert.deepEqual(inactive.momentaryChanges, [true]);
	assert.equal(inactive.lifecycle.handleKeyUp(keyEvent('Escape', { code: 'Escape' })), true);
	assert.equal(inactive.persistentEnabled, true);

	const active = lifecycleFixture(['Escape'], true);
	assert.equal(active.lifecycle.handleKeyDown(keyEvent('Escape', { code: 'Escape' })), true);
	assert.deepEqual(active.momentaryChanges, []);
	assert.equal(active.persistentEnabled, false, 'active Escape remains the tool-cancel gesture');
	assert.equal(active.lifecycle.handleKeyUp(keyEvent('Escape', { code: 'Escape' })), false);
});

test('keyup completes a modified chord after its modifier was released first', () => {
	const fixture = lifecycleFixture(['Shift+S']);
	assert.equal(fixture.lifecycle.handleKeyDown(keyEvent('S', { shiftKey: true })), true);
	assert.equal(fixture.lifecycle.handleKeyUp(keyEvent('s')), true);
	assert.equal(fixture.toggles, 1);
});
