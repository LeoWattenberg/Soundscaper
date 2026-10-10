/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('label Escape restores the draft, suppresses continued mouse motion and permits a later move', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React;
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const owner = dom.container.ownerDocument.defaultView as unknown as Window;
	const document = dom.container.ownerDocument as unknown as Document;
	const keys = new Set<EventListenerOrEventListenerObject>();
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	owner.addEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) keys.add(callback); };
	owner.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) keys.delete(callback); };
	document.addEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => {
		if (!callback) return;
		if (!listeners.has(type)) listeners.set(type, new Set());
		listeners.get(type)?.add(callback);
	};
	document.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (callback) listeners.get(type)?.delete(callback); };
	const dispatch = (callbacks: Iterable<EventListenerOrEventListenerObject>, event: Event) => {
		for (const callback of callbacks) {
			if (typeof callback === 'function') callback(event);
			else callback.handleEvent(event);
		}
	};
	const root = createRoot(dom.container as unknown as Element);
	const changes: unknown[] = [];
	const controller = {
		getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }),
		actions: { labels: { update: (_track: string, _label: string, value: unknown) => changes.push(value) },
			timeline: { selectTrack() {}, setExactSelection() {} }, edit: {} },
	};
	try {
		await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels"
			label={{ id: 'intro', title: 'Intro', startFrame: 0, endFrame: 0 }} left={12} trackHeight={100}
			pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }} selected editing={false}
			blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onSelect={() => undefined} onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
		const marker = dom.one('[data-label-id]');
		const box = dom.one('.label-marker__label-box');
		const style = marker.style as unknown as Pick<CSSStyleDeclaration, 'left'>;
		const mouse = { button: 0, clientX: 20, target: box, currentTarget: marker, preventDefault() {}, stopPropagation() {} };
		const begin = async () => act(async () => {
			reactProps(marker).onMouseDownCapture?.(mouse);
			reactProps(box).onMouseDown(mouse);
		});
		const move = async (clientX: number) => act(async () => dispatch(listeners.get('mousemove') ?? [], { clientX } as unknown as Event));
		await begin();
		await move(60);
		assert.equal(style.left, 'calc(52px + var(--timeline-render-origin-x, 0px))');
		await act(async () => dispatch(keys, { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event));
		assert.equal(style.left, 'calc(12px + var(--timeline-render-origin-x, 0px))');
		await move(80);
		assert.equal(style.left, 'calc(12px + var(--timeline-render-origin-x, 0px))');
		await act(async () => dispatch(listeners.get('mouseup') ?? [], Object.assign(new Event('mouseup'), { button: 0 })));
		assert.deepEqual(changes, []);
		await begin();
		await move(60);
		await act(async () => dispatch(listeners.get('mouseup') ?? [], Object.assign(new Event('mouseup'), { button: 0 })));
		assert.deepEqual(changes, [{ startFrame: 19_200, endFrame: 19_200 }]);
	} finally {
		await act(async () => root.unmount());
		assert.equal(keys.size, 0);
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
