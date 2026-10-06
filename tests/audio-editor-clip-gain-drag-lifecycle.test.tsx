/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useRef, useState } from 'react';

import { useAudioTrackEnvelope } from '../src/common/editor/ui/timeline/useAudioTrackEnvelope.js';
import { useEnvelopeDragLifecycle } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/useEnvelopeDragLifecycle.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const nativeCheckpoint of [false, true]) test(`clip gain cancellation and publication survive native listener checkpoints: ${nativeCheckpoint}`, async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
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
	const dispatch = async (type: string) => {
		const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event;
		for (const listener of [...listeners.get(type) ?? []]) {
			if (typeof listener === 'function') listener(event);
			else listener.handleEvent(event);
			if (nativeCheckpoint) await Promise.resolve();
		}
	};
	try {
		await act(async () => root.render(<EnvelopeHarness updates={updates} />));
		const surface = dom.one('[data-envelope-test]');
		await act(async () => reactProps(surface).onMouseDown?.({}));
		await act(async () => reactProps(surface).onMouseMove?.({}));
		assert.equal(surface.getAttribute('data-preview-value'), '-12');
		await act(async () => { await dispatch('keydown'); context.mock.timers.runAll(); });
		assert.equal(surface.getAttribute('data-preview-value'), '0');
		await act(async () => {
			reactProps(surface).onMouseUp?.({});
			await dispatch('mouseup');
			context.mock.timers.runAll();
		});
		assert.equal(updates.length, 0);
		await act(async () => reactProps(surface).onMouseDown?.({}));
		await act(async () => reactProps(surface).onMouseMove?.({}));
		await act(async () => {
			reactProps(surface).onMouseUp?.({});
			await dispatch('mouseup');
			context.mock.timers.runAll();
		});
		assert.equal(updates.length, 1);
		// The native vendor listener can publish a click's point only on mouseup,
		// after the application's earlier listener and its microtask checkpoint.
		const publishAtRelease: EventListener = () => {
			reactProps(surface).onMouseMove?.({});
			reactProps(surface).onMouseUp?.({});
		};
		document.addEventListener('mouseup', publishAtRelease);
		await act(async () => {
			reactProps(surface).onMouseDown?.({});
			await dispatch('mouseup');
			context.mock.timers.runAll();
		});
		document.removeEventListener('mouseup', publishAtRelease);
		assert.equal(updates.length, 2, 'release publication completes without another pointer gesture');
		await act(async () => {
			reactProps(surface).onMouseDown?.({});
			reactProps(surface).onMouseMove?.({});
			reactProps(surface).onMouseUp?.({});
			await dispatch('mouseup');
		});
	} finally {
		const committedBeforeUnmount = updates.length;
		await act(async () => { root.unmount(); context.mock.timers.runAll(); });
		assert.equal(updates.length, committedBeforeUnmount, 'disposed event tasks cannot commit');
		assert.equal(listeners.get('keydown')?.size ?? 0, 0);
		assert.equal(listeners.get('mouseup')?.size ?? 0, 0);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function EnvelopeHarness({ updates }: Readonly<{ updates: unknown[] }>) {
	const dragRef = useRef<object | null>(null);
	const [points, setPoints] = useState([{ time: 0.5, db: 0 }]);
	const { updateEnvelope } = useAudioTrackEnvelope({
		controller: { actions: { clip: { update: (_id: string, value: unknown) => updates.push(value) } } },
		run: (operation: () => unknown) => operation(),
		blocked: false, automationToolEnabled: true,
		clipLookup: new Map([['clip', { id: 'clip', durationFrames: 100, envelope: [{ frame: 50, value: 1 }] }]]),
		projectionClips: [{ id: 'clip', waveformStartFrame: 0, waveformEndFrame: 100 }],
		sampleRate: 100,
	});
	const publish = (next: typeof points) => { setPoints(next); updateEnvelope('clip', next); };
	const { rememberBeforeDrag, finishDrag } = useEnvelopeDragLifecycle(
		dragRef, points, publish, () => {}, undefined, undefined, () => {}, () => {},
	);
	return <div data-envelope-test data-preview-value={points[0]?.db}
		onMouseDown={() => { rememberBeforeDrag(); dragRef.current = {}; }}
		onMouseMove={() => { if (dragRef.current) publish([{ time: 0.5, db: -12 }]); }}
		onMouseUp={() => { if (dragRef.current) finishDrag(); }}
	/>;
}
