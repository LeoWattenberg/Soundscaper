/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { applyFramescaperProjectCommand, snapshotFramescaperProjectCommand } from '../../src/framescaper/editor-project-commands.ts';
import { createFramescaperProject, validateFramescaperProject, type FramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing as model } from '../../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { framescaperBaselineOptions } from './framescaper-baseline-model-fixture.ts';

type Data = Record<string, unknown>;

export function pairProject(outgoingCount: number, incomingCount: number): FramescaperProject {
	const options = framescaperBaselineOptions();
	const clips = options.clips as Data[];
	const outgoing = clips.find(clip => clip.kind === 'video');
	assert.ok(outgoing);
	const incoming = { ...outgoing, id: 'incoming-video', title: 'Incoming',
		sequenceStartFrame: outgoingCount, sequenceFrameCount: incomingCount, sourceFrameCount: incomingCount };
	options.clips = [{ ...outgoing, sequenceFrameCount: outgoingCount, sourceFrameCount: outgoingCount }, incoming,
		...clips.filter(clip => clip.kind !== 'video')];
	options.tracks = (options.tracks as Data[]).map(track => track.type === 'video'
		? { ...track, clipIds: ['video-clip', 'incoming-video'] } : track);
	return createFramescaperProject(PROFILE, options);
}

export function view(project: FramescaperProject) {
	assert.equal(validateFramescaperProject(PROFILE, project), true);
	return model({ surface: 'video-transition-dissolve', project, selectedClipId: 'video-clip', playheadSample: 0 });
}

export function apply(project: FramescaperProject, command: unknown): FramescaperProject {
	return applyFramescaperProjectCommand(PROFILE, project, snapshotFramescaperProjectCommand(command));
}
