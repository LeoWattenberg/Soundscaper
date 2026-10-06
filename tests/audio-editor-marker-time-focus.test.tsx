/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { TimelineAnnotationPanel } from '../src/common/editor/ui/timeline/TimelineAnnotationPanel.jsx';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('annotation time publication preserves focused start and end control identities', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let annotation: RuntimeTimelineAnnotationProjection = {
		id: 'item', sequenceId: 'main', name: 'Region', color: 'blue', batchId: null,
		opaqueExtensions: {}, kind: 'region', anchor: 'sample', startFrame: 0, endFrame: 24_000,
		timelineStartFrame: 0, timelineEndFrame: 24_000, durationFrames: 24_000, coordinateDomain: 'resolved-samples',
	};
	const render = () => root.render(<TimelineAnnotationPanel
		controller={{ actions: { timelineAnnotations: {} } }}
		project={{ primarySequenceId: 'main', selection: { annotationIds: ['item'], startFrame: 0, endFrame: 0 } }}
		annotations={[annotation]} selectedAnnotationId="item" copy={ENGLISH_COPY} locale="en" sampleRate={48_000}
		blocked={false} run={(operation: () => unknown) => operation()} createAnnotation={() => undefined} />);
	try {
		await act(async () => { render(); });
		for (const label of ['Start sample', 'End sample']) {
			const control = dom.one(`[aria-label="${label}"]`);
			control.focus();
			annotation = label === 'Start sample'
				? { ...annotation, startFrame: 48, timelineStartFrame: 48, durationFrames: 23_952 }
				: { ...annotation, endFrame: 30_000, timelineEndFrame: 30_000, durationFrames: 29_952 };
			await act(async () => { render(); });
			assert.equal(dom.one(`[aria-label="${label}"]`) === control, true, 'a changed frame must not replace its editing control');
			assert.equal(control.isConnected, true);
			assert.equal(document.activeElement === (control as unknown as Element), true);
		}
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
