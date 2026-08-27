/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createImportVideoFile,
} from '../src/common/editor/controller/source-import.ts';
import {
	createFixture,
	videoFile,
} from './helpers/audio-editor-source-import-fixture.ts';

function isSourceAddCommand(value: unknown): value is Readonly<{
	type: 'source/add';
	source: Record<string, unknown>;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const command = value as Readonly<Record<string, unknown>>;
	return command.type === 'source/add'
		&& Boolean(command.source)
		&& typeof command.source === 'object'
		&& !Array.isArray(command.source);
}

test('video import extracts linked audio and creates a new timeline lane pair', async () => {
	const fixture = createFixture();
	const result = await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'timeline',
		trackId: null,
		trackIndex: 3,
		timelineStartFrame: 12,
	});

	assert.equal(result.destination, 'timeline');
	assert.match(result.sourceId, /^video-source-/u);
	assert.match(result.audioSourceId, /^source-/u);
	assert.match(result.trackId, /^video-track-/u);
	const videoSource = fixture.addedSources.find(({ kind }) => kind === 'video');
	assert.ok(videoSource);
	assert.equal(videoSource.posterStorageKey, null);
	assert.equal(videoSource.thumbnailStorageKey, null);
	const audioSource = fixture.addedSources.find(({ kind }) => kind === 'audio');
	assert.match(String(audioSource?.contentSha256), /^[a-f0-9]{64}$/u);
	assert.equal(audioSource?.byteLength, 36);
	assert.equal(fixture.commits.length, 1);
	assert.equal(fixture.commits[0]?.command.commands.length, 6);
	const committedVideoSource = fixture.commits[0]?.command.commands
		.filter(isSourceAddCommand)
		.map(({ source }) => source)
		.find(({ kind }) => kind === 'video');
	assert.ok(committedVideoSource);
	assert.equal(committedVideoSource.posterStorageKey, null);
	assert.equal(committedVideoSource.thumbnailStorageKey, null);
	assert.deepEqual(fixture.derivatives.map(({ timestamp, type }) => [timestamp, type]), [
		[0, 'poster'], [1, 'thumbnail'], [2, 'thumbnail'],
	]);
	assert.equal(fixture.sourceBuffers.size, 1);
	assert.equal(fixture.sourcePeaks.size, 1);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('video import reuses both members of an existing lane group', async () => {
	const fixture = createFixture();
	fixture.setProject({
		id: 'project-import-video',
		tracks: [
			{ id: 'video-lane', type: 'video', laneGroupId: 'media' },
			{ id: 'audio-lane', type: 'audio', laneGroupId: 'media' },
		],
		sources: [],
	});
	fixture.options.decodeMode = 'fallback';
	const result = await createImportVideoFile(fixture.runtime)(videoFile('fallback.mov'), {
		destination: 'timeline', trackId: 'audio-lane', timelineStartFrame: 0,
	});

	assert.equal(result.trackId, 'video-lane');
	assert.equal(fixture.commits[0]?.command.commands.length, 4);
	assert.equal(fixture.calls.includes('writer-commit'), true);
});

test('project-bin video import tolerates missing audio and disposable preview failures', async () => {
	const fixture = createFixture();
	fixture.options.decodeMode = 'none';
	fixture.options.posterFails = true;
	fixture.options.thumbnailFailure = 1;
	const result = await createImportVideoFile(fixture.runtime)(videoFile(''), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.equal(result.destination, 'project-bin');
	assert.equal(result.audioSourceId, null);
	assert.equal(result.audioClipId, null);
	assert.equal(result.trackId, null);
	assert.equal(fixture.commits[0]?.command.commands.length, 2);
	assert.deepEqual(fixture.derivatives.map(({ timestamp }) => timestamp), [2]);
	assert.equal(fixture.calls.includes('warn-envelope'), true);
});

test('video import stops disposable filmstrip work after an encoded hard-cap refusal', async () => {
	const fixture = createFixture();
	fixture.options.thumbnailAdmissionFailure = 1;
	await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.deepEqual(
		fixture.calls.filter((call) => call.startsWith('capture:')),
		['capture:0:poster', 'capture:1:thumbnail'],
	);
	assert.deepEqual(fixture.derivatives.map(({ timestamp }) => timestamp), [0]);
});

test('video import skips all disposable captures after source-frame admission refuses the poster', async () => {
	const fixture = createFixture();
	fixture.options.posterSourceAdmissionFails = true;
	await createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
	});

	assert.deepEqual(
		fixture.calls.filter((call) => call.startsWith('capture:')),
		['capture:0:poster'],
	);
	assert.deepEqual(fixture.derivatives, []);
});

test('a selected ungrouped video lane causes a companion lane pair to be created', async () => {
	const fixture = createFixture();
	fixture.setProject({
		id: 'project-import-video', tracks: [{ id: 'video-only', type: 'video' }], sources: [],
	});
	const result = await createImportVideoFile(fixture.runtime)(videoFile('clip.webm'), {
		destination: 'timeline', trackId: 'video-only', timelineStartFrame: 4,
	});
	assert.match(result.trackId, /^video-track-/u);
	assert.equal(fixture.commits[0]?.command.commands.length, 6);
});

test('video import removes persisted media and audio when activation fails', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/activation failed/u,
	);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, ['video-source-1']);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.calls.includes('revoke:video-source-1'), true);
	assert.equal(fixture.calls.at(-1), 'dispose');
});

test('video import aborts a failed extracted-audio write and keeps cleanup idempotent', async () => {
	const fixture = createFixture();
	fixture.options.writerFails = true;
	await assert.rejects(
		() => createImportVideoFile(fixture.runtime)(videoFile()),
		/writer failed/u,
	);
	assert.equal(fixture.calls.includes('writer-abort'), true);
	assert.deepEqual(fixture.deletedSources, []);
	assert.deepEqual(fixture.deletedMedia, ['video-source-1']);
});

