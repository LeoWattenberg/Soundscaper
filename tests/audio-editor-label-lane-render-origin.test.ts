/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	frameAtLabelClientX, labelLaneContentX,
} from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';

const SAMPLE_RATE = 48_000;
const PIXELS_PER_SECOND = 6_000_000;
// A ten second project at sample-pencil zoom overruns the capped scroll surface,
// so the timeline draws its content shifted by a large negative render origin.
const RENDER_ORIGIN_X = -11_000_000;
const LANE_LEFT = 200;
const LABEL_FRAME = 120_000;

const lane = { getBoundingClientRect: () => ({ left: LANE_LEFT }) };

function source(path: string): string {
	return readFileSync(new URL(`../src/common/editor/ui/timeline/${path}`, import.meta.url), 'utf8');
}

test('a label lane pointer reads the time drawn under it once the surface is capped', () => {
	// `timelineContentLeft` draws the marker at its content x plus the render
	// origin, so that sum is where the label actually sits inside the lane.
	const drawnLaneX = labelLaneContentX(LABEL_FRAME, PIXELS_PER_SECOND, SAMPLE_RATE) + RENDER_ORIGIN_X;

	assert.equal(
		frameAtLabelClientX(LANE_LEFT + drawnLaneX, lane, PIXELS_PER_SECOND, SAMPLE_RATE, RENDER_ORIGIN_X),
		LABEL_FRAME,
	);
	// The project start is drawn at its content inset plus the same origin, and
	// left of it the pointer stays clamped instead of running negative.
	const drawnStartX = labelLaneContentX(0, PIXELS_PER_SECOND, SAMPLE_RATE) + RENDER_ORIGIN_X;
	assert.equal(
		frameAtLabelClientX(LANE_LEFT + drawnStartX, lane, PIXELS_PER_SECOND, SAMPLE_RATE, RENDER_ORIGIN_X),
		0,
	);
	assert.equal(
		frameAtLabelClientX(LANE_LEFT + drawnStartX - 1_000, lane, PIXELS_PER_SECOND, SAMPLE_RATE, RENDER_ORIGIN_X),
		0,
	);
});

test('an unscaled label lane keeps its existing pointer mapping', () => {
	const at = (clientX: number) => frameAtLabelClientX(clientX, lane, 100, SAMPLE_RATE, 0);

	assert.equal(at(LANE_LEFT + labelLaneContentX(24_000, 100, SAMPLE_RATE)), 24_000);
	assert.equal(at(LANE_LEFT), 0);
	assert.equal(frameAtLabelClientX(LANE_LEFT, lane, 100, SAMPLE_RATE), 0);
	assert.equal(frameAtLabelClientX(1_000, null, 100, SAMPLE_RATE, RENDER_ORIGIN_X), 0);
});

test('every label lane pointer call carries the render origin', () => {
	const calls = [...source('LabelTrackRow.jsx').matchAll(/frameAtLabelClientX\(([^)]*)\)/gu)];

	assert.ok(calls.length >= 3, 'the helper and both of its call sites are present');
	for (const call of calls) assert.match(call[1] ?? '', /renderOriginX/u);
});

test('the timeline hands the label lane the render origin it draws with', () => {
	assert.match(
		element(source('TimelineWorkspaceView.jsx'), 'TrackListView'),
		/renderOriginX=\{renderOriginX\}/u,
	);
	assert.match(
		element(source('TrackListView.jsx'), 'LabelTrackRow'),
		/renderOriginX=\{renderOriginX\}/u,
	);
});

function element(markup: string, name: string): string {
	const start = markup.indexOf(`<${name}`);
	assert.notEqual(start, -1, `${name} is rendered`);
	const end = markup.indexOf('/>', start);
	assert.notEqual(end, -1, `${name} is closed`);
	return markup.slice(start, end);
}
