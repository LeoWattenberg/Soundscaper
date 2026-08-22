/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	framescaperProjectForCommandConsumersV20,
	framescaperProjectForPlaybackFoundationV20,
	framescaperProjectForRuntimeConsumersV20,
} from '../src/framescaper/editor-project-v20-runtime.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V20 runtime authenticates its selected authority before project traversal', () => {
	let reads = 0;
	const hostile = new Proxy({}, {
		get() { reads += 1; throw new Error('project get'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('project descriptor'); },
		ownKeys() { reads += 1; throw new Error('project keys'); },
	});
	for (const operation of [
		framescaperProjectForCommandConsumersV20,
		framescaperProjectForPlaybackFoundationV20,
		framescaperProjectForRuntimeConsumersV20,
	]) assert.throws(() => operation({}, hostile), /exact Framescaper V20 runtime profile/iu);
	assert.equal(reads, 0);
});

test('V20 command and runtime projections retain detached authored keyframes', () => {
	const project = authoredVideoProject();
	const persisted = videoKeyframes(project.clips[0]);
	const command = framescaperProjectForCommandConsumersV20(PROFILE, project);
	const runtime = framescaperProjectForRuntimeConsumersV20(PROFILE, project);
	assert.equal(isRuntimeProjectProjection(command), true);
	for (const projected of [command, runtime]) {
		const clips = projectClips(projected);
		assert.equal(projected.schemaVersion, 17);
		assert.deepEqual(videoKeyframes(clips[0]), persisted);
		assert.notStrictEqual(videoKeyframes(clips[0]), persisted);
		assert.equal(Object.isFrozen(videoKeyframes(clips[0])), true);
		assert.equal(clips.slice(1).some((clip) => Object.hasOwn(clip as object, 'videoKeyframes')), false);
	}
	assert.notStrictEqual(
		videoKeyframes(projectClips(command)[0]),
		videoKeyframes(projectClips(runtime)[0]),
	);
});

test('each nested V20 playback occurrence owns independently detached curves', () => {
	const project = nestedVideoProject();
	const persisted = videoKeyframes(project.clips[0]);
	const clips = projectClips(framescaperProjectForPlaybackFoundationV20(PROFILE, project));
	assert.equal(clips.length, 2);
	for (const clip of clips) {
		assert.deepEqual(videoKeyframes(clip), persisted);
		assert.notStrictEqual(videoKeyframes(clip), persisted);
	}
	assert.notStrictEqual(videoKeyframes(clips[0]), videoKeyframes(clips[1]));
	assert.notStrictEqual(videoKeyframes(clips[0]).curves, videoKeyframes(clips[1]).curves);
	assert.notStrictEqual(videoKeyframes(clips[0]).curves[0]?.curve, videoKeyframes(clips[1]).curves[0]?.curve);
});

function authoredVideoProject(): FramescaperProjectV20 {
	const project = createFramescaperProjectV20(PROFILE, projectOptions());
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(30);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	validateFramescaperProjectV20(PROFILE, project);
	return project;
}

function nestedVideoProject(): FramescaperProjectV20 {
	const project = createFramescaperProjectV20(PROFILE, {
		...projectOptions(),
		id: 'nested-v20',
		clips: [{
			kind: 'video', id: 'child-clip', sourceId: 'source', title: 'Child',
			sequenceId: 'child', sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrack({
			id: 'child-track', name: 'Child video', clipIds: ['child-clip'], locked: false,
		})],
		sequences: [
			{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'child', rate: { num: 30, den: 1 }, trackIds: ['child-track'] },
		],
		primarySequenceId: 'main',
		subsequences: [
			{
				id: 'nested-a', sequenceId: 'main', sourceSequenceId: 'child',
				sequenceStartFrame: 0, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 30,
			},
			{
				id: 'nested-b', sequenceId: 'main', sourceSequenceId: 'child',
				sequenceStartFrame: 60, sequenceFrameCount: 30,
				sourceInFrame: 0, sourceFrameCount: 30,
			},
		],
	});
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(30);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	validateFramescaperProjectV20(PROFILE, project);
	return project;
}

function projectOptions(): Record<string, unknown> {
	const rate = { num: 30, den: 1 };
	return {
		id: 'runtime-v20', title: 'Runtime V20', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'source', name: 'Source', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '34'.repeat(32), sampleFrameCount: 48_000,
			sourceFrameCount: 300, frameRate: rate, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Clip', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0,
			sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate, trackIds: ['track'] }],
		primarySequenceId: 'main',
	};
}

function videoKeyframes(value: unknown): Readonly<{ curves: readonly Readonly<{ curve: unknown }>[] }> {
	const descriptor = Object.getOwnPropertyDescriptor(value as object, 'videoKeyframes');
	assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
	return descriptor.value as Readonly<{ curves: readonly Readonly<{ curve: unknown }>[] }>;
}

function projectClips(value: { readonly clips?: readonly unknown[] }): readonly unknown[] {
	assert.ok(Array.isArray(value.clips));
	return value.clips;
}
