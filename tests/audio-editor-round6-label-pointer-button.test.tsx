/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const control of ['label-box', 'left-ear', 'right-ear']) for (const button of [0, 1, 2]) {
	test(`timeline label ${control} publishes only primary drags: hardware ${String(button)}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = globals.React;
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React;
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
		const updates: unknown[] = [];
		const controller = { getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }), actions: {
			labels: { update: (_track: string, _id: string, changes: unknown) => updates.push(changes) },
			timeline: { selectTrack() {}, setExactSelection() {} }, edit: {},
		} };
		const root = createRoot(dom.container as unknown as Element);
		const claims: string[] = [];
		try {
			await act(async () => root.render(<AudacityLabelMarker controller={controller} trackId="labels"
				label={{ id: 'intro', title: 'Intro', startFrame: 12_000, endFrame: 36_000 }} left={37} trackHeight={100}
				pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }} selected editing={false}
				blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
				onSelect={() => undefined} onEdit={() => undefined} onFinishEdit={() => undefined} onRemove={() => undefined} />));
			const marker = dom.one('[data-label-id]');
			const surface = dom.one(`.label-marker__${control}`);
			const event = { button, clientX: 40, target: surface, currentTarget: marker,
				preventDefault() { claims.push('prevent'); }, stopPropagation() { claims.push('stop'); } };
			await act(async () => {
				reactProps(marker).onMouseDownCapture?.(event);
				reactProps(surface).onMouseDown?.(event);
			});
			await act(async () => dispatch(listeners.get('mousemove'), { clientX: 80 } as MouseEvent));
			await act(async () => dispatch(listeners.get('mouseup'), Object.assign(new Event('mouseup'), { button: 0 })));
			assert.equal(updates.length, button === 0 ? 1 : 0);
			assert.deepEqual(claims, button === 0 ? ['prevent', 'stop'] : []);
			if (button === 0 && control === 'label-box')
				assert.deepEqual(updates, [{ startFrame: 31_200, endFrame: 55_200 }]);
		} finally {
			await act(async () => root.unmount());
			assert.equal(listeners.get('mouseup')?.size ?? 0, 0);
			globals.React = priorReact;
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}

function dispatch(listeners: Iterable<EventListenerOrEventListenerObject> | undefined, event: Event): void {
	for (const listener of [...listeners ?? []]) {
		if (typeof listener === 'function') listener(event);
		else listener.handleEvent(event);
	}
}