test('linked video import keeps local derivatives and extracted PCM while activating the exact binding', async () => {
	const fixture = createFixture();
	const locatorId = 'locator_0000000000000001';
	const file = videoFile();
	const result = await createImportVideoFile(fixture.runtime)(file, {
		destination: 'timeline',
		trackId: null,
		timelineStartFrame: 0,
		linkedVideoLocatorId: locatorId,
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});

	assert.equal(fixture.calls.some((call) => call.startsWith('write-media:')), false);
	assert.ok(fixture.calls.indexOf(`bind:project-import-video:${result.sourceId}:${locatorId}`)
		< fixture.calls.indexOf('save-linked-derivative'));
	assert.ok(fixture.calls.indexOf('save-linked-derivative')
		< fixture.calls.indexOf(`activate:${result.sourceId}`));
	assert.ok(fixture.calls.indexOf('assert-project:0')
		< fixture.calls.indexOf(`bind:project-import-video:${result.sourceId}:${locatorId}`));
	assert.ok(fixture.calls.lastIndexOf('assert-project:0')
		> fixture.calls.indexOf(`activate:${result.sourceId}`));
	assert.ok(fixture.calls.lastIndexOf('assert-project:0') < fixture.calls.indexOf('commit'));
	assert.equal(fixture.derivatives.length, 3);
	assert.equal(fixture.calls.includes('writer-commit'), true);
	assert.equal(fixture.sourceBuffers.size, 1);
	assert.equal(Object.hasOwn(result, 'linkedVideoOriginal'), false);
	assert.deepEqual(fixture.boundSnapshots, [file]);
	assert.deepEqual(fixture.releasedLocators, []);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.equal(fixture.commits.length, 1);
});

test('linked video import unlinks and releases its locator when activation fails', async () => {
	const fixture = createFixture();
	fixture.options.activateFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/activation failed/u,
	);

	assert.deepEqual(fixture.unlinkedBindings, [{
		projectId: 'project-import-video',
		sourceId: 'video-source-1',
		bindingToken: 'binding_token_0000000000001',
	}]);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import releases an unused locator after an early admission failure', async () => {
	const fixture = createFixture();
	fixture.options.preflightFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/preflight failed/u,
	);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.equal(fixture.calls.includes('dispose'), false);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import releases an unpublished locator when exact binding fails', async () => {
	const fixture = createFixture();
	fixture.options.bindFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/binding failed/u,
	);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import rolls back its binding and local media when commit refuses', async () => {
	const fixture = createFixture();
	fixture.options.commitFails = true;
	const locatorId = 'locator_0000000000000001';
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'timeline', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: locatorId, linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/commit failed/u,
	);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId, locatorRevision: 'revision_0000000000000001' }]);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.equal(fixture.commits.length, 0);
});

test('linked video import rolls back when the active project changes during activation', async () => {
	const fixture = createFixture();
	let continueActivation!: () => void;
	fixture.options.activationGate = new Promise<void>((resolve) => { continueActivation = resolve; });
	const operation = createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		linkedVideoLocatorId: 'locator_0000000000000001',
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});
	while (!fixture.calls.includes('activate:video-source-1')) await Promise.resolve();
	fixture.setProject({ id: 'replacement-project', tracks: [], sources: [] });
	continueActivation();

	await assert.rejects(operation, /project changed during video import/iu);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId: 'locator_0000000000000001', locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.deepEqual(fixture.getProject().sources, []);
});

test('linked video import rolls back when the active project generation changes under the same id', async () => {
	const fixture = createFixture();
	let continueActivation!: () => void;
	fixture.options.activationGate = new Promise<void>((resolve) => { continueActivation = resolve; });
	const operation = createImportVideoFile(fixture.runtime)(videoFile(), {
		destination: 'project-bin', trackId: null, timelineStartFrame: 0,
		linkedVideoLocatorId: 'locator_0000000000000001',
		linkedVideoLocatorRevision: 'revision_0000000000000001',
	});
	while (!fixture.calls.includes('activate:video-source-1')) await Promise.resolve();
	fixture.setProject({ id: 'project-import-video', tracks: [], sources: [] });
	continueActivation();

	await assert.rejects(operation, /project changed during video import/iu);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.unlinkedBindings.length, 1);
	assert.deepEqual(fixture.releasedLocators, [{ locatorId: 'locator_0000000000000001', locatorRevision: 'revision_0000000000000001' }]);
	assert.deepEqual(fixture.deletedSources, ['source-1']);
	assert.deepEqual(fixture.deletedMedia, []);
	assert.deepEqual(fixture.getProject().sources, []);
});

test('a post-mutation commit failure retains resources for the landed canonical source', async () => {
	const fixture = createFixture();
	fixture.options.commitMutatesThenFails = true;
	await assert.rejects(
		createImportVideoFile(fixture.runtime)(videoFile(), {
			destination: 'project-bin', trackId: null, timelineStartFrame: 0,
			linkedVideoLocatorId: 'locator_0000000000000001',
			linkedVideoLocatorRevision: 'revision_0000000000000001',
		}),
		/post-commit publication failed/u,
	);
	assert.equal(fixture.getProject().sources.some(({ id }) => id === 'video-source-1'), true);
	assert.deepEqual(fixture.unlinkedBindings, []);
	assert.deepEqual(fixture.releasedLocators, []);
	assert.deepEqual(fixture.deletedSources, []);
	assert.deepEqual(fixture.deletedMedia, []);
});
