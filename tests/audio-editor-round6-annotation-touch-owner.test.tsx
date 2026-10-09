/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['marker', 'region', 'start', 'end'] as const) for (const interrupted of [true, false]) {
	test(`${kind} ${interrupted ? 'ignores a second pointer down' : 'commits the owning pointer'}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
		globalThis.cancelAnimationFrame = id => { frames.delete(id); };
		const moves: number[] = [], resizes: number[] = [], captures: number[] = [];
		const controller = { actions: { timelineAnnotations: { focus() {}, select() {},
			move(_ids: readonly string[], delta: number) { moves.push(delta); },
			resize(_id: string, _edge: string, frame: number) { resizes.push(frame); },
		} } };
		const annotation: RuntimeTimelineAnnotationProjection = {
			id: 'intro', sequenceId: 'main', name: 'Intro', color: 'auto', batchId: null, opaqueExtensions: {},
			anchor: 'sample', timelineStartFrame: 100, timelineEndFrame: kind === 'marker' ? 100 : 200,
			durationFrames: kind === 'marker' ? 0 : 100, coordinateDomain: 'resolved-samples',
			...(kind === 'marker' ? { kind, positionFrame: 100 } : { kind: 'region', startFrame: 100, endFrame: 200 }),
		};
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<TimelineAnnotationLayer controller={controller}
				project={{ primarySequenceId: 'main', selection: { annotationIds: ['intro'] } }} annotations={[annotation]}
				selectedAnnotationId="intro" copy={ENGLISH_COPY} locale="en" pixelsPerSecond={100} sampleRate={100}
				scrollX={0} viewportWidth={600} blocked={false} run={(operation: () => unknown) => operation()} createAnnotation={() => null} />));
			const row = dom.one('[data-annotation-id]');
			Object.assign(row, { setPointerCapture: (id: number) => captures.push(id) });
			const target = kind === 'start' || kind === 'end' ? dom.one(`[data-annotation-edge="${kind}"]`) : row;
			const pointer = (clientX: number, pointerId = 1) => ({ button: 0, pointerId, isPrimary: pointerId === 1,
				clientX, currentTarget: row, target, preventDefault() {}, stopPropagation() {} });
			await act(async () => reactProps(row).onPointerDown(pointer(100)));
			await act(async () => reactProps(row).onPointerMove(pointer(110)));
			if (interrupted) {
				await act(async () => reactProps(row).onPointerDown(pointer(120, 2)));
				await act(async () => reactProps(row).onPointerMove(pointer(180, 2)));
				await act(async () => reactProps(row).onPointerUp(pointer(180, 2)));
			}
			await act(async () => reactProps(row).onPointerMove(pointer(130)));
			await act(async () => reactProps(row).onPointerUp(pointer(130)));
			assert.deepEqual(captures, [1]);
			assert.deepEqual(moves, kind === 'start' || kind === 'end' ? [] : [30]);
			assert.deepEqual(resizes, kind === 'start' ? [130] : kind === 'end' ? [230] : []);
			assert.equal(frames.size, 0);
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
