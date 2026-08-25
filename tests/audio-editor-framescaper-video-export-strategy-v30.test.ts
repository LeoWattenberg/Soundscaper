/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import { createFramescaperPlaybackProjectServiceV30 } from '../src/framescaper/editor-project-playback-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { createFramescaperVideoExportStrategyV30 } from '../src/framescaper/video-export-strategy-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { createFramescaperV30ImageFixture } from './helpers/framescaper-v30-image-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;

test('selected V30 browser strategy retains inherited generator export', () => {
	const project = generatorProject();
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE);
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: delivery(project),
	});
	assert.equal(strategy.hasPicture?.(exportProject), true);
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.equal(plan?.version, 13);
	assert.deepEqual(strategy.captureTimingSourceIds?.(plan!), []);
});

test('selected V30 browser strategy refuses to omit timeline images', () => {
	const project = createFramescaperV30ImageFixture().project;
	const strategy = createFramescaperVideoExportStrategyV30(PROFILE);
	assert.throws(() => strategy.createExportProject({
		canonicalProject: project,
		delivery: delivery(project),
	}), /timeline image.*not yet available|refuses.*image/iu);
});

function generatorProject() {
	const options = framescaperV20Options();
	options.sources = [];
	options.clips = [{
		schemaVersion: 1,
		kind: 'generator',
		id: 'solid-clip',
		sourceId: 'solid-source',
		sequenceId: 'main-sequence',
		sequenceStartFrame: 0,
		sequenceFrameCount: 10,
		sourceInFrame: 0,
		sourceFrameCount: 10,
	}];
	(options.projectBin as Record<string, unknown>).clips = [];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['solid-clip'];
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	return createFramescaperProjectV30(PROFILE, {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1,
				kind: 'generator',
				id: 'solid-source',
				name: 'Solid',
				width: 2,
				height: 2,
				frameRate: { num: 10, den: 1 },
				frameCount: 10,
				generator: { kind: 'solid', color: '#ff0000ff' },
			}],
		},
	});
}

function delivery(project: ReturnType<typeof createFramescaperProjectV30>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV30(PROFILE)
		.projectForVideoRenderedFallbackDelivery!(project) as ProductVideoExportDelivery;
}
