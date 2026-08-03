/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import {
	createProjectBinLinkedVideoRelinkService,
	type ProjectBinLinkedVideoRelinkBinding,
	type ProjectBinLinkedVideoRelinkDependencies,
	type ProjectBinLinkedVideoRelinkLocator,
} from '../src/common/editor/controller/project-bin-linked-video-relink-service.ts';

const OLD_LOCATOR = Object.freeze({
	locatorId: 'locator_relink_original_0001',
	locatorRevision: 'revision_relink_original_01',
});
const FIRST_LOCATOR = Object.freeze({
	locatorId: 'locator_relink_selected_0001',
	locatorRevision: 'revision_relink_selected_01',
});
const SECOND_LOCATOR = Object.freeze({
	locatorId: 'locator_relink_selected_0002',
	locatorRevision: 'revision_relink_selected_02',
});
const OLD_BINDING = Object.freeze({
	...OLD_LOCATOR,
	bindingToken: 'binding_relink_original_0001',
});

test('relink fences the stale preview and visual before publishing an available compound video', async () => {
	const fixture = createHarness();
	const file = new File(['same video'], 'selected.mp4', { type: 'video/mp4' });
	const projectBefore = JSON.stringify(fixture.project);

	assert.equal(await fixture.service.relinkLinkedVideo('bin-audio', file, FIRST_LOCATOR), 'video-source');

	assert.deepEqual(fixture.order, ['binding', 'preview', 'revoke', 'relink', 'activate', 'publish']);
	assert.equal(fixture.relinks.length, 1);
	const relink = fixture.relinks[0];
	assert.equal(relink?.projectId, fixture.project.id);
	assert.equal(relink?.source, fixture.project.sources[1]);
	assert.equal(relink?.locatorId, FIRST_LOCATOR.locatorId);
	assert.equal(relink?.options.expectedBindingToken, OLD_BINDING.bindingToken);
	assert.equal(relink?.options.expectedLocatorRevision, FIRST_LOCATOR.locatorRevision);
	assert.equal(relink?.options.expectedSnapshot, file);
	assert.ok(relink?.options.signal instanceof AbortSignal);
	assert.equal(relink?.options.signal.aborted, false);
	assert.deepEqual(fixture.releases, []);
	assert.equal(fixture.missingSourceIds.has('video-source'), false);
	assert.equal(fixture.publishCount, 1);
	assert.equal(JSON.stringify(fixture.project), projectBefore, 'relink must not edit the canonical project');
});

test('wrong, stale, and cancelled pre-publication relinks clean only a new candidate locator', async () => {
	const blocked = createHarness({ editingBlocked: () => true });
	await assert.rejects(
		blocked.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		/editing is blocked/iu,
	);
	assert.deepEqual(blocked.releases, [FIRST_LOCATOR]);
	assert.deepEqual(blocked.order, ['release']);

	const wrong = createHarness({ missing: false });
	await assert.rejects(
		wrong.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		/currently unavailable/iu,
	);
	assert.deepEqual(wrong.releases, [FIRST_LOCATOR]);
	assert.deepEqual(wrong.order, ['binding', 'release']);

	const oldReference = createHarness({ missing: false });
	await assert.rejects(
		oldReference.service.relinkLinkedVideo('bin-video', videoFile(), OLD_LOCATOR),
		/currently unavailable/iu,
	);
	assert.deepEqual(oldReference.releases, [], 'the live old locator is never candidate cleanup');

	const stale = createHarness({
		relink: async () => { throw new Error('The linked video binding changed before publication.'); },
	});
	await assert.rejects(
		stale.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		/binding changed/iu,
	);
	assert.deepEqual(stale.releases, [FIRST_LOCATOR]);
	assert.equal(stale.missingSourceIds.has('video-source'), true);
	assert.equal(stale.publishCount, 0);

	const started = deferred<void>();
	const cancelled = createHarness({
		relink: (_projectId, _source, _locatorId, options) => new Promise((_resolve, reject) => {
			started.resolve();
			options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
		}),
	});
	const pending = cancelled.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR);
	await started.promise;
	const disposal = cancelled.service.dispose();
	await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
	await disposal;
	assert.deepEqual(cancelled.releases, [FIRST_LOCATOR]);
	assert.equal(cancelled.missingSourceIds.has('video-source'), true);
});

