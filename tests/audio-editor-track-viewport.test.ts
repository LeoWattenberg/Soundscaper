/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	observeTrackViewportRow,
	registerTrackViewportReveal,
	revealTrackViewportRow,
} from '../src/common/editor/ui/timeline/track-viewport-observer.ts';

test('track viewport shares one observer and measures initial rows before mounting expensive content', () => {
	const original = globalThis.IntersectionObserver;
	const observers: FakeObserver[] = [];
	class FakeObserver {
		observed = new Set<Element>();
		disconnected = false;
		constructor(readonly notify: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
			observers.push(this);
		}
		observe(row: Element) { this.observed.add(row); }
		unobserve(row: Element) { this.observed.delete(row); }
		disconnect() { this.disconnected = true; }
	}
	globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
	try {
		const listeners = new Map<string, EventListener>();
		const document = {
			addEventListener: (type: string, listener: EventListener) => { listeners.set(type, listener); },
			removeEventListener: (type: string) => { listeners.delete(type); },
		};
		const root = { getBoundingClientRect: () => ({ top: 100, bottom: 500 }), ownerDocument: document };
		const row = (top: number, bottom: number) => ({
			closest: () => root,
			getBoundingClientRect: () => ({ top, bottom }),
		}) as unknown as HTMLElement;
		const visible: boolean[][] = [[], [], []];
		const interactions: boolean[][] = [[], [], []];
		const rows = [row(110, 210), row(540, 640), row(4_000, 4_100)];
		const dispose = rows.map((element, index) => observeTrackViewportRow(element, (value) => {
			visible[index]!.push(value);
		}, (value) => { interactions[index]!.push(value); }));
		assert.deepEqual(visible, [[true], [true], [false]], 'nearby rows are ready before they scroll onscreen');
		assert.equal(observers.length, 1);
		assert.equal(observers[0]?.observed.size, 3);
		assert.equal(observers[0]?.options.root, root);
		assert.equal(observers[0]?.options.rootMargin, '64px 0px');
		const target = { closest: () => rows[0] };
		listeners.get('pointerdown')?.({ target, type: 'pointerdown' } as unknown as Event);
		listeners.get('dragstart')?.({ target, type: 'dragstart' } as unknown as Event);
		assert.deepEqual(interactions, [[false, true], [], []]);
		assert.equal(listeners.size, 2, 'interaction capture is shared across rows');
		const observer = observers[0]!;
		observer.notify([
			{ target: rows[0], isIntersecting: false },
			{ target: rows[2], isIntersecting: true },
		] as unknown as IntersectionObserverEntry[], observer as unknown as IntersectionObserver);
		assert.deepEqual(visible, [[true, false], [true], [false, true]]);
		dispose[0]!();
		assert.equal(observer.disconnected, false);
		assert.equal(observer.observed.size, 2);
		dispose[1]!();
		dispose[2]!();
		assert.equal(observer.disconnected, true);
		assert.equal(listeners.size, 0);
	} finally {
		globalThis.IntersectionObserver = original;
	}
});

test('track viewport navigation reveals a culled row synchronously and unregisters removed rows', () => {
	const row = {} as HTMLElement;
	const selectors: string[] = [];
	const root = {
		querySelector: (selector: string) => { selectors.push(selector); return row; },
	} as unknown as Element;
	let mounted = false;
	const dispose = registerTrackViewportReveal(row, () => { mounted = true; });
	revealTrackViewportRow(root, 49);
	assert.equal(mounted, true);
	assert.deepEqual(selectors, ['[data-track-viewport-row][data-track-index="49"]']);
	dispose();
	mounted = false;
	revealTrackViewportRow(root, 49);
	assert.equal(mounted, false);
	revealTrackViewportRow(null, 49);
});

test('track viewport falls back to mounted rows when the browser has no IntersectionObserver', () => {
	const original = globalThis.IntersectionObserver;
	Reflect.deleteProperty(globalThis, 'IntersectionObserver');
	try {
		const visible: boolean[] = [];
		const dispose = observeTrackViewportRow({} as HTMLElement, (value) => { visible.push(value); });
		assert.deepEqual(visible, [true]);
		dispose();
	} finally {
		globalThis.IntersectionObserver = original;
	}
});
