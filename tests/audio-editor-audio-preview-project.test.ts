/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';

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
	assert.deepEqual(project.mixer, { groups: [], sends: [], routes: {} });
});
