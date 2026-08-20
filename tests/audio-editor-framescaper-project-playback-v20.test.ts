/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	createFramescaperPlaybackProjectServiceV20,
} from '../src/framescaper/editor-project-playback-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V20 playback authenticates authority before observing options', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(
		() => createFramescaperPlaybackProjectServiceV20({}, options),
		/exact Framescaper V20/iu,
	);
	assert.equal(reads, 0);
});

test('V20 playback preserves detached keyframes and reports dormant capability', () => {
	const project = projectFixture();
	const service = createFramescaperPlaybackProjectServiceV20(PROFILE);
	assert.ok(service.projectForActivationAdmission);
	const admission = service.projectForActivationAdmission(project);
	assert.equal(admission.project, project);
	assert.equal(admission.featureRequirementsReport?.compatible, false);
	assert.equal(admission.featureRequirementsReport?.items.at(-1)?.availability, 'unavailable');
	const projection = service.projectForPlayback(project);
	assert.equal((projection.project as { schemaVersion: number }).schemaVersion, 17);
	const clip = ((projection.project as { clips?: readonly Record<string, unknown>[] }).clips ?? [])[0]!;
	assert.deepEqual(clip.videoKeyframes, project.clips[0]!.videoKeyframes);
	assert.notStrictEqual(clip.videoKeyframes, project.clips[0]!.videoKeyframes);
	assert.equal(projection.featureRequirementsReport?.items.at(-1)?.availability, 'unavailable');
	assert.deepEqual(projection.requiredVideoSourceIds, []);
});

test('V20 playback leaves prior and future schema documents opaque', () => {
	const service = createFramescaperPlaybackProjectServiceV20(PROFILE);
	for (const project of [
		{ schemaVersion: 19, marker: 'prior' },
		{ schemaVersion: 21, marker: 'future' },
	]) {
		const projection = service.projectForPlayback(project);
		assert.equal(projection.project, project);
		assert.equal(projection.featureRequirementsReport, null);
	}
});

function projectFixture(): ReturnType<typeof createFramescaperProjectV20> {
	const project = createFramescaperProjectV20(PROFILE, {
		id: 'playback-v20', title: 'Playback V20', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'source', name: 'Video', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Video', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0,
			sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(30);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	validateFramescaperProjectV20(PROFILE, project);
	return project;
}
