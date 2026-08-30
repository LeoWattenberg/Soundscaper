/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

test('multicamera validation ignores label tracks when finding the output owner', () => {
	const options = framescaperV20Options();
	const sources = options.sources as Data[];
	options.sources = [
		...sources,
		{
			...sources[0], id: 'alternate-video-source', name: 'Alternate video',
			storageKey: 'alternate-video-source', contentSha256: '34'.repeat(32),
		},
	];
	options.tracks = [
		createLabelTrack({ id: 'label-track', name: 'Captions' }),
		...(options.tracks as Data[]),
	];
	const sequence = (options.sequences as Data[])[0]!;
	options.sequences = [{
		...sequence,
		trackIds: ['label-track', 'video-track', 'audio-track'],
	}];
	options.multicameraGroups = [{
		id: 'camera-group', projectId: 'framescaper-v20',
		sequenceId: 'main-sequence', outputClipId: 'video-clip',
		activeMemberId: 'camera-a',
		members: [
			{
				id: 'camera-a', groupId: 'camera-group',
				sourceId: 'video-source', syncOffsetSamples: 0,
			},
			{
				id: 'camera-b', groupId: 'camera-group',
				sourceId: 'alternate-video-source', syncOffsetSamples: 0,
			},
		],
	}];

	const project = createFramescaperProjectSequence(PROFILE, options as never);
	assert.equal(project.multicameraGroups[0]?.outputClipId, 'video-clip');
});
