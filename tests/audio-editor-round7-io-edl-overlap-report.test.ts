/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand, prepareFramescaperVideoTransitionAllocations, snapshotFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { exportProjectEdl } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

for (const overlap of [false, true]) test(`ordinary ${overlap ? 'overlapping' : 'sequential'} Bin video cuts have an honest EDL delivery report`, async () => {
	const source = createVideoSource({ id: 'video-source', name: 'Camera.mp4', storageKey: 'camera.mp4',
		mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 192, height: 144 });
	const original = createFramescaperProject(PROFILE, { id: 'edl-cuts', sampleRate: 48_000, sources: [source],
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['video-track'] }],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: source.id, title: 'Camera', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
		tracks: [{ type: 'video', id: 'video-track', name: 'Video', clipIds: ['video-clip'] }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: source.id, title: 'Camera', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30, binItemId: 'bin-video' }] },
	});
	const command = prepareFramescaperVideoTransitionAllocations(PROFILE, original, snapshotFramescaperProjectCommand({
		type: 'project-bin/place', binClipId: 'bin-video', timelineStartFrame: overlap ? 24_000 : 48_000,
		placements: [{ binClipId: 'bin-video', trackId: 'video-track', clipId: 'second-video' }],
	}), () => 'transition');
	const project = applyFramescaperProjectCommand(PROFILE, original, command);
	const clipIds = project.tracks.find(track => track.id === 'video-track')?.clipIds;
	assert.ok(Array.isArray(clipIds));
	assert.equal(clipIds.length, 2);
	const result = await exportProjectEdl({ getProject: () => project, state: {}, fileService: { saveFile: () => true } });
	assert.ok(result);
	if (overlap) assert.throws(() => readWithReference(result.text, 'cmx_3600', { rate: 30 }, '.edl'), /Overlapping record in value/u);
	else assert.equal(referenceItems(readWithReference(result.text, 'cmx_3600', { rate: 30 }, '.edl')).filter(item => item.schema === 'Clip').length, 2);
	const warning = result.report.items.find(item => item.code === 'edl.overlapping-cuts-unsupported');
	assert.equal(Boolean(warning), overlap, 'the unsupported cut-only delivery must disclose its overlapping programme');
	if (overlap) {
		assert.equal(warning?.severity, 'warning');
		assert.equal(warning?.scope?.id, 'second-video');
		assert.deepEqual(warning?.data, { overlappingClipIds: ['video-clip'], recordInFrames: 15, recordOutFrames: 30 });
		assert.equal(warning?.disposition, 'omitted');
		assert.ok(Object.isFrozen(warning?.data.overlappingClipIds));
	}
	assert.equal(original.clips.length, 1);
});
