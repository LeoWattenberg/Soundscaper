/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useCallback, useEffect, useRef, useState } from 'react';

import { useAudioTrackEnvelope } from '../src/common/editor/ui/timeline/useAudioTrackEnvelope.js';
import { useEnvelopeDragLifecycle } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/useEnvelopeDragLifecycle.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('clip gain cancels drafts and commits click or drag edits after the native event listeners finish', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const updates: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (listener) {
			const callbacks = listeners.get(type) ?? new Set();
			callbacks.add(listener);
			listeners.set(type, callbacks);
		}
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (listener) listeners.get(type)?.delete(listener);
	};
	const dispatch = async (type: string, beforeTasks?: () => void) => {
		const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event;
		for (const listener of [...listeners.get(type) ?? []]) {
			if (typeof listener === 'function') listener(event);
			else listener.handleEvent(event);
			// Browsers run queued microtasks between native event listeners.
			await Promise.resolve();
		}
		beforeTasks?.();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	};
	try {
		await act(async () => root.render(<EnvelopeHarness updates={updates} />));
		const surface = dom.one('[data-envelope-test]');
		await act(async () => reactProps(surface).onMouseDown?.({}));
		await act(async () => reactProps(surface).onMouseMove?.({}));
		assert.equal(surface.getAttribute('data-preview-value'), '-12');
		await act(async () => { await dispatch('keydown'); });
		assert.equal(surface.getAttribute('data-preview-value'), '0');
		assert.equal(surface.getAttribute('data-envelope-preview-count'), '0');
		await act(async () => { await dispatch('mouseup'); });
		assert.equal(updates.length, 0);
		await act(async () => reactProps(surface).onMouseDown?.({}));
		await act(async () => reactProps(surface).onMouseMove?.({}));
		await act(async () => { await dispatch('mouseup'); });
		assert.equal(updates.length, 1);
		await act(async () => reactProps(surface).onMouseDown?.({}));
		await act(async () => { await dispatch('mouseup'); });
		assert.equal(updates.length, 2);
		assert.equal(surface.getAttribute('data-envelope-preview-count'), '0');
		await act(async () => reactProps(surface).onMouseDown?.({}));
		await act(async () => reactProps(surface).onMouseMove?.({}));
		await act(async () => { await dispatch('mouseup', () => root.unmount()); });
		assert.equal(updates.length, 2, 'a queued finish must not commit after unmount');
	} finally {
		await act(async () => root.unmount());
		assert.equal(listeners.get('keydown')?.size ?? 0, 0);
		assert.equal(listeners.get('mouseup')?.size ?? 0, 0);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function EnvelopeHarness({ updates }: Readonly<{ updates: unknown[] }>) {
	const dragRef = useRef<{ hasMoved: boolean } | null>(null);
	const [points, setPoints] = useState([{ time: 0.5, db: 0 }]);
	const { updateEnvelope, envelopePreviewRef } = useAudioTrackEnvelope({
		controller: { actions: { clip: { update: (_id: string, value: unknown) => updates.push(value) } } },
		run: (operation: () => unknown) => operation(),
		blocked: false, automationToolEnabled: true,
		clipLookup: new Map([['clip', { id: 'clip', durationFrames: 100, envelope: [{ frame: 50, value: 1 }] }]]),
		projectionClips: [{ id: 'clip', waveformStartFrame: 0, waveformEndFrame: 100 }],
		sampleRate: 100,
	});
	const publish = useCallback((next: typeof points) => {
		setPoints(next); updateEnvelope('clip', next);
	}, [updateEnvelope]);
	const { rememberBeforeDrag, finishDrag } = useEnvelopeDragLifecycle(
		dragRef, points, publish, () => {}, undefined, undefined, () => {}, () => {},
	);
	useEffect(() => {
		const finish = () => {
			if (!dragRef.current) return;
			if (!dragRef.current.hasMoved) publish([{ time: 0.75, db: -6 }]);
			finishDrag();
		};
		document.addEventListener('mouseup', finish);
		return () => document.removeEventListener('mouseup', finish);
	}, [finishDrag, publish]);
	return <div data-envelope-test data-preview-value={points[0]?.db}
		data-envelope-preview-count={envelopePreviewRef.current.size}
		onMouseDown={() => { rememberBeforeDrag(); dragRef.current = { hasMoved: false }; }}
		onMouseMove={() => { if (dragRef.current) { dragRef.current.hasMoved = true; publish([{ time: 0.5, db: -12 }]); } }}
	/>;
}
