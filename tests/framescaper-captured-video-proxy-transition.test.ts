/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	nextCapturedVideoProxyAttachmentProject,
} from '../src/framescaper/editor-captured-video-proxy-transition.ts';
import {
	reconcileFramescaperProjectFeatureRequirements,
} from '../src/framescaper/editor-project-feature-requirements.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

const SOURCE_ID = 'video-source';
const FRAME_COUNT = 10;

const dependencies = {
	profile: FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	reconcileProjectRequirements: (project: unknown) => (
		reconcileFramescaperProjectFeatureRequirements(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, project)
	),
} as never;

function baseProject(): Data {
	return createFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options() as never,
	) as unknown as Data;
}

function originalDigest(project: Data): string {
	return String(videoSource(project).contentSha256);
}

function videoSource(project: Data): Data {
	return (project.sources as Data[]).find(({ id }) => id === SOURCE_ID)!;
}

function attachment(project: Data, proxyByte: string, timingByte: string): Data {
	const proxySha256 = proxyByte.repeat(32);
	const timingSha256 = timingByte.repeat(32);
	return {
		kind: 'video-proxy-attachment',
		version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha256}`,
		mimeType: 'video/mp4',
		byteLength: 1_024,
		sha256: proxySha256,
		originalSha256: originalDigest(project),
		originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg',
		generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1',
		recipeVersion: 1,
		timingBackendId: 'ffprobe',
		timingRule: 'exact-presentation-boundaries-v1',
		frameCount: FRAME_COUNT,
		boundaryCount: FRAME_COUNT + 1,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256,
			sourceSha256: proxySha256,
			byteLength: 112,
			frameCount: FRAME_COUNT,
			timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function advance(base: Data, next: Data, expected?: Data): Data {
	return nextCapturedVideoProxyAttachmentProject(
		dependencies,
		base as never,
		SOURCE_ID,
		next as never,
		expected as never,
	) as unknown as Data;
}

test('the first attachment advances the revision without mutating the base project', () => {
	const base = baseProject();
	const next = attachment(base, '34', '56');

	const advanced = advance(base, next);

	assert.equal(advanced.revision, Number(base.revision) + 1);
	assert.equal((videoSource(advanced).proxyAttachment as Data).sha256, next.sha256);
	assert.equal(videoSource(base).proxyAttachment, null);
});

test('an existing attachment is swapped only when the expected revision still matches', () => {
	const base = baseProject();
	const first = advance(base, attachment(base, '34', '56'));

	const swapped = advance(
		first,
		attachment(base, '78', '9a'),
		videoSource(first).proxyAttachment as Data,
	);

	assert.equal((videoSource(swapped).proxyAttachment as Data).sha256, '78'.repeat(32));
	assert.equal(swapped.revision, Number(base.revision) + 2);
});

test('a stale expected attachment refuses the swap', () => {
	const base = baseProject();
	const first = advance(base, attachment(base, '34', '56'));

	assert.throws(
		() => advance(first, attachment(base, '78', '9a'), attachment(base, '99', '9a')),
		/changed before its exact swap/u,
	);
});

test('attaching over an existing attachment without naming it is refused', () => {
	const base = baseProject();
	const first = advance(base, attachment(base, '34', '56'));

	assert.throws(
		() => advance(first, attachment(base, '78', '9a')),
		/changed before its exact swap/u,
	);
});

test('an unknown source identity is refused before any revision is spent', () => {
	const base = baseProject();

	assert.throws(() => nextCapturedVideoProxyAttachmentProject(
		dependencies,
		base as never,
		'missing-source',
		attachment(base, '34', '56') as never,
	), ReferenceError);
});

test('a project at the revision ceiling cannot advance', () => {
	const base = baseProject();
	const maxed = { ...base, revision: Number.MAX_SAFE_INTEGER };

	assert.throws(() => advance(maxed, attachment(base, '34', '56')), RangeError);
});

test('the update timestamp advances even when the base timestamp is ahead of the clock', () => {
	const base = baseProject();
	const future = { ...base, updatedAt: new Date(Date.now() + 3_600_000).toISOString() };

	const advanced = advance(future, attachment(base, '34', '56'));

	assert.ok(
		new Date(String(advanced.updatedAt)).getTime()
			> new Date(String(future.updatedAt)).getTime(),
		'a proxy attachment must never carry a timestamp at or before its base revision',
	);
});
