/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import {
	ContextMenuItem,
	createSafeTriangleTracker,
} from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';

const ITEM_URL = new URL(
	'../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx',
	import.meta.url,
);

// The submenu sits to the right of the exit point, so the safe triangle
// spans from (0, 50) out to the submenu's left edge at x = 100.
const SUBMENU_RECT = { left: 100, right: 300, top: 0, bottom: 100 };
const ORIGIN = { x: 0, y: 50 };

type Listener = (event: unknown) => void;

function installFakeDom() {
	const listeners = new Map<string, Listener[]>();
	const timers = new Map<number, () => void>();
	let nextTimerId = 1;

	const previousDocument = Reflect.get(globalThis, 'document');
	const previousWindow = Reflect.get(globalThis, 'window');

	// addEventListener de-duplicates on (type, callback), exactly as the
	// DOM does — a handler whose identity changes every render is what
	// this test is about, so the fake must not paper over it.
	const fakeDocument = {
		addEventListener(type: string, listener: Listener) {
			const bucket = listeners.get(type) ?? [];
			if (!bucket.includes(listener)) bucket.push(listener);
			listeners.set(type, bucket);
		},
		removeEventListener(type: string, listener: Listener) {
			const bucket = listeners.get(type) ?? [];
			listeners.set(type, bucket.filter((entry) => entry !== listener));
		},
	};
	const fakeWindow = {
		setTimeout(callback: () => void) {
			const id = nextTimerId++;
			timers.set(id, callback);
			return id;
		},
		clearTimeout(id: number) {
			timers.delete(id);
		},
	};

	Reflect.set(globalThis, 'document', fakeDocument);
	Reflect.set(globalThis, 'window', fakeWindow);

	return {
		count: (type = 'mousemove') => (listeners.get(type) ?? []).length,
		dispatch: (event: unknown, type = 'mousemove') => {
			for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
		},
		runTimers: () => {
			for (const [id, callback] of [...timers]) {
				timers.delete(id);
				callback();
			}
		},
		pendingTimers: () => timers.size,
		restore: () => {
			Reflect.set(globalThis, 'document', previousDocument);
			Reflect.set(globalThis, 'window', previousWindow);
		},
	};
}

// Stands in for the submenu element the pointer can wander back onto.
const SUBMENU_NODE = {} as EventTarget;

function move(x: number, y: number, target: EventTarget | null = null) {
	return { clientX: x, clientY: y, target };
}

test('arming and clearing the safe triangle leaves no document listener behind', () => {
	const dom = installFakeDom();
	try {
		const closes: number[] = [];
		const tracker = createSafeTriangleTracker({
			isReentry: () => false,
			onLeave: () => closes.push(1),
		});
		// The unmount cleanup holds whatever reference it captured when
		// the component first rendered, long before any arming happened.
		const { clear } = tracker;

		tracker.arm(ORIGIN, SUBMENU_RECT);
		assert.equal(dom.count(), 1);

		clear();
		assert.equal(dom.count(), 0, 'the armed mousemove listener outlived its owner');
		assert.equal(dom.pendingTimers(), 0);

		dom.dispatch(move(500, 500));
		assert.deepEqual(closes, []);
	} finally {
		dom.restore();
	}
});

test('re-arming and clearing repeatedly never accumulates listeners', () => {
	const dom = installFakeDom();
	try {
		const tracker = createSafeTriangleTracker({ isReentry: () => false, onLeave: () => {} });

		for (let i = 0; i < 5; i += 1) {
			tracker.arm(ORIGIN, SUBMENU_RECT);
			assert.equal(dom.count(), 1);
			tracker.clear();
			assert.equal(dom.count(), 0);
		}
	} finally {
		dom.restore();
	}
});

test('the safe triangle keeps the submenu open along the diagonal and closes on a detour', () => {
	const dom = installFakeDom();
	try {
		let closes = 0;
		const tracker = createSafeTriangleTracker({ isReentry: () => false, onLeave: () => { closes += 1; } });

		tracker.arm(ORIGIN, SUBMENU_RECT);
		dom.dispatch(move(50, 40));
		assert.equal(closes, 0, 'a pointer cutting the corner toward the submenu should keep it open');
		assert.equal(dom.count(), 1);

		dom.dispatch(move(50, 200));
		assert.equal(closes, 1, 'a pointer straying outside the triangle should close the submenu');
		assert.equal(dom.count(), 0, 'the tracker should tear itself down once it has closed');
	} finally {
		dom.restore();
	}
});

test('re-entering the parent item or its submenu hands control back to the hover handlers', () => {
	const dom = installFakeDom();
	try {
		let closes = 0;
		const tracker = createSafeTriangleTracker({
			isReentry: (target) => target === SUBMENU_NODE,
			onLeave: () => { closes += 1; },
		});

		tracker.arm(ORIGIN, SUBMENU_RECT);
		dom.dispatch(move(500, 500, SUBMENU_NODE));

		assert.equal(closes, 0, 're-entry must not close the submenu');
		assert.equal(dom.count(), 0);
	} finally {
		dom.restore();
	}
});

test('a stalled pointer closes the submenu on the safety timeout and detaches', () => {
	const dom = installFakeDom();
	try {
		let closes = 0;
		const tracker = createSafeTriangleTracker({ isReentry: () => false, onLeave: () => { closes += 1; } });

		tracker.arm(ORIGIN, SUBMENU_RECT);
		assert.equal(dom.pendingTimers(), 1);
		dom.runTimers();

		assert.equal(closes, 1);
		assert.equal(dom.count(), 0);
	} finally {
		dom.restore();
	}
});

test('ContextMenuItem owns one tracker per instance and tears it down on unmount', async () => {
	const source = await readFile(ITEM_URL, 'utf8');
	const component = source.slice(source.indexOf('export const ContextMenuItem'));

	assert.match(component, /safeTriangleRef\.current = createSafeTriangleTracker\(\{/u);
	assert.match(component, /useEffect\(\(\) => \(\) => safeTriangle\.clear\(\), \[safeTriangle\]\);/u);
	assert.doesNotMatch(
		component,
		/document\.(?:add|remove)EventListener\('mousemove'/u,
		'the mousemove listener must be owned by the tracker, whose identity survives a re-render',
	);
});

test('ContextMenuItem still renders its item and submenu markup', () => {
	const markup = renderToStaticMarkup(
		React.createElement(
			ThemeProvider,
			null,
			React.createElement(ContextMenuItem, { label: 'Parent', hasSubmenu: true }),
		),
	);

	assert.match(markup, /role="menuitem"/u);
	assert.match(markup, />Parent</u);
});
