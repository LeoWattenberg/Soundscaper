/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import {
	frameAtLabelClientX, labelLaneContentX,
} from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

const SAMPLE_RATE = 48_000;
const PIXELS_PER_SECOND = 100;
const POSITION_FRAME = 24_000;

test('a label at the playhead is drawn on the playhead, not left of it', () => {
	// The playhead, the ruler ticks and the grid all place a position at
	// CLIP_CONTENT_OFFSET + seconds * pixelsPerSecond, so labels must agree.
	assert.equal(labelLaneContentX(0, PIXELS_PER_SECOND, SAMPLE_RATE), CLIP_CONTENT_OFFSET);
	assert.equal(labelLaneContentX(POSITION_FRAME, PIXELS_PER_SECOND, SAMPLE_RATE), 62);
	assert.equal(labelLaneContentX(SAMPLE_RATE, 6_000_000, SAMPLE_RATE), CLIP_CONTENT_OFFSET + 6_000_000);

	const projection = readFileSync(new URL(
		'../src/common/editor/ui/timeline/TimelinePlaybackProjection.tsx', import.meta.url,
	), 'utf8');
	assert.match(projection, /`\$\{CLIP_CONTENT_OFFSET \+ positionPixels\}px`/u);
});

test('pointer positions in a label lane read back the time drawn under them', () => {
	const lane = { getBoundingClientRect: () => ({ left: 200 }) };
	const at = (clientX: number) => frameAtLabelClientX(clientX, lane, PIXELS_PER_SECOND, SAMPLE_RATE);

	assert.equal(at(200 + labelLaneContentX(POSITION_FRAME, PIXELS_PER_SECOND, SAMPLE_RATE)), POSITION_FRAME);
	assert.equal(at(200 + CLIP_CONTENT_OFFSET), 0);
	// The inset belongs to the timeline rather than to the project, so pointing at
	// the lane edge stays clamped at the project start instead of running negative.
	assert.equal(at(200), 0);
	assert.equal(at(0), 0);
	assert.equal(frameAtLabelClientX(1_000, null, PIXELS_PER_SECOND, SAMPLE_RATE), 0);
});

test('the label lane places its markers through the shared helper', () => {
	const source = readFileSync(new URL(
		'../src/common/editor/ui/timeline/LabelTrackRow.jsx', import.meta.url,
	), 'utf8');
	assert.match(source, /left=\{labelLaneContentX\(label\.startFrame, pixelsPerSecond, sampleRate\)\}/u);
});

test('marker-lane annotations sit under the ruler ticks that name their time', () => {
	const markup = render(<TimelineAnnotationLayer
		controller={annotationControllerFixture()}
		project={{ primarySequenceId: 'main', selection: { annotationIds: [] } }}
		annotations={[markerFixture(POSITION_FRAME)]}
		selectedAnnotationId={null}
		copy={ENGLISH_COPY}
		locale="en"
		pixelsPerSecond={PIXELS_PER_SECOND}
		sampleRate={SAMPLE_RATE}
		scrollX={0}
		viewportWidth={1_000}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={() => null}
	/>);

	assert.match(markup, /data-annotation-id="cue"[^>]*style="left:62px/u);
});

test('a scrolled marker lane keeps annotations aligned with the ruler', () => {
	const markup = render(<TimelineAnnotationLayer
		controller={annotationControllerFixture()}
		project={{ primarySequenceId: 'main', selection: { annotationIds: [] } }}
		annotations={[markerFixture(POSITION_FRAME)]}
		selectedAnnotationId={null}
		copy={ENGLISH_COPY}
		locale="en"
		pixelsPerSecond={PIXELS_PER_SECOND}
		sampleRate={SAMPLE_RATE}
		scrollX={20}
		viewportWidth={1_000}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={() => null}
	/>);

	assert.match(markup, /data-annotation-id="cue"[^>]*style="left:42px/u);
});

function render(node: ReactNode): string {
	return renderToStaticMarkup(React.createElement(React.Fragment, null, node));
}

function markerFixture(positionFrame: number): RuntimeTimelineAnnotationProjection {
	return Object.freeze({
		id: 'cue', sequenceId: 'main', name: 'Cue', color: 'auto', batchId: null, opaqueExtensions: {},
		kind: 'marker', anchor: 'sample', positionFrame,
		timelineStartFrame: positionFrame, timelineEndFrame: positionFrame,
		durationFrames: 0, coordinateDomain: 'resolved-samples',
	});
}

function annotationControllerFixture() {
	const callable = () => undefined;
	return {
		actions: {
			timelineAnnotations: new Proxy<Record<string, () => undefined>>({}, { get: () => callable }),
		},
	};
}
