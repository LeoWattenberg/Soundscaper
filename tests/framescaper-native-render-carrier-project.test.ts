/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_CARRIER_MIME,
	framescaperNativeRenderCarrierProjectNativeMedia,
} from '../src/framescaper/editor-native-render-carrier-project.ts';
import {
	assertFramescaperNativeCarrierFamiliesNativeMedia,
	framescaperNativeCarrierPlanningRateNativeMedia,
} from '../src/framescaper/editor-native-render-carrier-semantics.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { createFramescaperVideoExportStrategyFinishing } from '../src/framescaper/video-export-strategy-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { professionalProject } from './helpers/framescaper-unified-render-project-fixture.ts';

type Data = Record<string, unknown>;

function imageSequenceProject() {
	const options = framescaperV20Options();
	const source = (options.sources as Data[]).find(({ kind }) => kind === 'video');
	const sequenceSource = professionalProject().sources.find(({ kind }) => kind === 'video');
	assert.ok(source && sequenceSource?.kind === 'video' && sequenceSource.imageSequence);
	Object.assign(source, {
		storageKey: sequenceSource.storageKey,
		mimeType: 'image/png',
		contentSha256: sequenceSource.contentSha256,
		characteristics: sequenceSource.characteristics,
		imageSequence: sequenceSource.imageSequence,
	});
	return createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options,
	);
}

test('the inherited keyed carrier alone projects a native sequence to a canonical video MIME', () => {
	const project = imageSequenceProject();
	const canonicalSnapshot = structuredClone(project);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const carrierProject = framescaperNativeRenderCarrierProjectNativeMedia(project);
	const canonicalSource = project.sources.find(({ kind }) => kind === 'video');
	const carrierSource = (carrierProject.sources as unknown as readonly Data[])
		.find(({ kind }) => kind === 'video');

	assert.equal(canonicalSource?.mimeType, 'image/png');
	assert.ok(canonicalSource?.imageSequence);
	assert.equal(carrierSource?.mimeType, FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_CARRIER_MIME);
	assert.equal(Object.hasOwn(carrierSource ?? {}, 'imageSequence'), false);
	assert.deepEqual(project, canonicalSnapshot);
	assert.doesNotThrow(() => assertFramescaperNativeCarrierFamiliesNativeMedia(plan, project));

	const strategy = createFramescaperVideoExportStrategyFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
	);
	const delivery = Object.freeze({
		project: carrierProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: Object.freeze([]), requiredVideoSourceIds: Object.freeze([]),
	});
	const exportProject = strategy.createExportProject({ canonicalProject: carrierProject, delivery });
	const carrierPlan = strategy.createPlan({
		canonicalProject: carrierProject, exportProject, format: 'mp4', range: 'project',
		includeAudio: false,
		canvas: Object.freeze({
			size: Object.freeze({ width: plan.output.canvas.width, height: plan.output.canvas.height }),
			frameRate: framescaperNativeCarrierPlanningRateNativeMedia(plan.output.frameRate),
			fit: plan.output.canvas.fit, backgroundColor: plan.output.canvas.backgroundColor,
		}),
	});
	assert.ok(carrierPlan);
	assert.doesNotThrow(() => assertVideoKeyframeExportPlanV7(carrierPlan));
});
