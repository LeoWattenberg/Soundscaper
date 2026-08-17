/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
	DIRECT_VIDEO_ADMITTED_PLAN_VERSIONS,
	SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS,
	VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
} from '../src/common/editor/video-export-plan-version.ts';

const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);
const narrativeUrl = new URL('../docs/quality-budgets.md', import.meta.url);

function videoProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video',
			id: 'source-a',
			name: 'Source',
			mimeType: 'video/mp4',
			storageKey: 'media/source-a',
			frameCount: 20_000,
			sampleRate: 1_000,
			width: 1_280,
			height: 720,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: true,
			posterStorageKey: null,
			thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video',
			id: 'clip-a',
			sourceId: 'source-a',
			title: 'Video',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 10_000,
			durationFrames: 10_000,
			trimStartFrames: 0,
			trimEndFrames: 0,
			speedRatio: 1,
			groupId: null,
			avLinkId: null,
			binItemId: null,
			color: 'blue',
		}],
		tracks: [{
			type: 'video',
			id: 'track-a',
			name: 'Video',
			clipIds: ['clip-a'],
			mute: false,
			hidden: false,
			collapsed: false,
			height: 120,
			laneGroupId: null,
		}],
	};
}

test('the two plan kinds never claim the same version number', () => {
	assert.notEqual(
		CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		VIDEO_KEYFRAME_EXPORT_PLAN_VERSION,
		'a graph plan and a keyframe plan sharing one number would make admission ambiguous',
	);
});

test('the graph runner accepts the canonical version and its history, never the keyframe version', () => {
	assert.ok(
		SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS.includes(CANONICAL_VIDEO_EXPORT_PLAN_VERSION),
		'the runner must read what the planner emits',
	);
	assert.ok(
		!SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS.includes(VIDEO_KEYFRAME_EXPORT_PLAN_VERSION),
		'the keyframe plan is a different shape and must not enter the graph runner',
	);
	assert.deepEqual(
		[...SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS].sort((a, b) => a - b),
		[...SUPPORTED_VIDEO_EXPORT_PLAN_VERSIONS],
		'supported versions are recorded in ascending order',
	);
});

test('the direct path admits exactly the canonical graph plan and the keyframe plan', () => {
	assert.deepEqual(
		[...DIRECT_VIDEO_ADMITTED_PLAN_VERSIONS],
		[CANONICAL_VIDEO_EXPORT_PLAN_VERSION, VIDEO_KEYFRAME_EXPORT_PLAN_VERSION],
	);
});

test('the planner stamps the canonical version rather than a literal of its own', () => {
	const plan = createVideoExportPlan(videoProject(), {});
	assert.equal(plan.version, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
});

test('the quality-budget fixture pins the version the planner actually emits', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(
		({ id }: { id: string }) => id === 'm2-direct-mp4-webm-video-output-v1',
	);
	assert.ok(fixture, 'the direct video fixture must exist');
	assert.equal(
		fixture.specification.planVersion,
		CANONICAL_VIDEO_EXPORT_PLAN_VERSION,
		'a fixture describing version-N plans while the planner emits version-M is the stale pin this test exists to catch',
	);
});

test('the budgets narrative names the version the planner actually emits', async () => {
	const narrative = await readFile(narrativeUrl, 'utf8');
	const canonicalMentions = narrative.match(/canonical version-(\d+)\s+plans/gu) ?? [];
	assert.ok(canonicalMentions.length > 0, 'the narrative must describe the bound plan version');
	for (const mention of canonicalMentions) {
		assert.equal(
			mention.replace(/\s+/gu, ' '),
			`canonical version-${CANONICAL_VIDEO_EXPORT_PLAN_VERSION} plans`,
			'the narrative drifted from the planner',
		);
	}
});
