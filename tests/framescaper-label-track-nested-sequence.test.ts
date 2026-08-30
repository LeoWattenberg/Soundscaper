/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	flattenFramescaperSequenceSequence,
} from '../src/framescaper/editor-project-sequence-nested-sequence.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

test('nested-sequence flattening ignores a valid label-track leaf', () => {
	const flattened = flattenFramescaperSequenceSequence(PROFILE, nestedProject());

	assert.deepEqual(flattened.map((occurrence) => ({
		clipId: occurrence.clipId,
		leafSequenceId: occurrence.leafSequenceId,
		sequencePath: occurrence.sequencePath,
		subsequencePath: occurrence.subsequencePath,
	})), [
		{
			clipId: 'audio-clip', leafSequenceId: 'nested-sequence',
			sequencePath: ['main-sequence', 'nested-sequence'],
			subsequencePath: ['nested-main-child'],
		},
		{
			clipId: 'video-clip', leafSequenceId: 'nested-sequence',
			sequencePath: ['main-sequence', 'nested-sequence'],
			subsequencePath: ['nested-main-child'],
		},
	]);
});

function nestedProject() {
	const options = framescaperV20Options();
	const tracks = options.tracks as Data[];
	const main = (options.sequences as Data[])[0]!;
	options.clips = (options.clips as Data[]).map((clip) => (
		clip.kind === 'video' ? { ...clip, sequenceId: 'nested-sequence' } : clip
	));
	options.tracks = [
		createLabelTrack({ id: 'label-track', name: 'Captions' }),
		...tracks,
	];
	options.sequences = [
		{ ...main, trackIds: ['label-track'] },
		{ ...main, id: 'nested-sequence', trackIds: ['video-track', 'audio-track'] },
	];
	options.subsequences = [{
		id: 'nested-main-child',
		sequenceId: 'main-sequence', sourceSequenceId: 'nested-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	}];
	return createFramescaperProjectSequence(PROFILE, options as never);
}
