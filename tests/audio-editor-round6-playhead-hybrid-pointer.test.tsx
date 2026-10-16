/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TelemetryPlayhead } from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const pointerType of ['pen', 'mouse']) test(`a primary ${pointerType} cannot replace an active touch playhead scrub`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true,
		addEventListener: (): void => undefined, removeEventListener: (): void => undefined })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const document = dom.container.ownerDocument;
	const createElement = document.createElement.bind(document);
	document.createElement = (tagName: string) => {
		const element = createElement(tagName);
		if (tagName === 'canvas') Object.defineProperty(element, 'getContext', { value: () => null });
		return element;
	};
	let positionFrame = 100;
	let ended = 0;
	const captures: number[] = [];
	const releases: number[] = [];
	const controller = {
		getTelemetrySnapshot: () => ({ positionFrame: 100 }), subscribeTelemetry: () => () => undefined,
		engine: { getPositionFrames: () => positionFrame },
		actions: { transport: { scrub(frame: number) { positionFrame = frame; },
			endScrub() { ended++; }, seek(frame: number) { positionFrame = frame; } } },
	};
	try {
		await act(async () => { root.render(<TelemetryPlayhead controller={controller} copy={ENGLISH_COPY}
			durationFrames={48_000} panelWidth={100} viewportWidth={800} pixelsPerSecond={100}
			sampleRate={48_000} height={200} run={(action: () => unknown) => action()} />); });
		const host = dom.one('.audio-editor-playhead-boundary');
		const target = dom.one('.playhead-cursor__icon');
		const event = (pointerId: number, clientX: number, type = 'touch') => ({
			pointerId, clientX, pointerType: type, button: 0, isPrimary: true, target,
			currentTarget: { setPointerCapture(id: number) { captures.push(id); },
				releasePointerCapture(id: number) { releases.push(id); } },
			preventDefault() {}, stopPropagation() {},
		});
		const send = async (handler: string, pointerId: number, clientX: number, type = 'touch'): Promise<void> => {
			await act(async () => { reactProps(host)[handler]?.(event(pointerId, clientX, type)); });
		};
		await send('onPointerDownCapture', 1, 100);
		await send('onPointerMoveCapture', 1, 110);
		assert.equal(positionFrame, 4900, 'the primary finger scrubs normally');
		await send('onPointerDownCapture', 2, 110, pointerType);
		assert.deepEqual(captures, [1], 'another primary pointer must not replace the finger');
		await send('onPointerUpCapture', 2, 110, pointerType);
		assert.equal(ended, 0);
		await send('onPointerMoveCapture', 1, 120);
		assert.equal(positionFrame, 9700, 'the finger continues from its original frame and anchor');
		await send('onPointerUpCapture', 1, 120);
		assert.equal(ended, 1);
		assert.deepEqual(releases, [1]);
		await send('onPointerDownCapture', 3, 120, pointerType);
		await send('onPointerMoveCapture', 3, 130, pointerType);
		assert.equal(positionFrame, 14500, 'a later independent pointer starts normally');
		await send('onPointerCancelCapture', 3, 130, pointerType);
		assert.equal(ended, 2);
	} finally {
		await act(async () => { root.unmount(); });
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		dom.restore();
	}
});
