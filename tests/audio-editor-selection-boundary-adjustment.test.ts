/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSelectionBoundaryAdjustmentService } from '../src/common/editor/controller/track-audio/internal/selection-boundary-adjustment-service.ts';
import type { SelectionViewProject, SelectionViewSelectionDetails } from '../src/common/editor/controller/track-audio/internal/selection-view-service-types.d.ts';

test('keyboard selection grows and contracts the requested edge one screen pixel without crossing', () => {
	const fixture = createFixture();
	fixture.service.extendSelectionLeft();
	assert.deepEqual(fixture.frames(), [40, 150]);
	fixture.service.extendSelectionRight();
	assert.deepEqual(fixture.frames(), [40, 160]);
	fixture.service.contractSelectionLeft();
	assert.deepEqual(fixture.frames(), [50, 160]);
	fixture.service.contractSelectionRight();
	assert.deepEqual(fixture.frames(), [50, 150]);
	fixture.project.selection = { ...fixture.project.selection, startFrame: 145 };
	fixture.service.contractSelectionLeft();
	assert.deepEqual(fixture.frames(), [150, 150]);
	fixture.project.selection = { ...fixture.project.selection, startFrame: 50, endFrame: 55 };
	fixture.service.contractSelectionRight();
	assert.deepEqual(fixture.frames(), [50, 50]);
});

test('selection adjustments retain track and frequency scope and commit exact anchored boundaries', () => {
	const fixture = createFixture();
	fixture.service.extendSelectionRight();
	assert.deepEqual(fixture.calls[0], {
		startFrame: 50, endFrame: 160,
		details: { trackIds: ['audio'], clipIds: [], frequencyRange: { minimumFrequency: 100, maximumFrequency: 500 } },
		options: { snap: false },
	});
	fixture.project.selection = { ...fixture.project.selection, trackIds: [] };
	fixture.service.extendSelectionRight();
	assert.deepEqual(fixture.project.selection.trackIds, []);
});

test('new keyboard selections seed from the independent playhead and focused track', () => {
	const fixture = createFixture();
	fixture.project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
	fixture.service.extendSelectionLeft();
	assert.deepEqual(fixture.frames(), [90, 100]);
	assert.deepEqual(fixture.project.selection.trackIds, ['audio']);
	fixture.project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
	fixture.service.extendSelectionRight();
	assert.deepEqual(fixture.frames(), [100, 110]);
});

test('selected clips become a time range rather than being trimmed by selection commands', () => {
	const fixture = createFixture();
	fixture.state.selectedClipId = 'clip';
	fixture.project.selection = { startFrame: 0, endFrame: 0, trackIds: ['audio'], clipIds: ['clip'] };
	fixture.service.extendSelectionLeft();
	assert.deepEqual(fixture.frames(), [190, 400]);
	assert.deepEqual(fixture.project.selection.clipIds, []);
	assert.equal(fixture.state.selectedClipId, 'clip');
	assert.equal(fixture.project.clips[0]?.timelineStartFrame, 200);
	assert.equal(fixture.project.clips[0]?.durationFrames, 200);
});

test('project boundary commands widen an existing range and seed absent ranges from the playhead', () => {
	const fixture = createFixture();
	fixture.service.extendSelectionToProjectStart();
	assert.deepEqual(fixture.frames(), [0, 150]);
	fixture.service.extendSelectionToProjectEnd();
	assert.deepEqual(fixture.frames(), [0, 900]);
	fixture.project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
	fixture.service.extendSelectionToProjectEnd();
	assert.deepEqual(fixture.frames(), [100, 900]);
	fixture.project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
	fixture.service.extendSelectionToProjectStart();
	assert.deepEqual(fixture.frames(), [0, 100]);
});

test('project end replaces a selection endpoint that extends beyond the content', () => {
	const fixture = createFixture();
	fixture.project.selection = { ...fixture.project.selection, endFrame: 1_200 };
	fixture.service.extendSelectionToProjectEnd();
	assert.deepEqual(fixture.frames(), [50, 900]);
});

