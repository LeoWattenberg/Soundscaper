/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoProxyAttachmentV18 } from '../src/common/editor/video-proxy-attachment-v18.ts';
import {
	createFramescaperVideoProxyDetachCommandV27,
} from '../src/framescaper/editor-project-v27-commands.ts';
import {
	createFramescaperProjectHistoryV27,
	executeFramescaperProjectCommandV27,
	redoFramescaperProjectCommandV27,
	undoFramescaperProjectCommandV27,
} from '../src/framescaper/editor-project-v27-history.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV27,
} from '../src/framescaper/editor-project-feature-requirements-v27.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	createFramescaperProjectV27,
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
const ORIGINAL_SHA256 = '12'.repeat(32);
const PROXY_SHA256 = '34'.repeat(32);
const TIMING_SHA256 = '56'.repeat(32);

test('selected V27 owns a stale-safe proxy detach through exact history', () => {
	const project = attachedProject();
	const attached = videoSource(project).proxyAttachment;
	assert.ok(attached);
	let history = executeFramescaperProjectCommandV27(
		PROFILE,
		createFramescaperProjectHistoryV27(PROFILE, project),
		createFramescaperVideoProxyDetachCommandV27('video-source', attached),
		{ now: '2026-08-23T12:00:00.000Z' },
	);

	assert.equal(videoSource(history.present).proxyAttachment, null);
	assert.equal(history.present.revision, Number(project.revision) + 1);
	history = undoFramescaperProjectCommandV27(
		PROFILE, history, { now: '2026-08-23T12:01:00.000Z' },
	);
	assert.deepEqual(videoSource(history.present).proxyAttachment, attached);
	history = redoFramescaperProjectCommandV27(
		PROFILE, history, { now: '2026-08-23T12:02:00.000Z' },
	);
	assert.equal(videoSource(history.present).proxyAttachment, null);
});

test('selected V27 detach refuses a stale attachment fence', () => {
	const project = attachedProject();
	const stale = structuredClone(videoSource(project).proxyAttachment) as VideoProxyAttachmentV18;
	(stale as unknown as Record<string, unknown>).originalSha256 = '78'.repeat(32);
	assert.throws(() => executeFramescaperProjectCommandV27(
		PROFILE,
		createFramescaperProjectHistoryV27(PROFILE, project),
		createFramescaperVideoProxyDetachCommandV27('video-source', stale),
	), /stale expected proxy attachment/iu);
	assert.ok(videoSource(project).proxyAttachment);
});

function attachedProject(): FramescaperProjectV27 {
	const project = structuredClone(createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
	})) as FramescaperProjectV27;
	(videoSource(project) as unknown as Record<string, unknown>).proxyAttachment = attachment();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, project);
	validateFramescaperProjectV27(PROFILE, project);
	return project;
}

function videoSource(project: FramescaperProjectV27) {
	const sources = (project as unknown as {
		readonly sources: readonly Readonly<Record<string, unknown>>[];
	}).sources;
	return sources.find(({ id }) => id === 'video-source') as Readonly<Record<string, unknown>> & {
		readonly proxyAttachment: VideoProxyAttachmentV18 | null;
	};
}

function attachment(): VideoProxyAttachmentV18 {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA256}`,
		mimeType: 'video/mp4', byteLength: 1_024, sha256: PROXY_SHA256,
		originalSha256: ORIGINAL_SHA256, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${TIMING_SHA256}`,
			sha256: TIMING_SHA256, sourceSha256: PROXY_SHA256,
			byteLength: 112, frameCount: 10, timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
