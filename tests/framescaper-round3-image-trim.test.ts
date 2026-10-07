/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createClipTrimPreview } from '../src/common/editor/ui/timeline/interaction-helpers.js';
import { resolveTimelineTrimPointerPreview } from '../src/common/editor/ui/timeline/trim-pointer-routing.ts';

for (const [changes, expected] of [
	[{ durationFrames: 480_000 }, { sequenceStartFrame: 0, sequenceFrameCount: 100, sourceStartTicks: '0' }],
	[{ timelineStartFrame: 48_000, durationFrames: 672_000 }, { sequenceStartFrame: 10, sequenceFrameCount: 140, sourceStartTicks: '1000000' }],
	[{ timelineStartFrame: 336_000, durationFrames: 384_000 }, { sequenceStartFrame: 70, sequenceFrameCount: 80, sourceStartTicks: '4999999' }],
	[{ durationFrames: 960_000 }, { sequenceStartFrame: 0, sequenceFrameCount: 200, sourceStartTicks: '0' }],
	[{ durationFrames: 1 }, { sequenceStartFrame: 0, sequenceFrameCount: 1, sourceStartTicks: '0' }],
] as const) test(`a normal image trim ${JSON.stringify(changes)} retains exact geometry, phase and history`, () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	let history = runtime.createHistory(fixture.project);
	const service = createClipTransformService({
		lifetime: { assertActive() {} }, copy: { audioClipNotFound: 'Missing clip',
			track: 'Track', timelineFramesFinite: 'Finite frames required' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as unknown as ClipTransformProject,
		getSelectedClipId: () => fixture.clip.id, editingBlocked: () => false,
		createId: prefix => `${prefix}-unused`, snapTimelineFrame: frame => Math.round(Number(frame)),
		activeSelection: () => null, commit: command => { history = runtime.executeCommand(history, command); },
	});
	service.trimClips(fixture.clip.id, changes);
	const after = history.present;
	assert.deepEqual(after.clips.find(clip => clip.id === fixture.clip.id), { ...fixture.clip, ...expected });
	assert.deepEqual(after.sources, fixture.project.sources);
	history = runtime.undo(history);
	assert.deepEqual(history.present.clips, fixture.project.clips);
	history = runtime.redo(history);
	assert.deepEqual(history.present.clips, after.clips);
});

test('the normal image trim pointer preview uses finite sequence geometry rather than nonexistent audio source bounds', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const project = runtime.projectForCommandConsumers(fixture.project);
	const clip = project.clips.find(item => item.id === fixture.clip.id);
	assert.ok(clip);
	const sourceById = new Map(project.sources.map(source => [source.id, source]));
	const owner = project.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id));
	assert.ok(owner);
	const preview = resolveTimelineTrimPointerPreview({
		project, projectIndex: { sourceById, trackByClipId: new Map([[clip.id, owner]]) },
		session: { clipId: clip.id, clipIds: [clip.id], original: clip, originals: { [clip.id]: clip } },
		edge: 'right', requestedBoundarySample: 480_000, legacyRequestedDelta: () => -240_000,
		previewVideo: () => assert.fail('An image is not a native video trim'),
		createLegacyPreview: createClipTrimPreview,
	}) as Readonly<{ durationFrames: number; timelineStartFrame: number }>;
	assert.equal(preview.durationFrames, 480_000);
	assert.equal(preview.timelineStartFrame, 0);
});
