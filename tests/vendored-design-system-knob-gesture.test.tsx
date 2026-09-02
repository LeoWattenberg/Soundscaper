/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { Knob } from '../vendor/audacity-design-system/components/src/Knob/Knob.tsx';
import {
	installReactTestDom,
	reactProps,
	type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('knob pointer gestures settle once across capture loss, cancellation, blur, and unmount', async () => {
	const priorAddEventListener = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
	const priorRemoveEventListener = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
	const blurListeners = new Set<EventListenerOrEventListenerObject>();
	Object.defineProperty(globalThis, 'addEventListener', {
		configurable: true,
		value: (type: string, listener: EventListenerOrEventListenerObject) => {
			if (type === 'blur') blurListeners.add(listener);
		},
	});
	Object.defineProperty(globalThis, 'removeEventListener', {
		configurable: true,
		value: (type: string, listener: EventListenerOrEventListenerObject) => {
			if (type === 'blur') blurListeners.delete(listener);
		},
	});
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const starts: number[] = [];
	const changes: number[] = [];
	const ends: number[] = [];
	let cancellations = 0;
	const captures: number[] = [];
	const releases: number[] = [];
	const captured = new Set<number>();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let mounted = true;
	try {
		await act(async () => root.render(<Knob
			value={0}
			min={-100}
			max={100}
			step={1}
			onGestureStart={(value) => starts.push(value)}
			onChange={(value) => changes.push(value)}
			onGestureEnd={(value) => ends.push(value)}
			onGestureCancel={() => { cancellations += 1; }}
		/>));
		const button = dom.one('button');
		const pointerTarget = button as ReactTestElement & {
			setPointerCapture(pointerId: number): void;
			hasPointerCapture(pointerId: number): boolean;
			releasePointerCapture(pointerId: number): void;
		};
		pointerTarget.setPointerCapture = (pointerId) => {
			captures.push(pointerId);
			captured.add(pointerId);
		};
		pointerTarget.hasPointerCapture = (pointerId) => captured.has(pointerId);
		pointerTarget.releasePointerCapture = (pointerId) => {
			releases.push(pointerId);
			captured.delete(pointerId);
		};

		await invoke(button, 'onPointerDown', pointerEvent(pointerTarget, 11, 'touch', 10, 10));
		const blurAfterTouchUp = onlyBlurListener(blurListeners);
		await invoke(button, 'onPointerMove', pointerEvent(pointerTarget, 11, 'touch', 50, 10));
		await invoke(button, 'onPointerUp', pointerEvent(pointerTarget, 11, 'touch', 50, 10));
		await invoke(button, 'onLostPointerCapture', pointerEvent(pointerTarget, 11, 'touch', 50, 10));
		await invokeListener(blurAfterTouchUp);
		assert.deepEqual(ends, [40]);
		assert.equal(cancellations, 0);

		await invoke(button, 'onPointerDown', pointerEvent(pointerTarget, 22, 'pen', 20, 20));
		const blurAfterPenCancel = onlyBlurListener(blurListeners);
		await invoke(button, 'onPointerMove', pointerEvent(pointerTarget, 22, 'pen', 20, 0));
		await invoke(button, 'onPointerCancel', pointerEvent(pointerTarget, 22, 'pen', 20, 0));
		await invoke(button, 'onLostPointerCapture', pointerEvent(pointerTarget, 22, 'pen', 20, 0));
		await invokeListener(blurAfterPenCancel);
		assert.deepEqual(ends, [40]);
		assert.equal(cancellations, 1);

		await invoke(button, 'onPointerDown', pointerEvent(pointerTarget, 33, 'mouse', 30, 30));
		const blurAfterUnexpectedLoss = onlyBlurListener(blurListeners);
		await invoke(button, 'onLostPointerCapture', pointerEvent(pointerTarget, 33, 'mouse', 30, 30));
		await invokeListener(blurAfterUnexpectedLoss);
		assert.equal(cancellations, 2);

		await invoke(button, 'onPointerDown', pointerEvent(pointerTarget, 44, 'touch', 40, 40));
		const activeBlur = onlyBlurListener(blurListeners);
		await invoke(button, 'onPointerMove', pointerEvent(pointerTarget, 44, 'touch', 40, 15));
		await invokeListener(activeBlur);
		await invoke(button, 'onPointerUp', pointerEvent(pointerTarget, 44, 'touch', 40, 15));
		await invoke(button, 'onLostPointerCapture', pointerEvent(pointerTarget, 44, 'touch', 40, 15));
		assert.deepEqual(ends, [40, 25]);
		assert.equal(cancellations, 2);

		await invoke(button, 'onPointerDown', pointerEvent(pointerTarget, 55, 'pen', 50, 50));
		const blurAfterUnmount = onlyBlurListener(blurListeners);
		await act(async () => root.unmount());
		mounted = false;
		await invokeListener(blurAfterUnmount);
		assert.deepEqual(starts, [0, 0, 0, 0, 0]);
		assert.deepEqual(changes, [40, 20, 25]);
		assert.deepEqual(captures, [11, 22, 33, 44, 55]);
		assert.deepEqual(releases, [11, 22, 33, 44, 55]);
		assert.equal(cancellations, 3);
	} finally {
		if (mounted) await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
		restoreGlobalProperty('addEventListener', priorAddEventListener);
		restoreGlobalProperty('removeEventListener', priorRemoveEventListener);
	}
});

async function invoke(
	button: ReactTestElement,
	handler: string,
	event: Readonly<Record<string, unknown>>,
): Promise<void> {
	await act(async () => {
		reactProps(button)[handler]?.(event);
	});
}

async function invokeListener(listener: EventListenerOrEventListenerObject): Promise<void> {
	await act(async () => {
		const event = { type: 'blur' } as Event;
		if (typeof listener === 'function') listener(event);
		else listener.handleEvent(event);
	});
}

function onlyBlurListener(
	listeners: ReadonlySet<EventListenerOrEventListenerObject>,
): EventListenerOrEventListenerObject {
	assert.equal(listeners.size, 1);
	return [...listeners][0]!;
}

function pointerEvent(
	currentTarget: ReactTestElement,
	pointerId: number,
	pointerType: 'mouse' | 'pen' | 'touch',
	clientX: number,
	clientY: number,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		button: 0,
		pointerId,
		pointerType,
		isPrimary: true,
		clientX,
		clientY,
		currentTarget,
		preventDefault() {},
		stopPropagation() {},
	});
}

function restoreGlobalProperty(
	name: 'addEventListener' | 'removeEventListener',
	descriptor: PropertyDescriptor | undefined,
): void {
	if (descriptor) Object.defineProperty(globalThis, name, descriptor);
	else Reflect.deleteProperty(globalThis, name);
}
