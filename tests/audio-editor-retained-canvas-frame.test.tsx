/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode, useLayoutEffect, useRef, type RefObject } from 'react';
import { useRetainedCanvasFrame } from '../src/common/editor/ui/timeline/useRetainedCanvasFrame.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

void test('a child acquires its canvas root after host attachment and retains the latest scheduled draw', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const previousRequest = window.requestAnimationFrame;
	const previousCancel = window.cancelAnimationFrame;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	const observedRoots: Element[] = [];
	let disconnects = 0;
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
		observe(element: Element) { observedRoots.push(element); }
		disconnect() { disconnects++; }
	} });
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = frame => { frames.delete(frame); };
	const draws: number[] = [];
	function Child({ rootRef, value }: { rootRef: RefObject<HTMLDivElement | null>; value: number }) {
		const draw = useRetainedCanvasFrame(rootRef);
		useLayoutEffect(() => { draw(() => draws.push(value)); }, [draw, value]);
		return null;
	}
	function Harness({ value }: { value: number }) {
		const rootRef = useRef<HTMLDivElement>(null);
		return <div ref={rootRef}><Child rootRef={rootRef} value={value} /></div>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness value={0} />));
		assert.deepEqual(draws, [], 'child layout runs before its parent host ref attaches');
		assert.equal(frames.size, 1, 'initial attachment owns one retry without needing another prop publication');
		await act(async () => { const [frame, callback] = [...frames.entries()][0]!; frames.delete(frame); callback(0); });
		assert.deepEqual(draws, [0], 'the attached parent paints the cached row on the first frame');
		await act(async () => root.render(<Harness value={1} />));
		await act(async () => root.render(<Harness value={2} />));
		await act(async () => root.render(<Harness value={3} />));
		assert.equal(observedRoots.length, 1, 'only the retained root is observed across child commits');
		assert.equal(observedRoots[0], dom.container.firstChild);
		assert.equal(frames.size, 1);
		await act(async () => { const [frame, callback] = [...frames.entries()][0]!; frames.delete(frame); callback(0); });
		assert.deepEqual(draws, [0, 3]);
		await act(async () => root.render(<Harness value={4} />));
		assert.equal(frames.size, 1);
		await act(async () => root.unmount());
		assert.equal(frames.size, 0, 'unmount cancels the owned pending frame');
		assert.equal(disconnects, 1, 'unmount disconnects the root observer');
	} finally {
		await act(async () => root.unmount());
		window.requestAnimationFrame = previousRequest;
		window.cancelAnimationFrame = previousCancel;
		if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'ResizeObserver');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

