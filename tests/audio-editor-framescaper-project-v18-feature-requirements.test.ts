/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FRAMESCAPER_VIDEO_PROXY_FEATURE_ID,
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
	createFramescaperProjectFeatureCompatibilityServiceV18,
	reconcileFramescaperProjectFeatureRequirementsV18,
} from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import {
	createFramescaperProjectV18,
	loadFramescaperProjectV18,
	validateFramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const ORIGINAL_SHA = '12'.repeat(32);
const PROXY_SHA = '34'.repeat(32);
const TIMING_SHA = '56'.repeat(32);

test('V18 feature ownership authenticates the exact profile before project traversal', () => {
	let traps = 0;
	const project = new Proxy({}, {
		get() { traps += 1; throw new Error('project trap'); },
		getOwnPropertyDescriptor() { traps += 1; throw new Error('project trap'); },
	});
	assert.throws(
		() => reconcileFramescaperProjectFeatureRequirementsV18({}, project),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.throws(
		() => createFramescaperProjectFeatureCompatibilityServiceV18({}),
		/exact Framescaper V18 runtime profile/iu,
	);
	assert.equal(traps, 0);
});

test('the private proxy requirement is exact and never enters the V17 global registry', () => {
	assert.deepEqual(FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18, {
		id: 'framescaper.video-proxy',
		featureId: 'org.soundscaper.capability.video-proxy',
		displayName: 'Video proxy attachments',
		disposition: 'bypass',
		fallback: null,
	});
	assert.equal(Object.isFrozen(FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18), true);
	assert.equal(FRAMESCAPER_VIDEO_PROXY_FEATURE_ID, 'org.soundscaper.capability.video-proxy');
	assert.equal(Object.values(PROJECT_FEATURE_CAPABILITY_IDS).includes(
		FRAMESCAPER_VIDEO_PROXY_FEATURE_ID as never,
	), false);
});

test('all-null V18 creation and reconciliation remove the private proxy requirement', () => {
	const project = createFramescaperProjectV18(PROFILE, {
		...options(),
		featureRequirements: manifest([FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18]),
	});
	assert.equal(project.sources[0]?.proxyAttachment, null);
	assert.deepEqual(project.featureRequirements, manifest([]));

	const retained = structuredClone(project) as Record<string, unknown>;
	retained.featureRequirements = manifest([FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18]);
	assert.throws(() => validateFramescaperProjectV18(PROFILE, retained), /all-null.*must not retain/iu);
	assert.deepEqual(reconcileFramescaperProjectFeatureRequirementsV18(PROFILE, retained), manifest([]));
});

test('an attached V18 project requires exactly the reserved bypass declaration', () => {
	const project = attachedProject();
	assert.throws(() => validateFramescaperProjectV18(PROFILE, project), /requires.*framescaper.video-proxy/iu);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(PROFILE, project);
	assert.deepEqual(project.featureRequirements, manifest([FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18]));
	assert.equal(validateFramescaperProjectV18(PROFILE, project), true);

	for (const [requirement, message] of [
		[{ ...FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18, disposition: 'rendered-fallback', fallback: {
			role: 'project-video-render-v1', kind: 'video', sourceId: 'video-source', sha256: ORIGINAL_SHA,
		} }, /reserved.*conflicts/iu],
		[{ ...FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18, featureId: 'org.example.proxy' }, /reserved.*conflicts/iu],
		[{ ...FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18, id: 'publisher.video-proxy' }, /publisher.*substitution/iu],
	] as const) {
		const invalid = attachedProject();
		invalid.featureRequirements = manifest([requirement]);
		assert.throws(() => validateFramescaperProjectV18(PROFILE, invalid), message);
	}
});

test('the V18 compatibility service reports the private capability known and unavailable', () => {
	const service = createFramescaperProjectFeatureCompatibilityServiceV18(PROFILE);
	const allNull = createFramescaperProjectV18(PROFILE, options());
	assert.deepEqual(service.evaluate(allNull), {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: true,
		counts: { available: 0, unavailable: 0, unknown: 0 },
		items: [],
	});

	const project = attachedProject();
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV18(PROFILE, project);
	const report = service.evaluate(project);
	assert.equal(report?.compatible, false);
	assert.deepEqual(report?.counts, { available: 0, unavailable: 1, unknown: 0 });
	assert.deepEqual(report?.items[0], {
		requirementId: 'framescaper.video-proxy',
		featureId: FRAMESCAPER_VIDEO_PROXY_FEATURE_ID,
		displayName: 'Video proxy attachments',
		availability: 'unavailable',
		declaredDisposition: 'bypass',
		disposition: 'bypassed',
		fallback: null,
		message: 'Video proxy attachments is known but unavailable and will be bypassed.',
	});
	assert.deepEqual(loadFramescaperProjectV18(PROFILE, project), {
		project,
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'proxy-attached',
	});
});

test('compatibility leaves non-V18 documents opaque', () => {
	const service = createFramescaperProjectFeatureCompatibilityServiceV18(PROFILE);
	let nestedGets = 0;
	const future = { schemaVersion: 19 } as Record<string, unknown>;
	Object.defineProperty(future, 'featureRequirements', {
		enumerable: true,
		get() { nestedGets += 1; throw new Error('future trap'); },
	});
	assert.equal(service.evaluate(future), null);
	assert.equal(service.evaluate({ schemaVersion: 17 }), null);
	assert.equal(nestedGets, 0);
});

function attachedProject(): Record<string, unknown> & {
	featureRequirements: unknown;
	sources: Record<string, unknown>[];
} {
	const project = structuredClone(createFramescaperProjectV18(PROFILE, options())) as unknown as Record<string, unknown> & {
		featureRequirements: unknown;
		sources: Record<string, unknown>[];
	};
	project.sources[0]!.proxyAttachment = attachment();
	return project;
}

function manifest(requirements: readonly unknown[]): Readonly<Record<string, unknown>> {
	return { schemaVersion: 2, requirements };
}

function options(): Record<string, unknown> {
	return {
		id: 'framescaper-v18-features',
		title: 'Framescaper V18 features',
		now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'video-source', name: 'Video', storageKey: 'video-source', mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	};
}

function attachment(): Readonly<Record<string, unknown>> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`, mimeType: 'video/mp4', byteLength: 123,
		sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${TIMING_SHA}`,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: 112, frameCount: 10,
			timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