test('relink rechecks writable admission before side effects and at storage publication', async () => {
	const bindingStarted = deferred<void>();
	const allowBinding = deferred<void>();
	let editingBlocked = false;
	const beforeEffects = createHarness({
		editingBlocked: () => editingBlocked,
		getBinding: async () => {
			bindingStarted.resolve();
			await allowBinding.promise;
			return OLD_BINDING;
		},
	});
	const admission = beforeEffects.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR);
	await bindingStarted.promise;
	editingBlocked = true;
	allowBinding.resolve();
	await assert.rejects(admission, /editing is blocked/iu);
	assert.deepEqual(beforeEffects.order, ['binding', 'release']);

	const relinkStarted = deferred<void>();
	const allowRelink = deferred<void>();
	editingBlocked = false;
	const beforePublication = createHarness({
		editingBlocked: () => editingBlocked,
		relink: async (_projectId, _source, _locatorId, options) => {
			relinkStarted.resolve();
			await allowRelink.promise;
			options.assertCanPublish();
			return replacementBinding(FIRST_LOCATOR);
		},
	});
	const publication = beforePublication.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR);
	await relinkStarted.promise;
	editingBlocked = true;
	allowRelink.resolve();
	await assert.rejects(publication, /editing is blocked/iu);
	assert.deepEqual(beforePublication.releases, [FIRST_LOCATOR]);
	assert.equal(beforePublication.missingSourceIds.has('video-source'), true);
	assert.equal(beforePublication.publishCount, 0);
});

test('dispose reports a failed candidate cleanup after draining the operation', async () => {
	const fixture = createHarness({ missing: false, release: () => false });
	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		AggregateError,
	);
	await assert.rejects(fixture.service.dispose(), /candidate cleanup failed/iu);
});

test('dispose waits for cancelled candidate cleanup to settle', async () => {
	const relinkStarted = deferred<void>();
	const cleanupStarted = deferred<void>();
	const allowCleanup = deferred<void>();
	const fixture = createHarness({
		relink: (_projectId, _source, _locatorId, options) => new Promise((_resolve, reject) => {
			relinkStarted.resolve();
			options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
		}),
		release: async () => {
			cleanupStarted.resolve();
			await allowCleanup.promise;
			return true;
		},
	});
	const pending = fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR);
	await relinkStarted.promise;
	let disposed = false;
	const disposal = fixture.service.dispose().then(() => { disposed = true; });
	await cleanupStarted.promise;
	assert.equal(disposed, false);
	allowCleanup.resolve();
	await disposal;
	await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
});

test('activation failure retains the committed candidate binding and the missing state', async () => {
	const activationFailure = new Error('selected video could not activate');
	const fixture = createHarness({
		activate: async () => { throw activationFailure; },
	});

	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		(error) => error === activationFailure,
	);

	assert.deepEqual(fixture.order, ['binding', 'preview', 'revoke', 'relink', 'activate']);
	assert.deepEqual(fixture.releases, [], 'a published replacement remains owned after activation fails');
	assert.equal(fixture.missingSourceIds.has('video-source'), true);
	assert.equal(fixture.publishCount, 0);
});

test('a newer relink supersedes the old lifetime task and cleans only its unpublished candidate', async () => {
	const firstStarted = deferred<void>();
	const signals: AbortSignal[] = [];
	const fixture = createHarness({
		relink: (_projectId, _source, locatorId, options) => {
			signals.push(options.signal);
			if (locatorId !== FIRST_LOCATOR.locatorId) return replacementBinding(SECOND_LOCATOR);
			return new Promise((_resolve, reject) => {
				firstStarted.resolve();
				options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
			});
		},
	});
	const first = fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR);
	await firstStarted.promise;
	const second = fixture.service.relinkLinkedVideo('bin-audio', videoFile(), SECOND_LOCATOR);

	await assert.rejects(first, (error) => error instanceof DOMException && error.name === 'AbortError');
	assert.equal(await second, 'video-source');
	assert.equal(signals[0]?.aborted, true);
	assert.equal(signals[1]?.aborted, false);
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
	assert.equal(fixture.missingSourceIds.has('video-source'), false);
	assert.equal(fixture.publishCount, 1);
});