void test('missing roots retain one cancellable retry and replaced roots release stale draws', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const previousRequest = window.requestAnimationFrame;
	const previousCancel = window.cancelAnimationFrame;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	const observedRoots: Element[] = [];
	const resizeCallbacks: Array<() => void> = [];
	let disconnects = 0;
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
		constructor(callback: () => void) { resizeCallbacks.push(callback); }
		observe(element: Element) { observedRoots.push(element); }
		disconnect() { disconnects++; }
	} });
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = frame => { frames.delete(frame); };
	const firstRef: RefObject<HTMLElement | null> = { current: null };
	const secondRef: RefObject<HTMLElement | null> = { current: null };
	const draws: number[] = [];
	function Child({ rootRef, value }: { rootRef: RefObject<HTMLElement | null>; value: number }) {
		const draw = useRetainedCanvasFrame(rootRef);
		useLayoutEffect(() => { draw(() => draws.push(value)); }, [draw, value]);
		return null;
	}
	const flush = async () => {
		await act(async () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); });
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Child rootRef={firstRef} value={0} />));
		assert.equal(frames.size, 1);
		const canceledRetry = [...frames.values()][0]!;
		await flush(); await flush();
		assert.equal(frames.size, 0, 'a still-missing host gets only one retry per explicit draw request');
		assert.equal(observedRoots.length, 0);
		const firstHost = document.createElement('div');
		firstRef.current = firstHost;
		await act(async () => root.render(<Child rootRef={firstRef} value={1} />));
		assert.deepEqual(draws, [1], 'a new explicit draw acquires a previously missing host');
		assert.equal(observedRoots.length, 1);
		await act(async () => root.render(<Child rootRef={secondRef} value={2} />));
		await act(async () => canceledRetry(0));
		assert.deepEqual(draws, [1], 'a canceled retry cannot acquire a replaced ref');
		const secondHost = document.createElement('div');
		secondRef.current = secondHost;
		await flush();
		assert.deepEqual(draws, [1, 2]);
		assert.equal(observedRoots.length, 2);
		assert.equal(observedRoots[1], secondHost);
		await act(async () => root.render(<Child rootRef={secondRef} value={3} />));
		const thirdHost = document.createElement('div');
		secondRef.current = thirdHost;
		await flush();
		assert.deepEqual(draws, [1, 2, 3], 'a scheduled paint reacquires the current host');
		assert.equal(observedRoots[2], thirdHost);
		assert.equal(disconnects, 2);
		resizeCallbacks[0]!();
		assert.equal(frames.size, 0, 'a released root cannot schedule another paint');
		await act(async () => root.render(<Child rootRef={secondRef} value={4} />));
		await act(async () => root.unmount());
		assert.equal(frames.size, 0);
		assert.equal(disconnects, 3);
	} finally {
		await act(async () => root.unmount());
		window.requestAnimationFrame = previousRequest;
		window.cancelAnimationFrame = previousCancel;
		if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'ResizeObserver');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

void test('unmount cancels a missing-root retry before any observer or draw is acquired', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const previousRequest = window.requestAnimationFrame;
	const previousCancel = window.cancelAnimationFrame;
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = frame => { frames.delete(frame); };
	const rootRef: RefObject<HTMLElement | null> = { current: null };
	let draws = 0;
	function Child() {
		const draw = useRetainedCanvasFrame(rootRef);
		useLayoutEffect(() => { draw(() => { draws++; }); }, [draw]);
		return null;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Child />));
		assert.equal(frames.size, 1);
		const canceled = [...frames.values()][0]!;
		await act(async () => root.unmount());
		assert.equal(frames.size, 0);
		rootRef.current = document.createElement('div');
		await act(async () => canceled(0));
		assert.equal(draws, 0);
		assert.equal(frames.size, 0);
	} finally {
		await act(async () => root.unmount());
		window.requestAnimationFrame = previousRequest;
		window.cancelAnimationFrame = previousCancel;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

void test('strict effect cleanup cancels attachment retries and reacquires the mounted parent once', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	let observers = 0;
	let disconnects = 0;
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
		observe() { observers++; }
		disconnect() { disconnects++; }
	} });
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = frame => { frames.delete(frame); };
	const draws: number[] = [];
	function Child({ rootRef, value }: { rootRef: RefObject<HTMLDivElement | null>; value: number }) {
		const draw = useRetainedCanvasFrame(rootRef);
		useLayoutEffect(() => { draw(() => draws.push(value)); }, [draw, value]);
		return null;
	}
	function Harness({ value }: { value: number }) {
		const rootRef = useRef<HTMLDivElement>(null);
		return <div ref={rootRef}><Child rootRef={rootRef} value={value} /></div>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<StrictMode><Harness value={0} /></StrictMode>));
		await act(async () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); });
		assert.deepEqual(draws, [0]);
		assert.equal(observers, 1, 'strict remount observes only the acquired parent');
		assert.equal(frames.size, 0);
		await act(async () => root.render(<StrictMode><Harness value={1} /></StrictMode>));
		assert.equal(frames.size, 1);
		await act(async () => root.unmount());
		assert.equal(frames.size, 0);
		assert.equal(disconnects, 1);
	} finally {
		await act(async () => root.unmount());
		if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'ResizeObserver');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
