/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductVideoExportDelivery } from '../src/common/editor/controller/product-video-export-strategy.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../src/common/editor/project-owned-feature-requirements.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import { createFramescaperPlaybackProjectServiceV27 } from '../src/framescaper/editor-project-playback-v27.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	reimportFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import { createFramescaperVideoExportStrategyV27 } from '../src/framescaper/video-export-strategy-v27.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';
import { transitionProjectOptions } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('selected V27 browser strategy delegates exact retime/keyframe encoding through V20', async () => {
	const project = keyedProject();
	const captured: VideoKeyframeOfflineVideoExportRequest[] = [];
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE, {
		async encodeOffline(request) {
			captured.push(request);
			return Object.freeze({
				bytes: Uint8Array.of(1, 2, 3), byteLength: 3, videoEncoder: 'ffmpeg' as const,
				format: 'mp4' as const, extension: '.mp4' as const, mimeType: 'video/mp4' as const,
				frameCount: 10, rgbaChunkCount: 1, outputChunkCount: 1,
			});
		},
		async encodeOfflineToSink() { throw new Error('sink path is not used by this test'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: delivery(project),
	});
	assert.equal(exportProject.schemaVersion, 17);
	const canonicalClip = (project.clips as Readonly<Record<string, unknown>>[])[0]!;
	const exportClip = (exportProject.clips as Readonly<Record<string, unknown>>[])[0]!;
	assert.deepEqual(exportClip.videoKeyframes, canonicalClip.videoKeyframes);
	assert.deepEqual(exportClip.retimeMap, canonicalClip.retimeMap);
	const plan = strategy.createPlan({
		canonicalProject: project, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.equal(plan?.version, 7);
	assert.deepEqual(plan?.activeSourceIds, ['video-source']);
	assert.ok(plan);
	const encoded = await strategy.encode({
		canonicalProject: project, exportProject, plan,
		timingBySourceId: new Map(),
		videoBlobs: new Map([['video-source', new Blob(['video'], { type: 'video/mp4' })]]),
		audioMix: null,
		editorFfmpeg: {}, webCodecs: null,
		signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: 1_024,
	});
	assert.equal(encoded.byteLength, 3);
	assert.equal(captured.length, 1);
	assert.strictEqual(captured[0]?.project, exportProject);

	const other = keyedProject('other-v27');
	assert.throws(() => strategy.createPlan({
		canonicalProject: other, exportProject, format: 'mp4', range: 'project',
		includeAudio: false, canvas: undefined,
	}), /not owned.*exact V27/iu);
});

test('selected V27 browser strategy admits only neutral V13 state and refuses silent omission', () => {
	const strategy = createFramescaperVideoExportStrategyV27(PROFILE);
	const baseline = createFramescaperProjectV27(PROFILE, framescaperV20Options());
	const baselineExport = strategy.createExportProject({
		canonicalProject: baseline, delivery: delivery(baseline),
	});
	assert.equal(strategy.createPlan({
		canonicalProject: baseline, exportProject: baselineExport, format: 'mp4', range: 'project',
		includeAudio: false, canvas: undefined,
	}), null);

	const transition = createFramescaperProjectV27(PROFILE, transitionProjectOptions());
	assert.throws(() => strategy.createExportProject({
		canonicalProject: transition, delivery: delivery(transition),
	}), /refuses video transitions.*V13 finishing executor/iu);

	const generator = generatorProject();
	assert.throws(() => strategy.createExportProject({
		canonicalProject: generator, delivery: delivery(generator),
	}), /refuses stills or generated visuals.*V13 finishing executor/iu);

	const overriddenValue = structuredClone(baseline) as unknown as Record<string, unknown>;
	const interpretation = (overriddenValue.videoSourceColorInterpretations as Record<string, unknown>[])[0]!;
	interpretation.provenance = 'user-override';
	const overridden = cloneFramescaperProjectV27(PROFILE, overriddenValue);
	assert.throws(() => strategy.createExportProject({
		canonicalProject: overridden, delivery: delivery(overridden),
	}), /refuses.*color interpretation override/iu);

	const legacy = reimportFramescaperProjectV27(PROFILE, createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, framescaperV20Options(),
	));
	assert.throws(() => strategy.createExportProject({
		canonicalProject: legacy, delivery: delivery(legacy),
	}), /legacy unmanaged source/iu);
});

function keyedProject(id = 'keyed-v27') {
	const options = framescaperV20Options();
	options.id = id;
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
	});
	const mutable = project as unknown as Record<string, unknown>;
	const clip = (mutable.clips as Record<string, unknown>[])[0]!;
	clip.videoKeyframes = opacityKeyframes(10);
	clip.retimeMap = {
		feature: 'video-retime', version: 2,
		points: [
			{ outerFrame: 0, sourceFrame: { num: 10, den: 1 } },
			{ outerFrame: 10, sourceFrame: { num: 0, den: 1 } },
		],
		segments: [{ mode: 'constant-reverse' }],
	};
	mutable.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		mutable,
		mutable.featureRequirements as Parameters<typeof reconcileProjectOwnedFeatureRequirements>[1],
	);
	mutable.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, mutable);
	return cloneFramescaperProjectV27(PROFILE, mutable);
}

function generatorProject() {
	return createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			generatorSources: [{
				schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
				width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 10,
				generator: { kind: 'solid', color: '#000000ff' },
			}],
		},
	});
}

function delivery(project: ReturnType<typeof createFramescaperProjectV27>): ProductVideoExportDelivery {
	return createFramescaperPlaybackProjectServiceV27(PROFILE)
		.projectForVideoRenderedFallbackDelivery(project) as ProductVideoExportDelivery;
}
