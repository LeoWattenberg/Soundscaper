/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['marker', 'region', 'start', 'end'] as const) for (const mutation of ['range Undo', 'name change', 'equivalent publication'] as const) {
	test(`${kind} annotation retains its range authority through ${mutation}`, async () => {
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
		const render = async (annotations: readonly RuntimeTimelineAnnotationProjection[]) => {
			const id = annotations[0]?.id;
			await act(async () => root.render(<TimelineAnnotationLayer controller={controller}
				project={{ primarySequenceId: 'main', selection: { annotationIds: id ? [id] : [] } }} annotations={annotations}
				selectedAnnotationId={id ?? null} copy={ENGLISH_COPY} locale="en" pixelsPerSecond={100} sampleRate={100}
				scrollX={0} viewportWidth={600} blocked={false} run={(operation: () => unknown) => operation()} createAnnotation={() => null} />));
		};
		const pointer = (row: ReturnType<typeof dom.one>, clientX: number, pointerId = 1) => ({ button: 0, pointerId, isPrimary: true,
			clientX, pointerType: 'mouse', buttons: 1, currentTarget: row,
			target: kind === 'start' || kind === 'end' ? row.querySelector(`[data-annotation-edge="${kind}"]`) : row,
			preventDefault() {}, stopPropagation() {} });
		try {
			await render([annotation]);
			const row = dom.one('[data-annotation-id]');
			let captured = false;
			Object.assign(row, { setPointerCapture: (id: number) => { captures.push(id); captured = true; },
				hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; } });
			await act(async () => reactProps(row).onPointerDown(pointer(row, 100)));
			await act(async () => reactProps(row).onPointerMove(pointer(row, 110)));
			assert.equal(frames.size, 1);
			const changed: RuntimeTimelineAnnotationProjection = annotation.kind === 'marker'
				? { ...annotation, positionFrame: 50, timelineStartFrame: 50, timelineEndFrame: 50 }
				: { ...annotation, startFrame: 50, endFrame: 150, timelineStartFrame: 50, timelineEndFrame: 150 };
			await render([mutation === 'range Undo' ? changed : mutation === 'name change' ? { ...annotation, name: 'Renamed' } : structuredClone(annotation)]);
			if (mutation === 'range Undo') {
				assert.equal(frames.size, 0, 'restored annotation geometry retires its pending preview');
				assert.equal(captured, false, 'retired geometry releases its owning native capture');
				await act(async () => reactProps(row).onPointerMove(pointer(row, 120)));
				await act(async () => reactProps(row).onPointerUp(pointer(row, 120)));
				assert.deepEqual(moves, []); assert.deepEqual(resizes, []);
				await act(async () => reactProps(row).onPointerDown(pointer(row, 100, 2)));
				await act(async () => reactProps(row).onPointerMove(pointer(row, 110, 2)));
				await act(async () => reactProps(row).onPointerUp(pointer(row, 110, 2)));
				assert.deepEqual(captures, [1, 2]);
			} else {
				await act(async () => reactProps(row).onPointerUp(pointer(row, 110)));
				assert.deepEqual(captures, [1]);
			}
			assert.deepEqual(moves, kind === 'start' || kind === 'end' ? [] : [10]);
			assert.deepEqual(resizes, kind === 'start' ? [mutation === 'range Undo' ? 60 : 110]
				: kind === 'end' ? [mutation === 'range Undo' ? 160 : 210] : []);
			assert.equal(frames.size, 0);
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
