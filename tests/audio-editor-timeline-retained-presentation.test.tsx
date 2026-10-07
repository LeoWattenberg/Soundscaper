/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useTrackAutomationSpanPaths, useTrackAutomationPointModels } from '../src/common/editor/ui/timeline/useTrackAutomationDrawModels.ts';
import type { TrackAutomationOverlaySpanV21 } from '../src/common/editor/ui/timeline/track-automation-overlay-projection.ts';
import { useVideoFilmstripCells } from '../src/common/editor/ui/timeline/video-filmstrip-cell-model.ts';
import { useTimelineAnnotationModels } from '../src/common/editor/ui/timeline/useTimelineAnnotationModels.ts';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

void test('automation paths, authored handles, filmstrip cells and annotation timing survive unrelated React publications', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let coordinateReads = 0; let pointReads = 0; let thumbnailReads = 0; let annotationReads = 0;
	const samples = [{ frame: 0, value: 1, get x() { coordinateReads++; return 12; }, y: 1 }];
	const spans: readonly TrackAutomationOverlaySpanV21[] = [{ clipId: 'clip', startFrame: 0, endFrame: 100, samples,
		get points() { pointReads++; return [{ id: 'point', frame: 0, value: 1, x: 12, y: 1 }]; } }];
	const thumbnails = [{ get timelineFrame() { thumbnailReads++; return 0; }, sourceTimeSeconds: 5 }];
	const annotation: RuntimeTimelineAnnotationProjection = { id: 'marker', sequenceId: 'main', name: 'Marker', kind: 'marker', anchor: 'sample',
		color: 'blue', batchId: null, opaqueExtensions: {}, coordinateDomain: 'resolved-samples', positionFrame: 0,
		get timelineStartFrame() { annotationReads++; return 0; }, timelineEndFrame: 0, durationFrames: 0 };
	const annotations = [annotation];
	let paths: unknown; let points: unknown; let cells: unknown; let timing: string | undefined;
	function Harness({ revision }: { revision: number }) {
		paths = useTrackAutomationSpanPaths(spans); points = useTrackAutomationPointModels(spans);
		cells = useVideoFilmstripCells(thumbnails, 0, 100, 100, 100);
		timing = useTimelineAnnotationModels({ annotations, primarySequenceId: 'main', sampleRate: 100, locale: 'en', secondsUnit: 's',
			selectedAnnotationIds: revision % 2 ? ['marker'] : [], focusedAnnotationId: 'marker' }).model.rows[0]?.timingLabel;
		return null;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />));
		const first = { paths, points, cells }; const reads = { coordinateReads, pointReads, thumbnailReads, annotationReads };
		for (let revision = 1; revision <= 30; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.deepEqual({ coordinateReads, pointReads, thumbnailReads, annotationReads }, reads, 'retained presentation does zero repeat coordinate, point or timing work');
		assert.equal(paths, first.paths); assert.equal(points, first.points); assert.equal(cells, first.cells);
		assert.equal(timing, '0.000 s');
		assert.deepEqual(paths, ['M 12 1']); assert.deepEqual(cells, [{ left: 0, width: 100, title: '5.0 s', time: '0:05' }]);
	} finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); }
});
