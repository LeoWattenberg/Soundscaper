/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorTrackService,
	type EditorTrackServiceDependencies,
} from '../src/common/editor/controller/track-service.ts';
import type {
	ControllerProject,
	ControllerTrack,
} from '../src/common/editor/controller/track-domain-types.ts';

test('a label joins the label track the project already has instead of starting another', () => {
	const service = labelServiceFixture(['audio', 'labels'], 'audio');

	assert.equal(service.addLabel(), 'label-1');
	assert.deepEqual(service.commands(), ['label/add']);
	assert.equal(service.lastLabelTrackId(), 'labels');
	// A second press keeps writing to the same track rather than stacking tracks.
	assert.equal(service.addLabel(), 'label-2');
	assert.deepEqual(service.commands(), ['label/add', 'label/add']);
	assert.equal(service.lastLabelTrackId(), 'labels');
});

test('a label follows the focused track down to the first label track beneath it', () => {
	const service = labelServiceFixture(['early-labels', 'audio', 'late-labels'], 'audio');

	assert.equal(service.addLabel(), 'label-1');
	assert.equal(service.lastLabelTrackId(), 'late-labels');
});

test('a label reaches a label track above the focused one rather than creating a second', () => {
	const service = labelServiceFixture(['first-labels', 'second-labels', 'audio'], 'audio');

	assert.equal(service.addLabel(), 'label-1');
	assert.deepEqual(service.commands(), ['label/add']);
	assert.equal(service.lastLabelTrackId(), 'second-labels');
});

test('a project without a label track still gets one for its first label', () => {
	const service = labelServiceFixture(['audio'], 'audio');

	assert.equal(service.addLabel(), 'label-2');
	assert.deepEqual(service.commands(), ['track/add', 'label/add']);
	assert.equal(service.lastLabelTrackId(), 'label-track-1');
});

test('a label spans the time selection, as Audacity\'s Add label does', () => {
	const region = labelServiceFixture(['audio', 'labels'], 'audio', { startFrame: 1_000, endFrame: 5_000 });
	assert.equal(region.addLabel(), 'label-1');
	assert.deepEqual(region.lastLabelRange(), [1_000, 5_000]);

	// Without a span the label stays a point at the cursor, and an explicit
	// start still wins over the selection.
	const point = labelServiceFixture(['audio', 'labels'], 'audio', { startFrame: 3_000, endFrame: 3_000 });
	assert.equal(point.addLabel(), 'label-1');
	assert.deepEqual(point.lastLabelRange(), [24_000, 24_000]);

	const explicit = labelServiceFixture(['audio', 'labels'], 'audio', { startFrame: 1_000, endFrame: 5_000 });
	assert.equal(explicit.addLabel(null, { startFrame: 8_000 }), 'label-1');
	assert.deepEqual(explicit.lastLabelRange(), [8_000, 8_000]);
});

test('an explicitly named label track always receives the label', () => {
	const service = labelServiceFixture(['audio', 'first-labels', 'second-labels'], 'audio');

	assert.equal(service.addLabel('first-labels'), 'label-1');
	assert.equal(service.lastLabelTrackId(), 'first-labels');
});

interface LabelServiceFixture {
	addLabel(trackId?: string | null, options?: Record<string, unknown>): string | null;
	commands(): readonly string[];
	lastLabelTrackId(): string | null;
	lastLabelRange(): readonly [number, number] | null;
}

/** A track service over tracks named for their kind: `audio` or anything else. */
function labelServiceFixture(
	trackIds: readonly string[],
	selectedTrackId: string,
	selection: Readonly<{ startFrame: number; endFrame: number }> | null = null,
): LabelServiceFixture {
	let project = projectFixture(trackIds, selection);
	const commits: AudioEditorCommand[] = [];
	let sequence = 0;
	const dependencies: EditorTrackServiceDependencies = {
		lifetime: { assertActive() {} },
		copy: {
			track: 'Track', labels: 'Labels', recordingDesktopAudio: 'Desktop audio',
			trackDestinationInvalid: 'Invalid destination', trackNotFound: 'Track missing',
			v2Required: 'V2 required', audioTrackRequired: 'Audio required',
			unknownTrackDisplay: 'Unknown display',
		},
		trackColors: ['blue'],
		getProject: () => project,
		getSelectedTrackId: () => selectedTrackId,
		editingBlocked: () => false,
		createId: (prefix) => `${prefix}-${++sequence}`,
		commit: (command) => {
			commits.push(command);
			if (command.type === 'track/add') {
				project = {
					...project,
					tracks: [...project.tracks, command.track as unknown as ControllerTrack],
				};
			}
			return command;
		},
		getPositionFrames: () => 24_000,
		snapTimelineFrame: (frame) => frame,
		setTimelineView() {},
		recording: recordingPortFixture(),
	};
	const service = createEditorTrackService(dependencies);
	return {
		addLabel: (trackId = null, options = {}) => service.addLabel(trackId, options),
		commands: () => commits.map((command) => command.type),
		lastLabelTrackId: () => {
			const added = commits.filter((command) => command.type === 'label/add').at(-1);
			return added ? String((added as unknown as { trackId: string }).trackId) : null;
		},
		lastLabelRange: () => {
			const added = commits.filter((command) => command.type === 'label/add').at(-1);
			const label = (added as unknown as { label: { startFrame: number; endFrame: number } } | undefined)?.label;
			return label ? [label.startFrame, label.endFrame] : null;
		},
	};
}

function projectFixture(
	trackIds: readonly string[],
	selection: Readonly<{ startFrame: number; endFrame: number }> | null = null,
): ControllerProject {
	return {
		id: 'project',
		selection,
		schemaVersion: Number.MAX_SAFE_INTEGER,
		tracks: trackIds.map((id) => ({
			id,
			name: id,
			type: id === 'audio' ? 'audio' : 'label',
			clipIds: [],
			labels: [],
		})),
		clips: [],
		sources: [],
	} as unknown as ControllerProject;
}

function recordingPortFixture() {
	return {
		getRouting: () => ({ routes: {} }),
		setRouting() {},
		getPreferredDeviceId: () => 'default',
		getPreferredChannelCount: () => 1,
		getDevices: () => [],
		getPoolSources: () => [],
		setTrackRoute: (routing: unknown) => routing,
		setRouteHealth() {},
		updateDeviceRows() {},
		persistRouting: async () => undefined,
		publish() {},
		defaultDeviceId: 'default',
		displaySourceKey: 'display',
	} as unknown as EditorTrackServiceDependencies['recording'];
}
