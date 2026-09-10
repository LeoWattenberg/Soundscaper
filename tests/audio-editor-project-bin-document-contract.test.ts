/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { findProjectBinClipTrack, projectBinMediaKind } from '../src/common/editor/controller/import/project-bin-types.ts';
import { clipFixture, createHarness, createPreviewEngine, projectFixture } from './helpers/project-bin-service-harness.ts';

void test('project bin preview resolves musical timing before constructing its audio model', async () => {
	const clip = clipFixture({ id: 'musical', anchor: 'musical', musicalExtent: 'beat',
		musicalStartBeat: { num: 2, den: 1 }, musicalDurationBeats: { num: 2, den: 1 },
		timelineStartFrame: undefined, durationFrames: undefined });
	const project = { ...projectFixture({ projectBinClips: [clip] }), sampleRate: 1_000,
		tempoMap: { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
	const loaded: EngineProject[] = [];
	const previewEngine = createPreviewEngine(Promise.resolve());
	previewEngine.loadProject = (snapshot) => { if (snapshot) loaded.push(snapshot); };
	const harness = createHarness(project, { previewEngine });
	await harness.service.playPauseProjectBinClip(clip.id);
	assert.equal(loaded[0]?.clips?.[0]?.durationFrames, 1_000);
	assert.equal(loaded[0]?.clips?.[0]?.timelineStartFrame, 0);
	await harness.service.dispose();
});

void test('bin inventory keeps images visual and skips label tracks when locating instances', async () => {
	const image = clipFixture({ kind: 'image' });
	const project = { ...projectFixture({ clips: [image], projectBinClips: [image] }),
		tracks: [{ id: 'labels', type: 'label' as const }, { id: 'picture', type: 'video' as const, clipIds: [image.id] }] };
	assert.equal(projectBinMediaKind(image), 'image');
	assert.equal(findProjectBinClipTrack(project, image.id)?.id, 'picture');
	const harness = createHarness(project);
	await assert.rejects(harness.service.playPauseProjectBinClip(image.id), /Image.*preview/);
	assert.throws(() => harness.service.placeProjectBinClip(image.id, { trackId: 'picture' }), /image placement/);
	assert.deepEqual(harness.commits, []);
	await harness.service.dispose();
});
