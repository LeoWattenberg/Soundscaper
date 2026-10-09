/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EnvelopeInteractionLayer, type EnvelopePoint } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/EnvelopeInteractionLayer.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const existingPoint of [false, true]) for (const button of [0, 1, 2]) {
	test(`clip gain ${existingPoint ? 'point removal' : 'point insertion'} requires primary button, hardware ${String(button)}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const document = dom.container.ownerDocument as unknown as Document;
		const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
		document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (!listener) return;
			const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
			entries.add(listener);
			listeners.set(type, entries);
		};
		document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (listener) listeners.get(type)?.delete(listener);
		};
		const root = createRoot(dom.container as unknown as Element);
		const original: EnvelopePoint[] = existingPoint ? [{ time: .5, db: 0 }] : [];
		const updates: EnvelopePoint[][] = [];
		const claims: string[] = [];
		try {
			await act(async () => root.render(<EnvelopeInteractionLayer envelopePoints={original}
				onEnvelopePointsChange={next => updates.push(next)} enabled width={100} height={100} duration={1} />));
			const surface = dom.one('div');
			(surface as unknown as { getBoundingClientRect(): object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
			await act(async () => reactProps(surface).onMouseDown?.({ button, clientX: 50, clientY: 97 * (1 - (5 / 6) ** 3),
				stopPropagation() { claims.push('stop'); } }));
			await act(async () => {
				const event = { type: 'mouseup', button } as MouseEvent;
				for (const listener of listeners.get('mouseup') ?? []) {
					if (typeof listener === 'function') listener(event);
					else listener.handleEvent(event);
				}
			});
			assert.equal(updates.length, button === 0 ? 1 : 0);
			assert.deepEqual(claims, button === 0 ? ['stop'] : []);
			if (button === 0) {
				assert.equal(updates[0]?.length, existingPoint ? 0 : 1);
				if (!existingPoint) assert.equal(updates[0]?.[0]?.time, .5);
			}
			assert.deepEqual(original, existingPoint ? [{ time: .5, db: 0 }] : []);
		} finally {
			await act(async () => root.unmount());
			assert.equal(listeners.get('mouseup')?.size ?? 0, 0);
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
