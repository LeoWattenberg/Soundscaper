/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackLockAdmission } from '../src/common/editor/commands/track-lock-admission.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import {
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

/**
 * A locked track owns one collection that is not a clip.
 *
 * The lock's generic after-command check is what keeps it closed against
 * commands it has never heard of: it snapshots everything the track owns and
 * refuses any command that changed it. The snapshot held the track's data,
 * locations, lane members, clips, labels, clip groups, A/V links and sources,
 * and not `project.takeGroups` - although a take group names its own track.
 * The exposure is a command that moves a locked track's take graph as a side
 * effect rather than as its subject, which is exactly what the take-graph range
 * planners do, and it widens as take-graph maintenance moves out of the four
 * commands the before-command switch names explicitly.
 */

const NOW = '2026-09-05T12:00:00.000Z';

test('a locked track refuses a command that moved its take graph', () => {
	const project = takeProject();
	const projected = structuredClone(projectForCommandConsumers(project)) as unknown as ProjectionRecord;
	const admission = createTrackLockAdmission(project, projected);

	const drifted = structuredClone(projected);
	shiftFirstGroup(drifted, 64);
	assert.throws(() => admission.afterCommand(drifted), /Track vocals is locked\./u);
});

test('a locked track refuses a persisted result whose take graph moved', () => {
	const project = takeProject();
	const projected = structuredClone(projectForCommandConsumers(project)) as unknown as ProjectionRecord;
	const admission = createTrackLockAdmission(project, projected);

	const drifted = structuredClone(project) as unknown as unknown as ProjectionRecord;
	shiftFirstGroup(drifted, 64);
	assert.throws(() => admission.assertPersistedResult(drifted), /Track vocals is locked\./u);
});

test('a take graph on another track is none of the locked track\'s business', () => {
	const project = takeProject();
	const projected = structuredClone(projectForCommandConsumers(project)) as unknown as ProjectionRecord;
	const admission = createTrackLockAdmission(project, projected);

	const drifted = structuredClone(projected);
	const group = drifted.takeGroups[1];
	if (!group) throw new Error('Missing second take group fixture.');
	group.startSample = Number(group.startSample) + 64;
	group.endSample = Number(group.endSample) + 64;
	admission.afterCommand(drifted);
	admission.assertPersistedResult(structuredClone(project) as unknown as unknown as ProjectionRecord);
});

interface GroupRecord extends Record<string, unknown> {
	startSample: number;
	endSample: number;
}

interface ProjectionRecord extends Record<string, unknown> {
	takeGroups: GroupRecord[];
}

function shiftFirstGroup(project: ProjectionRecord, delta: number): void {
	const group = project.takeGroups[0];
	if (!group) throw new Error('Missing take group fixture.');
	group.startSample = Number(group.startSample) + delta;
	group.endSample = Number(group.endSample) + delta;
}

function takeProject() {
	return createAudioEditorProjectV17({
		id: 'track-lock-take-graph', title: 'Track lock take graph', now: NOW, sampleRate: 48_000,
		sources: [source('vocals-take-source'), source('guitar-take-source')],
		clips: [],
		tracks: [
			createAudioTrack({ id: 'vocals', name: 'Vocals', locked: true, clipIds: [] }),
			createAudioTrack({ id: 'guitar', name: 'Guitar', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['vocals', 'guitar'] }],
		primarySequenceId: 'main-sequence',
		takeGroups: [
			takeGroup('vocals-group', 'vocals', 'vocals-take-source'),
			takeGroup('guitar-group', 'guitar', 'guitar-take-source'),
		],
	});
}

function takeGroup(id: string, trackId: string, sourceId: string) {
	return {
		id,
		sequenceId: 'main-sequence',
		trackId,
		startSample: 96,
		endSample: 104,
		laneOrder: [`${id}-lane`],
		lanes: [{ id: `${id}-lane` }],
		takes: [{
			id: `${id}-take`, laneId: `${id}-lane`, sourceId,
			startSample: 96, endSample: 104, sourceStartSample: 0,
		}],
		compRegions: [{ id: `${id}-comp`, takeId: `${id}-take`, startSample: 96, endSample: 104 }],
	};
}

function source(id: string) {
	return createAudioSource({
		id, name: id, storageKey: id, mimeType: 'audio/wav',
		frameCount: 8, channelCount: 2, sampleRate: 48_000, chunkFrames: 65_536,
	});
}
