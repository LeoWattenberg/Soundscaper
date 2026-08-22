/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
	createFramescaperProjectFeatureCompatibilityServiceV20,
	reconcileFramescaperProjectFeatureRequirementsV20,
	validateFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('neutral V20 documents do not falsely require video keyframes', () => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20.id,
	), false);
	assert.equal(createFramescaperProjectFeatureCompatibilityServiceV20(PROFILE).evaluate(project)?.compatible, true);
});

test('authored V20 curves own one natively available selected requirement', () => {
	assert.deepEqual(FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20, {
		id: 'framescaper.video-keyframes',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes,
		displayName: 'Video keyframes',
		disposition: 'bypass',
		fallback: null,
	});
	const project = authoredProject();
	assert.deepEqual(
		project.featureRequirements.requirements.at(-1),
		FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
	);
	assert.deepEqual(createFramescaperProjectFeatureCompatibilityServiceV20(PROFILE).evaluate(project)
		?.items.find(({ requirementId }) => requirementId === 'framescaper.video-keyframes'), {
		requirementId: 'framescaper.video-keyframes',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes,
		displayName: 'Video keyframes',
		availability: 'available',
		declaredDisposition: 'bypass',
		disposition: 'native',
		fallback: null,
		message: 'Video keyframes is available natively.',
	});
});

test('V20 compatibility admission rejects accessors without invoking them', () => {
	const project = structuredClone(createFramescaperProjectV20(
		PROFILE, framescaperV20Options(),
	)) as unknown as Record<string, unknown>;
	let getterCalls = 0;
	Object.defineProperty(videoClip(project).videoKeyframes as object, 'curves', {
		enumerable: true,
		get() { getterCalls += 1; return []; },
	});
	assert.throws(
		() => createFramescaperProjectFeatureCompatibilityServiceV20(PROFILE).evaluate(project),
		/accessor|enumerable data/iu,
	);
	assert.equal(getterCalls, 0);
});

test('every public V20 requirement entry structurally admits before semantic traversal', () => {
	for (const operation of [
		reconcileFramescaperProjectFeatureRequirementsV20,
		validateFramescaperProjectFeatureRequirementsV20,
	] as const) {
		const project = structuredClone(createFramescaperProjectV20(
			PROFILE, framescaperV20Options(),
		)) as unknown as Record<string, unknown>;
		let getterCalls = 0;
		const clips = project.clips as unknown[];
		Object.setPrototypeOf(clips, Object.create(Array.prototype, {
			map: { get() { getterCalls += 1; throw new Error('inherited map getter'); } },
		}));
		assert.throws(() => operation(PROFILE, project), /ordinary Array|array prototype|plain/iu);
		assert.equal(getterCalls, 0);
	}
});

test('V20 ownership rejects missing, stray, reserved-ID conflicts, and feature substitutions', () => {
	const neutral = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const missing = structuredClone(neutral) as unknown as Record<string, unknown>;
	videoClip(missing).videoKeyframes = opacityKeyframes();
	assert.throws(() => validateFramescaperProjectV20(PROFILE, missing), /require.*video-keyframes/iu);

	const stray = structuredClone(neutral) as unknown as Record<string, unknown>;
	stray.featureRequirements = {
		schemaVersion: 2,
		requirements: [
			...neutral.featureRequirements.requirements,
			FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
		],
	};
	assert.throws(() => validateFramescaperProjectV20(PROFILE, stray), /neutral.*must not retain/iu);

	const authored = structuredClone(neutral) as unknown as Record<string, unknown>;
	videoClip(authored).videoKeyframes = opacityKeyframes();
	for (const requirement of [{
		...FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
		displayName: 'Publisher keyframes',
	}, {
		...FRAMESCAPER_VIDEO_KEYFRAMES_REQUIREMENT_V20,
		id: 'publisher.video-keyframes',
	}]) {
		authored.featureRequirements = { schemaVersion: 2, requirements: [requirement] };
		assert.throws(
			() => reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, authored),
			/reserved|publisher|substitution|conflict/iu,
		);
	}
});

function authoredProject() {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	assert.equal(validateFramescaperProjectV20(PROFILE, project), true);
	return project;
}

function videoClip(project: Record<string, unknown>): Record<string, unknown> {
	return (project.clips as Record<string, unknown>[])[0]!;
}
