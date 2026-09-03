/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityRealtimeEffectShortcutHandler } from '../src/common/editor/ui/inspector/audacity-realtime-effect-shortcut.ts';

test('a focused realtime-effect slot owns Alt+Up/Down before clip pitch dispatch', () => {
	const trackStack = stack('track');
	const masterStack = stack('master');
	const calls: unknown[] = [];
	const handler = createAudacityRealtimeEffectShortcutHandler(
		(...args) => calls.push(args),
		{ effects: [{ id: 'track-a' }, { id: 'track-b' }], scope: 'track', targetId: 'track-1' },
		[{ id: 'master-a' }, { id: 'master-b' }],
	);

	const trackEvent = shortcutEvent(trackStack.slots[1]!, 'ArrowUp');
	assert.equal(handler(trackEvent), true);
	assert.deepEqual(calls, [['track', 'track-1', 'track-b', 0]]);
	assert.equal(trackEvent.prevented, true);
	assert.equal(trackEvent.stopped, true);

	const masterEvent = shortcutEvent(masterStack.slots[0]!, 'ArrowDown');
	assert.equal(handler(masterEvent), true);
	assert.deepEqual(calls.at(-1), ['master', null, 'master-a', 1]);
});

test('focused effect boundaries consume the chord without reordering or pitching a clip', () => {
	const rack = stack('track');
	const calls: unknown[] = [];
	const handler = createAudacityRealtimeEffectShortcutHandler(
		(...args) => calls.push(args),
		{ effects: [{ id: 'only' }], scope: 'track', targetId: 'track-1' },
		[],
	);
	const event = shortcutEvent(rack.slots[0]!, 'ArrowUp');

	assert.equal(handler(event), true);
	assert.equal(calls.length, 0);
	assert.equal(event.prevented, true);
	assert.equal(event.stopped, true);
	assert.equal(handler(shortcutEvent(rack.slots[0]!, 'ArrowUp', { altKey: false })), false);
	const blockedHandler = createAudacityRealtimeEffectShortcutHandler(
		(...args) => calls.push(args),
		{ effects: [{ id: 'first' }, { id: 'second' }], scope: 'track', targetId: 'track-1' },
		[],
		undefined,
		true,
	);
	assert.equal(blockedHandler(shortcutEvent(rack.slots[1]!, 'ArrowUp')), true);
	assert.equal(calls.length, 0, 'a blocked editor consumes effect movement without mutating the rack');
});

test('focused effect routing follows the live configured canonical binding', () => {
	const rack = stack('track');
	const calls: unknown[] = [];
	const handler = createAudacityRealtimeEffectShortcutHandler(
		(...args) => calls.push(args),
		{ effects: [{ id: 'first' }, { id: 'second' }], scope: 'track', targetId: 'track-1' },
		[],
		{
			'realtime-effect-move-up': ['Ctrl+Shift+U'],
			'realtime-effect-move-down': ['Ctrl+Shift+D'],
		},
	);

	assert.equal(handler(shortcutEvent(rack.slots[1]!, 'ArrowUp')), false, 'the retired default bubbles');
	assert.equal(handler(shortcutEvent(rack.slots[1]!, 'u', {
		altKey: false, ctrlKey: true, shiftKey: true,
	})), true);
	assert.deepEqual(calls, [['track', 'track-1', 'second', 0]]);
});

interface FakeElement {
	readonly kind: 'slot' | 'stack' | 'section';
	readonly section?: 'track' | 'master';
	readonly parent?: FakeElement;
	readonly slots?: readonly FakeElement[];
	closest(selector: string): FakeElement | null;
	querySelectorAll(selector: string): readonly FakeElement[];
}

function stack(section: 'track' | 'master') {
	const sectionElement = element('section', section);
	const stackElement = element('stack', section, sectionElement);
	const slots = [element('slot', section, stackElement), element('slot', section, stackElement)];
	Object.assign(stackElement, { slots });
	return { slots, stack: stackElement };
}

function element(kind: FakeElement['kind'], section?: FakeElement['section'], parent?: FakeElement): FakeElement {
	return {
		kind,
		section,
		parent,
		closest(selector) {
			if (selector === '.effect-slot' && this.kind === 'slot') return this;
			if (selector === '.effects-panel__effect-stack' && this.kind === 'stack') return this;
			if (selector === '.effects-panel__master-section' && this.kind === 'section' && this.section === 'master') return this;
			for (let current = this.parent; current; current = current.parent) {
				if (selector === '.effect-slot' && current.kind === 'slot') return current;
				if (selector === '.effects-panel__effect-stack' && current.kind === 'stack') return current;
				if (selector === '.effects-panel__master-section' && current.kind === 'section' && current.section === 'master') return current;
			}
			return null;
		},
		querySelectorAll(selector) {
			return selector === '.effect-slot' && this.kind === 'stack' ? this.slots || [] : [];
		},
	};
}

function shortcutEvent(
	target: FakeElement,
	key: string,
	overrides: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {},
) {
	return {
		altKey: true,
		code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		key,
		target: target as unknown as EventTarget,
		prevented: false,
		stopped: false,
		preventDefault() { this.prevented = true; },
		stopPropagation() { this.stopped = true; },
		...overrides,
	};
}
