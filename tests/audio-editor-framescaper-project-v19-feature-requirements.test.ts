/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19,
	createFramescaperProjectFeatureCompatibilityServiceV19,
	reconcileFramescaperProjectFeatureRequirementsV19,
} from '../src/framescaper/editor-project-feature-requirements-v19.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import {
	createFramescaperProjectV19,
	validateFramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;

test('neutral V19 documents do not falsely require video compositing', () => {
	const project = createFramescaperProjectV19(PROFILE, options());
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19.id,
	), false);
	assert.equal(createFramescaperProjectFeatureCompatibilityServiceV19(PROFILE).evaluate(project)?.compatible, true);
});

test('authored V19 geometry owns one native no-fallback requirement', () => {
	assert.deepEqual(FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19, {
		id: 'framescaper.video-geometry',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoGeometry,
		displayName: 'Video transforms and compositing',
		disposition: 'bypass',
		fallback: null,
	});
	const project = createFramescaperProjectV19(PROFILE, options());
	const authored = structuredClone(project) as unknown as Record<string, unknown>;
	const composition = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION) as unknown as Record<string, unknown>;
	composition.opacity = 0.75;
	((authored.clips as Record<string, unknown>[])[0]!).videoComposition = composition;
	authored.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(PROFILE, authored);
	assert.equal(validateFramescaperProjectV19(PROFILE, authored), true);
	assert.deepEqual(
		(authored.featureRequirements as { requirements: readonly unknown[] }).requirements.at(-1),
		FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19,
	);
	const report = createFramescaperProjectFeatureCompatibilityServiceV19(PROFILE).evaluate(authored);
	assert.deepEqual(report?.items.find(
		({ requirementId }) => requirementId === FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19.id,
	), {
		requirementId: 'framescaper.video-geometry',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoGeometry,
		displayName: 'Video transforms and compositing',
		availability: 'available',
		declaredDisposition: 'bypass',
		disposition: 'native',
		fallback: null,
		message: 'Video transforms and compositing is available natively.',
	});
});

test('V19 ownership rejects missing, stray, and publisher-conflicting declarations', () => {
	const project = createFramescaperProjectV19(PROFILE, options());
	const authored = structuredClone(project) as unknown as Record<string, unknown>;
	const composition = structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION) as unknown as Record<string, unknown>;
	composition.blendMode = 'multiply';
	((authored.clips as Record<string, unknown>[])[0]!).videoComposition = composition;
	assert.throws(() => validateFramescaperProjectV19(PROFILE, authored), /requires.*video-geometry/iu);

	const stray = structuredClone(project) as unknown as Record<string, unknown>;
	stray.featureRequirements = {
		schemaVersion: 2,
		requirements: [
			...(project.featureRequirements.requirements),
			FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19,
		],
	};
	assert.throws(() => validateFramescaperProjectV19(PROFILE, stray), /neutral.*must not retain/iu);

	const conflict = structuredClone(authored) as unknown as Record<string, unknown>;
	conflict.featureRequirements = {
		schemaVersion: 2,
		requirements: [{
			...FRAMESCAPER_VIDEO_COMPOSITION_REQUIREMENT_V19,
			id: 'publisher.video-composition',
		}],
	};
	assert.throws(
		() => reconcileFramescaperProjectFeatureRequirementsV19(PROFILE, conflict),
		/publisher.*substitution/iu,
	);
});

function options(): Record<string, unknown> {
	return {
		id: 'v19-requirements', title: 'V19 requirements', now: '2026-08-13T12:00:00.000Z',
		sources: [{
			kind: 'video', id: 'source', name: 'Source', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080,
		}],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Clip', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
			retimeMap: null,
		}],
		tracks: [{
			type: 'video', id: 'track', name: 'Video', clipIds: ['clip'], locked: false,
			height: 96, collapsed: false,
		}],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'main-sequence',
	};
}
