/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['marker', 'region'] as const) test(`${kind} Escape restores its pointer draft and prevents release publication`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React;
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const owner = dom.container.ownerDocument.defaultView as unknown as Window;
	const callbacks = new Set<EventListenerOrEventListenerObject>();
	owner.addEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.add(callback); };
	owner.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.delete(callback); };
	const root = createRoot(dom.container as unknown as Element);
	const changes: unknown[] = [];
	const captured = new Set<number>();
	const annotation: RuntimeTimelineAnnotationProjection = {
		id: 'intro', sequenceId: 'main', name: 'Intro', color: 'auto', batchId: null, opaqueExtensions: {},
		anchor: 'sample', timelineStartFrame: 24_000, timelineEndFrame: kind === 'marker' ? 24_000 : 48_000,
		durationFrames: kind === 'marker' ? 0 : 24_000, coordinateDomain: 'resolved-samples',
		...(kind === 'marker' ? { kind, positionFrame: 24_000 } : { kind, startFrame: 24_000, endFrame: 48_000 }),
	};
	const controller = { actions: { timelineAnnotations: {
		focus() {}, select() {},
		move: (ids: unknown, delta: number) => changes.push({ ids, delta }),
		resize: (id: string, edge: string, frame: number) => changes.push({ id, edge, frame }),
	} } };
	try {
		await act(async () => root.render(<TimelineAnnotationLayer controller={controller}
			project={{ primarySequenceId: 'main', selection: { annotationIds: ['intro'] } }} annotations={[annotation]}
			selectedAnnotationId="intro" copy={ENGLISH_COPY} locale="en" pixelsPerSecond={100} sampleRate={48_000}
			scrollX={0} viewportWidth={600} blocked={false} run={(operation: () => unknown) => operation()} createAnnotation={() => null} />));
		const marker = dom.one('[data-annotation-id]');
		const style = marker.style as unknown as Pick<CSSStyleDeclaration, 'left' | 'width'>;
		Object.assign(marker, {
			setPointerCapture: (id: number) => captured.add(id), hasPointerCapture: (id: number) => captured.has(id),
			releasePointerCapture: (id: number) => captured.delete(id),
		});
		const target = kind === 'marker' ? marker : dom.one('[data-annotation-edge="end"]');
		const pointer = { button: 0, currentTarget: marker, target, clientX: 62, pointerId: 8, preventDefault() {}, stopPropagation() {} };
		const original = { left: style.left, width: style.width };
		await act(async () => reactProps(marker).onPointerDown(pointer));
		await act(async () => reactProps(marker).onPointerMove({ ...pointer, clientX: 102 }));
		assert.notDeepEqual({ left: style.left, width: style.width }, original);
		await act(async () => {
			const escape = { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event;
			for (const callback of callbacks) {
				if (typeof callback === 'function') callback(escape);
				else callback.handleEvent(escape);
			}
		});
		assert.deepEqual({ left: style.left, width: style.width }, original);
		assert.equal(captured.size, 0);
		await act(async () => reactProps(marker).onPointerUp(pointer));
		assert.deepEqual(changes, []);
		await act(async () => reactProps(marker).onPointerDown(pointer));
		await act(async () => reactProps(marker).onPointerMove({ ...pointer, clientX: 102 }));
		await act(async () => reactProps(marker).onPointerUp(pointer));
		assert.equal(changes.length, 1);
	} finally {
		await act(async () => root.unmount());
		assert.equal(callbacks.size, 0);
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