test('project end collapses a range beyond the content and preserves that endpoint for extension', () => {
	const fixture = createFixture();
	fixture.project.selection = { ...fixture.project.selection, startFrame: 1_000, endFrame: 1_200 };
	fixture.service.extendSelectionToProjectEnd();
	assert.deepEqual(fixture.frames(), [900, 900]);
	fixture.service.extendSelectionLeft();
	assert.deepEqual(fixture.frames(), [890, 900]);
	assert.deepEqual(fixture.project.selection.trackIds, ['audio']);
});

test('enabled grid moves at least a pixel to its next point and leaves an unsnapped anchor intact', () => {
	const fixture = createFixture();
	fixture.project.snap = { enabled: true, unit: 'deciseconds', mode: 'nearest' };
	fixture.project.selection = { ...fixture.project.selection, startFrame: 191, endFrame: 455 };
	fixture.service.extendSelectionLeft();
	assert.deepEqual(fixture.frames(), [100, 455]);
	fixture.service.contractSelectionRight();
	assert.deepEqual(fixture.frames(), [100, 400]);
	fixture.project.snap = { enabled: true, unit: 'milliseconds', mode: 'nearest' };
	fixture.service.extendSelectionRight();
	assert.deepEqual(fixture.frames(), [100, 410]);
});

test('adjustment returns null when there is no project', () => {
	const fixture = createFixture();
	fixture.unload();
	assert.equal(fixture.service.extendSelectionRight(), null);
	assert.equal(fixture.service.extendSelectionToProjectStart(), null);
});

test('contraction is a no-op without a range and an edited point keeps its endpoint for extension', () => {
	const fixture = createFixture();
	fixture.project.selection = { ...fixture.project.selection, startFrame: 145, endFrame: 150 };
	fixture.service.contractSelectionLeft();
	assert.deepEqual(fixture.frames(), [150, 150]);
	fixture.service.contractSelectionRight();
	assert.equal(fixture.calls.length, 1);
	fixture.service.extendSelectionRight();
	assert.deepEqual(fixture.frames(), [150, 160]);
	fixture.project.selection = { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] };
	fixture.service.contractSelectionLeft();
	fixture.service.contractSelectionRight();
	assert.deepEqual(fixture.frames(), [0, 0]);
	assert.equal(fixture.calls.length, 2);
	fixture.service.extendSelectionLeft();
	assert.deepEqual(fixture.frames(), [90, 100]);
});

function createFixture() {
	type Project = SelectionViewProject & {
		sampleRate: number;
		selection: SelectionViewProject['selection'];
		snap?: Record<string, unknown>;
	};
	const project: Project = {
		id: 'project', schemaVersion: 1, sampleRate: 1_000,
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', timelineStartFrame: 200, durationFrames: 200, sourceStartFrame: 0 }],
		selection: {
			startFrame: 50, endFrame: 150, trackIds: ['audio'], clipIds: [],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 500 },
		},
	};
	const calls: Array<{
		startFrame: number; endFrame: number;
		details: SelectionViewSelectionDetails;
		options: Readonly<{ snap?: boolean }>;
	}> = [];
	const state = { selectedTrackId: 'audio', selectedClipId: null as string | null, pixelsPerSecond: 100 };
	let loaded = true;
	const service = createSelectionBoundaryAdjustmentService({
		getProject: () => loaded ? project : null,
		getPlayheadFrame: () => 100,
		projectSampleRate: () => project.sampleRate,
		projectDurationFrames: () => 900,
		state,
		adjustSelection: (startFrame, endFrame, details, options) => {
			calls.push({ startFrame, endFrame, details, options });
			project.selection = { ...project.selection, ...details, startFrame, endFrame };
			return project;
		},
	});
	return {
		service, project, state, calls,
		frames: () => [project.selection.startFrame, project.selection.endFrame],
		unload: () => { loaded = false; },
	};
}
