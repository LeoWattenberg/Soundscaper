/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSetVideoKeyframesCommand } from '../src/common/editor/commands.js';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { applyFramescaperProjectCommandRetime } from '../src/framescaper/editor-project-retime-commands.ts';
import { createFramescaperVideoRetimeReverseCommandRetime } from '../src/framescaper/editor-project-retime-retime-command.ts';
import { FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE as PROFILE } from '../src/framescaper/editor-project-retime-profile.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

test('a label track does not block a timeline video-retime command', () => {
	const project = projectWithLabelTrack();
	const retimed = applyFramescaperProjectCommandRetime(
		PROFILE,
		project,
		createFramescaperVideoRetimeReverseCommandRetime({
			clipId: 'video-clip', expectedRetimeMap: null,
		}),
		{ now: '2026-08-31T10:00:00.000Z' },
	);

	assert.notEqual(videoClip(retimed).retimeMap, null);
});

test('a label track does not block a timeline video-keyframes command', () => {
	const project = projectWithLabelTrack();
	const expected = videoClip(project).videoKeyframes;
	const next = opacityKeyframes();
	const keyframed = applyFramescaperProjectCommandRetime(
		PROFILE,
		project,
		createSetVideoKeyframesCommand('video-clip', expected, next),
		{ now: '2026-08-31T10:01:00.000Z' },
	);

	assert.deepEqual(videoClip(keyframed).videoKeyframes, next);
});

function projectWithLabelTrack() {
	const options = framescaperV20Options();
	const tracks = options.tracks as Data[];
	const sequence = (options.sequences as Data[])[0]!;
	options.tracks = [
		...tracks,
		createLabelTrack({ id: 'label-track', name: 'Captions' }),
	];
	options.sequences = [{
		...sequence,
		trackIds: [...sequence.trackIds as string[], 'label-track'],
	}];
	return createFramescaperProjectRetime(PROFILE, options as never);
}

function videoClip(project: Readonly<{ readonly clips: readonly Readonly<Data>[] }>): Readonly<Data> {
	const clip = project.clips.find(({ id }) => id === 'video-clip');
	if (!clip) throw new Error('The label-track retime fixture requires its video clip.');
	return clip;
}