interface HarnessOptions {
	readonly missing?: boolean;
	readonly editingBlocked?: () => boolean;
	readonly activate?: ProjectBinLinkedVideoRelinkDependencies['activateVideoSource'];
	readonly getBinding?: ProjectBinLinkedVideoRelinkDependencies['getLinkedVideoOriginalBinding'];
	readonly relink?: ProjectBinLinkedVideoRelinkDependencies['relinkLinkedVideoOriginal'];
	readonly release?: ProjectBinLinkedVideoRelinkDependencies['releaseLinkedVideoOriginalLocator'];
}

function createHarness(options: HarnessOptions = {}) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const project = projectFixture();
	projectGeneration.activate(project.id);
	const missingSourceIds = new Set(options.missing === false ? [] : ['video-source']);
	const order: string[] = [];
	const releases: ProjectBinLinkedVideoRelinkLocator[] = [];
	const relinks: Array<Readonly<{
		projectId: string;
		source: unknown;
		locatorId: string;
		options: Readonly<{
			expectedBindingToken: string;
			expectedLocatorRevision: string;
			expectedSnapshot: Blob;
			assertCanPublish(): void;
			signal: AbortSignal;
		}>;
	}>> = [];
	let publishCount = 0;
	const dependencies: ProjectBinLinkedVideoRelinkDependencies = {
		lifetime,
		missingSourceIds,
		editingBlocked: options.editingBlocked ?? (() => false),
		getProject: () => project,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		async getLinkedVideoOriginalBinding() {
			order.push('binding');
			return options.getBinding ? options.getBinding(project.id, 'video-source') : OLD_BINDING;
		},
		async stopProjectBinPreview() { order.push('preview'); },
		async revokeVideoVisual(sourceId) {
			assert.equal(sourceId, 'video-source');
			order.push('revoke');
		},
		async relinkLinkedVideoOriginal(projectId, source, locatorId, relinkOptions) {
			order.push('relink');
			relinks.push({ projectId, source, locatorId, options: relinkOptions });
			if (!options.relink) relinkOptions.assertCanPublish();
			return options.relink
				? options.relink(projectId, source, locatorId, relinkOptions)
				: replacementBinding({ locatorId, locatorRevision: relinkOptions.expectedLocatorRevision });
		},
		async releaseLinkedVideoOriginalLocator(reference) {
			order.push('release');
			releases.push(reference);
			return options.release ? options.release(reference) : true;
		},
		async activateVideoSource(source, activationOptions) {
			order.push('activate');
			if (options.activate) return options.activate(source, activationOptions);
			return Object.freeze({ mediaUrl: 'soundscaper-app://linked-video' });
		},
		publish() {
			order.push('publish');
			publishCount += 1;
		},
	};
	const service = createProjectBinLinkedVideoRelinkService(dependencies);
	return {
		service,
		project,
		missingSourceIds,
		order,
		releases,
		relinks,
		get publishCount() { return publishCount; },
	};
}

function projectFixture() {
	return Object.freeze({
		schemaVersion: 9,
		id: 'project-bin-relink-project',
		sampleRate: 48_000,
		sources: Object.freeze([
			Object.freeze({ id: 'audio-source', kind: 'audio' as const, frameCount: 48_000 }),
			Object.freeze({
				id: 'video-source', kind: 'video' as const, storageKey: 'video-storage',
				mimeType: 'video/mp4', frameCount: 48_000, sampleRate: 48_000,
				width: 1_920, height: 1_080, frameRate: 30,
				videoCodec: 'h264', audioCodec: null, hasAudio: false,
			}),
		]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
		projectBin: Object.freeze({ clips: Object.freeze([
			Object.freeze({
				id: 'bin-audio', sourceId: 'audio-source', kind: 'audio' as const, binItemId: 'compound-item',
			}),
			Object.freeze({
				id: 'bin-video', sourceId: 'video-source', kind: 'video' as const, binItemId: 'compound-item',
			}),
		]) }),
	});
}

function replacementBinding(locator: ProjectBinLinkedVideoRelinkLocator): ProjectBinLinkedVideoRelinkBinding {
	return Object.freeze({ ...locator, bindingToken: 'binding_relink_selected_0001' });
}

function videoFile(): File {
	return new File(['same video'], 'selected.mp4', { type: 'video/mp4' });
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
