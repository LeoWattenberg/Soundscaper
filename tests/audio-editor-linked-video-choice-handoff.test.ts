/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { handoffLinkedVideoRelinkChoice } from '../src/common/editor/ui/workspace/linked-video-choice-handoff.ts';
import {
	FIRST_LOCATOR,
	changedVideoFile,
	createHarness,
	videoFile,
} from './helpers/project-bin-video-relink-harness.ts';

const PROJECT_SCOPE = Object.freeze({ projectId: 'project-bin-relink-project', revision: 1 });

test('attributed changed-video refusal releases the UI-owned candidate without relink side effects', async () => {
	const fixture = createHarness({
		missing: false,
		attributedSourceIds: ['video-solo-source'],
	});
	const file = changedVideoFile();
	const releases: unknown[] = [];
	let accepted = false;

	await assert.rejects(handoffLinkedVideoRelinkChoice({
		actions: { projectBin: {
			classifyLinkedVideoRelink: (clipId, candidate) => (
				fixture.service.classifyLinkedVideoRelink(clipId, candidate)
			),
			relinkLinkedVideo: (clipId, candidate, locator, options) => (
				fixture.service.relinkLinkedVideo(clipId, candidate, locator, options)
			),
		} },
	}, {
		chooseLinkedVideoOriginal: async () => ({ ...FIRST_LOCATOR, file }),
		releaseLinkedVideoOriginal: async (reference) => { releases.push(reference); return true; },
	}, 'bin-solo-video', PROJECT_SCOPE, (scope) => scope === PROJECT_SCOPE, () => {
		accepted = true;
	}), /import.*new media.*attribution/iu);

	assert.equal(accepted, false);
	assert.deepEqual(releases, [FIRST_LOCATOR]);
	assert.deepEqual(fixture.order, ['binding']);
	assert.deepEqual(fixture.releases, []);
	assert.deepEqual(fixture.relinks, []);
	assert.equal(fixture.publishCount, 0);
});

test('an asynchronously rejected video relink remains controller-owned and is released only once', async () => {
	const storageFailure = new Error('linked-video storage rejected the candidate');
	const fixture = createHarness({
		missing: false,
		relink: async () => { throw storageFailure; },
	});
	const file = videoFile();
	const uiReleases: unknown[] = [];

	await assert.rejects(handoffLinkedVideoRelinkChoice({
		actions: { projectBin: {
			classifyLinkedVideoRelink: (clipId, candidate) => (
				fixture.service.classifyLinkedVideoRelink(clipId, candidate)
			),
			relinkLinkedVideo: (clipId, candidate, locator, options) => (
				fixture.service.relinkLinkedVideo(clipId, candidate, locator, options)
			),
		} },
	}, {
		chooseLinkedVideoOriginal: async () => ({ ...FIRST_LOCATOR, file }),
		releaseLinkedVideoOriginal: async (reference) => { uiReleases.push(reference); return true; },
	}, 'bin-solo-video', PROJECT_SCOPE, (scope) => scope === PROJECT_SCOPE, () => {
		throw new Error('An exact-content candidate cannot enter confirmation.');
	}), (error) => error === storageFailure);

	assert.deepEqual(uiReleases, []);
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
	assert.equal(fixture.relinks.length, 1);
	assert.equal(fixture.publishCount, 0);
});
