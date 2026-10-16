/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrimMediaPlan } from '../src/common/editor/trim-media-plan.ts';
import { runTrimMedia } from '../src/common/editor/trim-media-operation.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

for (const scope of ['timeline', 'project-bin'] as const) {
	test(`trim retains a normally authored ${scope} image asset without claiming it is unreferenced`, async () => {
		const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
		const track = fixture.project.tracks.find(({ type }) => type === 'video');
		assert.ok(track);
		const project = scope === 'timeline' ? fixture.project : applyFramescaperProjectCommand(PROFILE, fixture.project, {
			type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip,
			expectedPlacement: { scope: 'timeline', trackId: track.id }, clip: fixture.clip,
			placement: { scope: 'project-bin' },
		});
		const plan = createTrimMediaPlan({ project });
		const image = plan.sources.find(({ sourceId }) => sourceId === fixture.source.id);
		assert.ok(image);
		assert.equal(image.referenceCount, 1);
		assert.equal(image.frameCount, fixture.source.canonical.frameCount);
		assert.equal(image.wholeSourceRetained, true);
		assert.deepEqual(image.retained, [{ startFrame: 0, endFrame: fixture.source.canonical.frameCount }]);
		const result = await runTrimMedia({ plan }, {
			writeTrimmedCopy: async () => { throw new Error('An image asset must not enter the lossless video cutter.'); },
			rebind: async () => false, discardTrimmedCopy: async () => undefined,
		});
		const item = result.report.items.find(({ scope: itemScope }) => itemScope.id === fixture.source.id);
		assert.equal(item?.code, 'trim.source-whole');
		assert.equal(item?.disposition, 'preserved');
	});
}

test('a normal shortened animated image keeps its complete immutable frame pack', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const track = fixture.project.tracks.find(({ type }) => type === 'video');
	assert.ok(track);
	const placement = { scope: 'timeline' as const, trackId: track.id };
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, {
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip, expectedPlacement: placement,
		clip: { ...fixture.clip, sourceStartTicks: '1000000', sequenceFrameCount: 30 }, placement,
	});
	const image = createTrimMediaPlan({ project }).sources.find(({ sourceId }) => sourceId === fixture.source.id);
	assert.equal(image?.retainedFrames, 2);
	assert.equal(image?.discardedFrames, 0);
});

test('removing the actual image clip still identifies its unused source accurately', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const track = fixture.project.tracks.find(({ type }) => type === 'video');
	assert.ok(track);
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, {
		type: 'image-clip/set', clipId: fixture.clip.id, expectedClip: fixture.clip,
		expectedPlacement: { scope: 'timeline', trackId: track.id }, clip: null, placement: null,
	});
	const image = createTrimMediaPlan({ project }).sources.find(({ sourceId }) => sourceId === fixture.source.id);
	assert.equal(image?.referenceCount, 0);
	assert.equal(image?.retainedFrames, 0);
});
