/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import {
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV27 } from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { createFramescaperPlaybackProjectServiceV27 } from '../src/framescaper/editor-project-playback-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperSelectedExactFrameExecutionV27 } from '../src/framescaper/selected-v27-exact-frame-execution.ts';
import { createFramescaperVideoExportStrategyV27 } from '../src/framescaper/video-export-strategy-v27.ts';
import { createFramescaperVideoExportVisualExecutionV27 } from '../src/framescaper/video-export-visual-execution-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 exact frame execution retains authenticated VFR timing sidecars', async () => {
	const fixture = vfrProjectFixture();
	const authority = Object.freeze({
		...renderAuthority(fixture.project, 10), timingViews: fixture.timingViews,
		visualFreshnessByModelId: new Map(),
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV27(
		PROFILE, fixture.project, authority,
	);
	const base = Object.freeze({
		project: fixture.project, plan, signal: new AbortController().signal,
		assertCurrent() {},
	});
	await assert.rejects(
		createFramescaperSelectedExactFrameExecutionV27(base as never),
		/verified timing asset sidecars/iu,
	);
	const execution = await createFramescaperSelectedExactFrameExecutionV27({
		...base, timingSidecars: fixture.timingSidecars,
	});
	await execution.dispose();
});

test('selected V27 visual export retains authenticated VFR timing and rejects omission', async () => {
	const fixture = vfrProjectFixture();
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE);
	const exportProject = strategy.createExportProject({
		canonicalProject: fixture.project,
		delivery: createFramescaperPlaybackProjectServiceV27(PROFILE)
			.projectForVideoRenderedFallbackDelivery(fixture.project) as ProductVideoExportDelivery,
	});
	const plan = strategy.createPlan({
		canonicalProject: fixture.project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 2, maximumHeight: 2 },
	});
	assert.ok(plan);
	const request = Object.freeze({
		profile: PROFILE, project: fixture.project, plan,
		timingViewsBySourceId: fixture.timingViews,
		signal: new AbortController().signal, assertCurrent() {},
	});
	const execution = await createFramescaperVideoExportVisualExecutionV27(request);
	execution.dispose();
	await assert.rejects(createFramescaperVideoExportVisualExecutionV27({
		...request, timingViewsBySourceId: new Map<string, VideoSourceTimingView>(),
	}), /timingViews.*exactly every video source/iu);
});

function vfrProjectFixture() {
	const publication = createVideoTimingAssetPublication('12'.repeat(32), {
		timescale: 100,
		presentationTicks: [0n, 8n, 20n, 30n, 42n, 50n, 62n, 70n, 82n, 90n],
		finalFrameDurationTicks: 10n,
	});
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	source.timingAsset = publication.reference;
	source.timingDecision = {
		mode: 'exact', rate: { num: 10, den: 1 }, backend: 'demuxer',
	};
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference, index,
	});
	const timingViews = new Map([['video-source', view]]);
	const timingSidecars = new Map([[
		'video-source', bindVideoSourceTimingView(timingViews,
			(project as unknown as { sources: readonly unknown[] }).sources[0]!),
	]]);
	return Object.freeze({ project, timingViews, timingSidecars });
}
