/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperImageSequenceProjectBinClip } from
	'../src/framescaper/editor-native-image-sequence-import.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

test('image-sequence bin duration is expressed at the primary sequence rate', () => {
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		primarySequenceId: 'main-sequence',
	});
	const clip = framescaperImageSequenceProjectBinClip(project, 'bin-clip', {
		id: 'image-sequence-source', name: 'Sequence', frameCount: 24,
		frameRate: { num: 24, den: 1 },
	} as never);
	assert.equal(clip.sequenceFrameCount, 30);
	assert.equal(clip.sourceFrameCount, 24);
});
