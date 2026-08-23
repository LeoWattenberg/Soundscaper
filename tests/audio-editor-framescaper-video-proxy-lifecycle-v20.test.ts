/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoProxyAttachmentV18 } from '../src/common/editor/video-proxy-attachment-v18.ts';
import { videoExportMissingOriginalError } from '../src/common/editor/controller/video-export-service.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	applyFramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-commands.ts';
import {
	createFramescaperProjectHistoryV20,
	executeFramescaperProjectCommandV20,
	redoFramescaperProjectCommandV20,
	undoFramescaperProjectCommandV20,
} from '../src/framescaper/editor-project-v20-history.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import {
	resolveFramescaperVideoProxyUseV20,
} from '../src/framescaper/editor-video-proxy-use-policy-v20.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const ORIGINAL_SHA256 = '12'.repeat(32);
const PROXY_SHA256 = '34'.repeat(32);
const TIMING_SHA256 = '56'.repeat(32);

test('V20 detach is stale-safe, one revision, and undoable without changing retime authority', () => {
	const attached = attachedProject();
	const attachment = videoSource(attached).proxyAttachment;
	assert.ok(attachment);
	let history = createFramescaperProjectHistoryV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		attached,
	);
	history = executeFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		history,
		{ type: 'framescaper/video-proxy-detach', sourceId: 'video-source', expectedAttachment: attachment as Readonly<VideoProxyAttachmentV18> },
		{ now: '2026-08-23T08:00:00.000Z' },
	);

	assert.equal(videoSource(history.present).proxyAttachment, null);
	assert.equal(history.present.revision, attached.revision + 1);
	assert.equal(videoClip(history.present).retimeMap, null);
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.redoStack.length, 0);
	assert.equal(hasProxyRequirement(history.present), false);

	history = undoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		history,
		{ now: '2026-08-23T08:01:00.000Z' },
	);
	assert.deepEqual(videoSource(history.present).proxyAttachment, attachment);
	history = redoFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		history,
		{ now: '2026-08-23T08:02:00.000Z' },
	);
	assert.equal(videoSource(history.present).proxyAttachment, null);
});

test('V20 detach refuses a stale attachment fence and never detaches an original', () => {
	const attached = attachedProject();
	const expected = structuredClone(videoSource(attached).proxyAttachment) as Record<string, unknown>;
	expected.sha256 = '78'.repeat(32);
	expected.storageKey = `video-proxy-sha256:${String(expected.sha256)}`;
	expected.timingAsset = {
		...(expected.timingAsset as Record<string, unknown>),
		sourceSha256: expected.sha256,
	};

	assert.throws(() => applyFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		attached,
		{ type: 'framescaper/video-proxy-detach', sourceId: 'video-source', expectedAttachment: expected as never },
	), /stale expected proxy attachment/iu);
	assert.ok(videoSource(attached).proxyAttachment);
	assert.equal(videoSource(attached).contentSha256, ORIGINAL_SHA256);
});

test('preview modes select verified proxies adaptively, including offline editing', () => {
	assert.deepEqual(resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'original', originalAvailable: true,
		proxyTrust: 'attested', pressure: { droppedFrameRatio: 1, decodeQueueDepth: 99, viewportScale: 0.1 },
	}), { kind: 'original', reason: 'original-mode', offline: false });

	assert.deepEqual(resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: { droppedFrameRatio: 0, decodeQueueDepth: 0, viewportScale: 1 },
	}), { kind: 'original', reason: 'auto-original', offline: false });

	assert.deepEqual(resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'auto', originalAvailable: true,
		proxyTrust: 'attested', pressure: { droppedFrameRatio: 0.03, decodeQueueDepth: 0, viewportScale: 1 },
	}), { kind: 'proxy', reason: 'adaptive-pressure', offline: false });

	assert.deepEqual(resolveFramescaperVideoProxyUseV20({
		purpose: 'preview', mode: 'proxy', originalAvailable: false,
		proxyTrust: 'offline-verified', pressure: null,
	}), { kind: 'proxy', reason: 'proxy-mode', offline: true });
});

test('export and delivery are original-authoritative even when a verified proxy is present', () => {
	for (const purpose of ['export', 'delivery'] as const) {
		assert.deepEqual(resolveFramescaperVideoProxyUseV20({
			purpose, mode: 'proxy', originalAvailable: true,
			proxyTrust: 'attested', pressure: null,
		}), { kind: 'original', reason: 'delivery-original', offline: false });
		assert.deepEqual(resolveFramescaperVideoProxyUseV20({
			purpose, mode: 'auto', originalAvailable: false,
			proxyTrust: 'offline-verified', pressure: null,
		}), { kind: 'unavailable', reason: 'delivery-original-unavailable', offline: true });
	}
	assert.match(videoExportMissingOriginalError(
		attachedProject(), 'video-source', 'Local sources missing.',
	).message, /original.*relink.*proxies.*preview-only.*cannot be delivered/iu);
});

function attachedProject(): FramescaperProjectV20 {
	const project = structuredClone(createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		framescaperV20Options(),
	)) as FramescaperProjectV20;
	(videoSource(project) as unknown as Record<string, unknown>).proxyAttachment = attachment();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(
			FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
			project,
		);
	validateFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, project);
	return project;
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

function videoSource(project: FramescaperProjectV20) {
	return project.sources.find(({ id }) => id === 'video-source')!;
}

function videoClip(project: FramescaperProjectV20) {
	return project.clips.find(({ id }) => id === 'video-clip')!;
}

function hasProxyRequirement(project: FramescaperProjectV20): boolean {
	return project.featureRequirements.requirements.some(({ id }) => id === 'framescaper.video-proxy');
}
