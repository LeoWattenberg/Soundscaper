/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { resolveProjectGraphSelection } from '../src/common/editor/engine/project-graph-selection.ts';

test('audio preview projects are schema-less engine models, not persisted project generations', () => {
	const project = createAudioPreviewProject({
		title: 'Audition',
		sampleRate: 48_000,
		sources: [{
			id: 'source', name: 'Source', storageKey: 'source', frameCount: 480,
			channelCount: 1, sampleRate: 48_000,
		}],
		clips: [{
			id: 'clip', sourceId: 'source', title: 'Clip', timelineStartFrame: 0,
			durationFrames: 480, sourceStartFrame: 0, sourceDurationFrames: 480,
		}],
		tracks: [{ id: 'track', name: 'Track', clipIds: ['clip'] }],
	});

	assert.equal(Object.hasOwn(project, 'schemaVersion'), false);
	assert.equal(project.sampleRate, 48_000);
	assert.equal(project.masterChannels, 2);
	assert.deepEqual(project.sources?.map(({ id }) => id), ['source']);
	assert.deepEqual(project.clips?.map(({ id }) => id), ['clip']);
	assert.deepEqual(project.tracks?.map(({ id }) => id), ['track']);
	// Routing is engine input, not document identity: the preview carries the
	// production mixer surface so it compiles through the same graph builder as
	// the playback it stands in for, while staying schema-less as a document.
	assert.deepEqual(project.automationLanes, []);
	assert.deepEqual(project.mixer?.groups, []);
	assert.deepEqual(project.mixer?.sends, []);
	assert.deepEqual(
		(project.mixer as unknown as Readonly<{ edges: readonly { id: string }[] }>)
			.edges.map(({ id }) => id),
		['assignment:track:track:master', 'assignment:master:output:main'],
	);
	assert.equal(resolveProjectGraphSelection(project), 'v21');
});
