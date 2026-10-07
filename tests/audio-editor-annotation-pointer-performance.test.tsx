/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, Profiler } from 'react';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

void test('annotation drags publish one latest preview per frame, skip repeated positions and flush the final move', async () => {
	const dom = installReactTestDom(); const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0; let commits = 0;
	globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	globalThis.cancelAnimationFrame = id => { frames.delete(id); };
	const moves: number[] = [];
	const controller = { actions: { timelineAnnotations: { focus: () => null, select: () => null,
		move(_ids: readonly string[], delta: number) { moves.push(delta); return null; } } } };
	const annotation: RuntimeTimelineAnnotationProjection = { id: 'marker', sequenceId: 'main', name: 'Marker', kind: 'marker', anchor: 'sample',
		color: 'blue', batchId: null, opaqueExtensions: {}, coordinateDomain: 'resolved-samples', positionFrame: 100,
		timelineStartFrame: 100, timelineEndFrame: 100, durationFrames: 0 };
	const project = { primarySequenceId: 'main', selection: { annotationIds: ['marker'] } };
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Profiler id="annotation" onRender={() => { commits++; }}><TimelineAnnotationLayer
			controller={controller} project={project} annotations={[annotation]} selectedAnnotationId="marker" copy={ENGLISH_COPY}
			locale="en" pixelsPerSecond={100} sampleRate={100} scrollX={0} viewportWidth={500} blocked={false}
			run={(operation: () => unknown) => operation()} createAnnotation={() => undefined} /></Profiler>));
		const layer = dom.one('[data-timeline-annotation-layer]'); const row = dom.one('[data-annotation-id="marker"]');
		(layer as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 20 });
		const event = (clientX: number, pointerId = 1) => ({ button: 0, pointerId, clientX, target: row, currentTarget: row, preventDefault() {}, stopPropagation() {} });
		await act(async () => reactProps(row).onPointerDown?.(event(100)));
		const before = commits;
		await act(async () => { for (const x of [101, 110, 120]) reactProps(row).onPointerMove?.(event(x)); });
		assert.equal(commits, before); assert.equal(frames.size, 1);
		await act(async () => { const [id, callback] = [...frames][0]!; frames.delete(id); callback(0); });
		assert.equal(commits, before + 1);
		await act(async () => { reactProps(row).onPointerMove?.(event(120)); const [id, callback] = [...frames][0]!; frames.delete(id); callback(0); });
		assert.equal(commits, before + 1, 'same quantized delta performs no extra React commit');
		await act(async () => { reactProps(row).onPointerMove?.(event(130)); reactProps(row).onPointerUp?.(event(130)); });
		assert.deepEqual(moves, [30]); assert.equal(frames.size, 0);
		await act(async () => {
			reactProps(row).onPointerDown?.(event(100));
			reactProps(row).onPointerMove?.(event(130));
			reactProps(row).onPointerMove?.(event(150, 2));
			reactProps(row).onPointerUp?.(event(150, 2));
			reactProps(row).onPointerUp?.(event(130));
		});
		assert.deepEqual(moves, [30, 30], 'a foreign pointer cannot overwrite the owning drag final sample'); assert.equal(frames.size, 0);
		await act(async () => { reactProps(row).onPointerDown?.(event(100)); reactProps(row).onPointerMove?.(event(150)); reactProps(row).onPointerCancel?.(event(150)); });
		assert.deepEqual(moves, [30, 30]); assert.equal(frames.size, 0);
	} finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); }
});
