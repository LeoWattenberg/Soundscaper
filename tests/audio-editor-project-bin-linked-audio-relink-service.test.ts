/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import {
	createProjectBinLinkedAudioRelinkService,
	PROJECT_BIN_LINKED_AUDIO_RELINK_TASK,
	type ProjectBinLinkedAudioRelinkBinding,
	type ProjectBinLinkedAudioRelinkDependencies,
	type ProjectBinLinkedAudioRelinkLocator,
} from '../src/common/editor/controller/project-bin-linked-audio-relink-service.ts';
import { PROJECT_BIN_LINKED_VIDEO_RELINK_TASK } from '../src/common/editor/controller/project-bin-linked-video-relink-service.ts';

const OLD_LOCATOR = Object.freeze({
	locatorId: 'locator_audio_relink_original_01',
	locatorRevision: 'revision_audio_relink_original_01',
});
const FIRST_LOCATOR = Object.freeze({
	locatorId: 'locator_audio_relink_selected_01',
	locatorRevision: 'revision_audio_relink_selected_01',
});
const SECOND_LOCATOR = Object.freeze({
	locatorId: 'locator_audio_relink_selected_02',
	locatorRevision: 'revision_audio_relink_selected_02',
});
const OLD_BINDING = Object.freeze({
	kind: 'audio' as const,
	...OLD_LOCATOR,
	bindingToken: 'binding_audio_relink_original_01',
});

test('linked audio and video relinks share the existing replaceable task identity', () => {
	assert.equal(PROJECT_BIN_LINKED_AUDIO_RELINK_TASK, PROJECT_BIN_LINKED_VIDEO_RELINK_TASK);
	assert.equal(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK, 'project-bin-linked-video-relink');
});

test('linked-audio eligibility is binding-backed and project-generation fenced', async (context) => {
	await context.test('an audio binding is eligible without missing-source state', async () => {
		const fixture = createHarness({ missing: false });
		assert.equal(await fixture.service.canRelinkLinkedAudio('bin-video'), true);
		assert.deepEqual(fixture.order, ['binding']);
	});

	await context.test('null, video, and ambiguous bindings are ineligible', async () => {
		const unbound = createHarness({ getBinding: async () => null });
		assert.equal(await unbound.service.canRelinkLinkedAudio('bin-audio'), false);
		const video = createHarness({
			getBinding: async () => ({
				kind: 'video', ...OLD_LOCATOR, bindingToken: OLD_BINDING.bindingToken,
			}),
		});
		assert.equal(await video.service.canRelinkLinkedAudio('bin-audio'), false);
		const ambiguous = createHarness({ project: projectFixture(true) });
		assert.equal(await ambiguous.service.canRelinkLinkedAudio('bin-audio'), false);
	});

	await context.test('a stale binding answer cannot qualify a switched project', async () => {
		const bindingStarted = deferred<void>();
		const allowBinding = deferred<void>();
		const fixture = createHarness({
			getBinding: async () => {
				bindingStarted.resolve();
				await allowBinding.promise;
				return OLD_BINDING;
			},
		});
		const eligibility = fixture.service.canRelinkLinkedAudio('bin-audio');
		await bindingStarted.promise;
		fixture.invalidateProject();
		allowBinding.resolve();
		await assert.rejects(eligibility, /project changed/iu);
	});

	await context.test('a disposed service cannot publish a late eligibility result', async () => {
		const fixture = createHarness({ missing: false });
		await fixture.service.dispose();
		await assert.rejects(
			fixture.service.canRelinkLinkedAudio('bin-audio'),
			(error) => error instanceof DOMException && error.name === 'AbortError',
		);
		assert.deepEqual(fixture.order, []);
	});
});

test('binding-backed relink quiesces consumers, publishes exact content, and activates before availability', async () => {
	const fixture = createHarness({ missing: false });
	const file = new Blob(['same linked PCM'], { type: 'audio/wav' });
	const projectBefore = JSON.stringify(fixture.project);
	assert.equal(await fixture.service.relinkLinkedAudio('bin-video', file, FIRST_LOCATOR), 'audio-source');
	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'relink',
		'invalidate', 'metadata', 'activate', 'publish',
	]);
	assert.equal(fixture.relinks.length, 1);
	const relink = fixture.relinks[0];
	assert.equal(relink?.projectId, fixture.project.id);
	assert.equal(relink?.source, fixture.project.sources[0]);
	assert.equal(relink?.locatorId, FIRST_LOCATOR.locatorId);
	assert.equal(relink?.options.expectedBindingToken, OLD_BINDING.bindingToken);
	assert.equal(relink?.options.expectedLocatorRevision, FIRST_LOCATOR.locatorRevision);
	assert.equal(relink?.options.expectedSnapshot, file);
	assert.ok(relink?.options.signal instanceof AbortSignal);
	assert.equal(relink?.options.signal.aborted, false);
	assert.deepEqual(fixture.previewOptions, [{ dispose: true }]);
	assert.deepEqual(fixture.invalidatedSourceIds, ['audio-source']);
	assert.deepEqual(fixture.metadataKeys, ['audio-storage']);
	assert.deepEqual(fixture.releases, []);
	assert.equal(fixture.missingSourceIds.has('audio-source'), false);
	assert.equal(fixture.publishCount, 1);
	assert.equal(JSON.stringify(fixture.project), projectBefore, 'relink must not edit the project document');
});

test('eligibility requires one compound audio source with an exact audio binding, not missing state', async (context) => {
	await context.test('an unbound missing source is rejected before runtime side effects', async () => {
		const fixture = createHarness({ missing: true, getBinding: async () => null });
		await assert.rejects(
			fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
			/not currently bound to a linked audio original/iu,
		);
		assert.deepEqual(fixture.order, ['binding', 'release']);
		assert.deepEqual(fixture.releases, [{ kind: 'audio', ...FIRST_LOCATOR }]);
	});

	await context.test('a generic video binding cannot admit an audio relink', async () => {
		const fixture = createHarness({
			getBinding: async () => ({
				kind: 'video', ...OLD_LOCATOR, bindingToken: OLD_BINDING.bindingToken,
			}),
		});
		await assert.rejects(
			fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
			/not currently bound to a linked audio original/iu,
		);
		assert.deepEqual(fixture.order, ['binding', 'release']);
	});

	await context.test('a compound item with multiple audio sources is ambiguous', async () => {
		const fixture = createHarness({ project: projectFixture(true) });
		await assert.rejects(
			fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
			/exactly one audio source/iu,
		);
		assert.deepEqual(fixture.order, ['release']);
	});
	await context.test('a duplicated-project target is rejected and cleaned before binding lookup', async () => {
		const fixture = createHarness();
		const currentRelink = fixture.startSharedRelink();
		await assert.rejects(fixture.rawService.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR,
			{ projectId: 'project-duplicate', projectRevision: 4 }), /project target changed/iu);
		currentRelink.assertCurrent(); currentRelink.finish();
		assert.deepEqual(fixture.order, ['release']);
	});
});

test('a current prepublication failure restores the old runtime and releases only a new candidate', async () => {
	const storageFailure = new Error('candidate content changed');
	const fixture = createHarness({ missing: false, relink: async () => { throw storageFailure; } });
	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		(error) => error === storageFailure,
	);
	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'relink',
		'metadata', 'activate', 'release',
	]);
	assert.deepEqual(fixture.releases, [{ kind: 'audio', ...FIRST_LOCATOR }]);
	assert.deepEqual(fixture.metadataKeys, ['audio-storage']);
	assert.equal(fixture.missingSourceIds.has('audio-source'), false);
	assert.equal(fixture.publishCount, 0);

	const previouslyMissing = createHarness({ relink: async () => { throw storageFailure; } });
	await assert.rejects(
		previouslyMissing.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		(error) => error === storageFailure,
	);
	assert.equal(previouslyMissing.missingSourceIds.has('audio-source'), false);
	assert.equal(previouslyMissing.publishCount, 1, 'successful recovery publishes newly available state');

	const oldReference = createHarness({ missing: false, relink: async () => { throw storageFailure; } });
	await assert.rejects(
		oldReference.service.relinkLinkedAudio('bin-audio', audioFile(), OLD_LOCATOR),
		(error) => error === storageFailure,
	);
	assert.deepEqual(oldReference.releases, [], 'the live old locator is never candidate cleanup');
});

test('publication admission rechecks writable project ownership after quiescence', async () => {
	let blocked = false;
	const fixture = createHarness({
		missing: false,
		editingBlocked: () => blocked,
		relink: async (_projectId, _source, _locatorId, options) => {
			blocked = true;
			options.assertCanPublish();
			return replacementBinding(FIRST_LOCATOR);
		},
	});
	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		/editing is blocked/iu,
	);

	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'relink',
		'metadata', 'activate', 'release',
	]);
	assert.equal(fixture.publishCount, 0);
});

test('retirement failure is prepublication and recovers a possibly detached provider', async () => {
	const retirementFailure = new Error('provider drain failed');
	const fixture = createHarness({ missing: false, retire: async () => { throw retirementFailure; } });

	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		(error) => error === retirementFailure,
	);

	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'metadata', 'activate', 'release',
	]);
	assert.deepEqual(fixture.relinks, []);
	assert.deepEqual(fixture.releases, [{ kind: 'audio', ...FIRST_LOCATOR }]);
});

test('an unrelated prepublication cancellation restores the old source runtime', async () => {
	const storageStarted = deferred<void>();
	const fixture = createHarness({ missing: false, relink: (_projectId, _source, _locatorId, options) => new Promise((_resolve, reject) => {
		storageStarted.resolve();
		options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
	}) });
	const relink = fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR);
	await storageStarted.promise;
	fixture.supersedeRelink();
	await assert.rejects(relink, (error) => error instanceof DOMException && error.name === 'AbortError');
	assert.deepEqual(fixture.order, ['binding', 'timeline', 'preview', 'retire', 'relink', 'metadata', 'activate', 'release']);
	assert.deepEqual(fixture.releases, [{ kind: 'audio', ...FIRST_LOCATOR }]);
	assert.equal(fixture.missingSourceIds.has('audio-source'), false);
	assert.equal(fixture.publishCount, 0);
});

test('stale prepublication recovery cannot activate over a superseding relink', async () => {
	const metadataStarted = deferred<void>(), finishMetadata = deferred<void>();
	const firstFailure = new Error('first candidate rejected');
	let relinks = 0, metadataReads = 0, activations = 0;
	const fixture = createHarness({
		relink: (_projectId, _source, _locatorId, options) => {
			if (++relinks === 1) throw firstFailure;
			options.assertCanPublish(); return replacementBinding(SECOND_LOCATOR);
		},
		metadata: async () => {
			if (++metadataReads === 1) { metadataStarted.resolve(); await finishMetadata.promise; }
			return Object.freeze({ chunkCount: 1 });
		},
		activate: () => { activations += 1; return Object.freeze({ levels: [] }); },
	});
	const first = fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR);
	await metadataStarted.promise;
	assert.equal(await fixture.service.relinkLinkedAudio('bin-audio', audioFile(), SECOND_LOCATOR), 'audio-source');
	finishMetadata.resolve();
	await assert.rejects(first, (error) => error === firstFailure);
	assert.equal(activations, 1);
});

test('a failed current-task recovery marks the old source unavailable without hiding cleanup errors', async () => {
	const relinkFailure = new Error('candidate rejected');
	const recoveryFailure = new Error('old locator is unavailable');
	const fixture = createHarness({
		relink: async () => { throw relinkFailure; },
		activate: async () => { throw recoveryFailure; },
	});

	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		(error) => error instanceof AggregateError
			&& error.errors[0] === relinkFailure
			&& error.errors.includes(recoveryFailure),
	);

	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'relink',
		'metadata', 'activate', 'retire', 'invalidate', 'publish', 'release',
	]);
	assert.deepEqual(fixture.invalidatedSourceIds, ['audio-source']);
	assert.equal(fixture.missingSourceIds.has('audio-source'), true);
	assert.equal(fixture.publishCount, 1);
	await assert.rejects(fixture.service.dispose(), /cleanup failed during disposal/iu);
});

test('postpublication activation failure retains the candidate binding and publishes missing state', async () => {
	const activationFailure = new Error('selected linked PCM could not activate');
	const fixture = createHarness({ missing: false, activate: async () => { throw activationFailure; } });
	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		(error) => error === activationFailure,
	);
	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'relink',
		'invalidate', 'metadata', 'activate', 'retire', 'invalidate', 'publish',
	]);
	assert.deepEqual(fixture.invalidatedSourceIds, ['audio-source', 'audio-source']);
	assert.deepEqual(fixture.releases, [], 'a published replacement remains owned');
	assert.equal(fixture.missingSourceIds.has('audio-source'), true);
	assert.equal(fixture.publishCount, 1);
});

test('an unrelated relink cancellation after storage publication reports the source unavailable', async () => {
	const invalidationStarted = deferred<void>();
	const finishInvalidation = deferred<void>();
	const fixture = createHarness({ missing: false, invalidate: async () => {
		invalidationStarted.resolve();
		await finishInvalidation.promise;
	} });
	const relink = fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR);
	await invalidationStarted.promise;
	fixture.supersedeRelink();
	finishInvalidation.resolve();
	await assert.rejects(relink, (error) => error instanceof DOMException && error.name === 'AbortError');
	assert.deepEqual(fixture.order, ['binding', 'timeline', 'preview', 'retire', 'relink', 'invalidate', 'publish']);
	assert.equal(fixture.missingSourceIds.has('audio-source'), true);
	assert.equal(fixture.publishCount, 1);
});

test('an owned activation that finishes after cancellation publishes availability', async () => {
	const activationStarted = deferred<void>();
	const finishActivation = deferred<unknown>();
	const fixture = createHarness({ activate: () => {
		activationStarted.resolve();
		return finishActivation.promise;
	} });
	const relink = fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR);
	await activationStarted.promise;
	fixture.supersedeRelink();
	finishActivation.resolve(Object.freeze({ levels: [] }));
	await assert.rejects(relink, (error) => error instanceof DOMException && error.name === 'AbortError');
	assert.equal(fixture.missingSourceIds.has('audio-source'), false);
	assert.equal(fixture.publishCount, 1);
});

test('postpublication activation rejects invalid metadata before installing a provider', async () => {
	const fixture = createHarness({ missing: false, metadata: async () => null });

	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		/no stored metadata/iu,
	);

	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'retire', 'relink',
		'invalidate', 'metadata', 'publish',
	]);
	assert.equal(fixture.missingSourceIds.has('audio-source'), true);
	assert.deepEqual(fixture.releases, []);
});

test('postpublication provider cleanup failures are preserved and reported by disposal', async () => {
	const activationFailure = new Error('peak generation failed');
	const cleanupFailure = new Error('partial provider drain failed');
	let retirements = 0;
	const fixture = createHarness({
		missing: false,
		activate: async () => { throw activationFailure; },
		retire: async () => {
			retirements += 1;
			if (retirements === 2) throw cleanupFailure;
		},
	});

	await assert.rejects(
		fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR),
		(error) => error instanceof AggregateError
			&& error.errors[0] === activationFailure
			&& error.errors.includes(cleanupFailure),
	);
	assert.equal(fixture.missingSourceIds.has('audio-source'), true);
	assert.deepEqual(fixture.releases, []);
	await assert.rejects(fixture.service.dispose(), /cleanup failed during disposal/iu);
});

test('a stale late activation failure cannot retire the superseding relink provider', async () => {
	const firstActivationStarted = deferred<void>();
	const firstActivation = deferred<unknown>();
	const lateFailure = new Error('superseded activation failed late');
	let activations = 0;
	const fixture = createHarness({
		missing: false,
		activate: () => {
			activations += 1;
			if (activations !== 1) return Object.freeze({ levels: [] });
			firstActivationStarted.resolve();
			return firstActivation.promise;
		},
	});
	const first = fixture.service.relinkLinkedAudio('bin-audio', audioFile(), FIRST_LOCATOR);
	await firstActivationStarted.promise;

	assert.equal(
		await fixture.service.relinkLinkedAudio('bin-audio', audioFile(), SECOND_LOCATOR),
		'audio-source',
	);
	firstActivation.reject(lateFailure);
	await assert.rejects(first, (error) => error === lateFailure);

	assert.equal(fixture.order.filter((entry) => entry === 'retire').length, 2);
	assert.deepEqual(fixture.releases, []);
	assert.equal(fixture.missingSourceIds.has('audio-source'), false);
	assert.equal(fixture.publishCount, 1);
});

test('disposal cancels a prepublication relink, skips stale recovery, and waits for candidate release', async () => {
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
	const pending = fixture.service.relinkLinkedAudio('bin-audio', audioFile(), SECOND_LOCATOR);
	await relinkStarted.promise;
	let disposed = false;
	const disposal = fixture.service.dispose().then(() => { disposed = true; });
	await cleanupStarted.promise;

	assert.equal(disposed, false);
	assert.doesNotMatch(fixture.order.join(','), /metadata|activate/u, 'a stale task must not restore its runtime');
	allowCleanup.resolve();
	await disposal;
	await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
	assert.deepEqual(fixture.releases, [{ kind: 'audio', ...SECOND_LOCATOR }]);
});

interface HarnessOptions {
	readonly missing?: boolean;
	readonly project?: ReturnType<typeof projectFixture>;
	readonly editingBlocked?: () => boolean;
	readonly getBinding?: ProjectBinLinkedAudioRelinkDependencies['getLinkedOriginalBinding'];
	readonly relink?: ProjectBinLinkedAudioRelinkDependencies['relinkLinkedAudioOriginal'];
	readonly release?: ProjectBinLinkedAudioRelinkDependencies['releaseLinkedOriginalLocator'];
	readonly retire?: ProjectBinLinkedAudioRelinkDependencies['retireSourceChunkProvider'];
	readonly invalidate?: ProjectBinLinkedAudioRelinkDependencies['invalidateSourceRuntime'];
	readonly metadata?: ProjectBinLinkedAudioRelinkDependencies['getSourceMetadata'];
	readonly activate?: ProjectBinLinkedAudioRelinkDependencies['activateStoredSource'];
}

function createHarness(options: HarnessOptions = {}) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const project = options.project ?? projectFixture();
	projectGeneration.activate(project.id);
	const missingSourceIds = new Set(options.missing === false ? [] : ['audio-source']);
	const order: string[] = [];
	const releases: Array<Readonly<{ kind: 'audio' } & ProjectBinLinkedAudioRelinkLocator>> = [];
	const relinks: Array<Readonly<{
		projectId: string;
		source: unknown;
		locatorId: string;
		options: Parameters<ProjectBinLinkedAudioRelinkDependencies['relinkLinkedAudioOriginal']>[3];
	}>> = [];
	const previewOptions: Array<Readonly<{ dispose: true }>> = [];
	const invalidatedSourceIds: string[] = [];
	const metadataKeys: string[] = [];
	let publishCount = 0;
	const dependencies: ProjectBinLinkedAudioRelinkDependencies = {
		lifetime,
		missingSourceIds,
		editingBlocked: options.editingBlocked ?? (() => false),
		getProject: () => project,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		async getLinkedOriginalBinding(projectId, sourceId) {
			order.push('binding');
			return options.getBinding
				? options.getBinding(projectId, sourceId)
				: OLD_BINDING;
		},
		async stopTimelinePlayback() { order.push('timeline'); },
		async stopProjectBinPreview(stopOptions) {
			order.push('preview');
			previewOptions.push(stopOptions);
		},
		async retireSourceChunkProvider(sourceId) {
			assert.equal(sourceId, 'audio-source');
			order.push('retire');
			await options.retire?.(sourceId);
		},
		async relinkLinkedAudioOriginal(projectId, source, locatorId, relinkOptions) {
			order.push('relink');
			relinks.push({ projectId, source, locatorId, options: relinkOptions });
			if (options.relink) return options.relink(projectId, source, locatorId, relinkOptions);
			relinkOptions.assertCanPublish();
			return replacementBinding({
				locatorId,
				locatorRevision: relinkOptions.expectedLocatorRevision,
			});
		},
		async releaseLinkedOriginalLocator(reference) {
			order.push('release');
			releases.push(reference);
			return options.release ? options.release(reference) : true;
		},
		async invalidateSourceRuntime(sourceId) {
			order.push('invalidate');
			invalidatedSourceIds.push(sourceId);
			await options.invalidate?.(sourceId);
		},
		async getSourceMetadata(storageKey) {
			order.push('metadata');
			metadataKeys.push(storageKey);
			if (options.metadata) return options.metadata(storageKey);
			return Object.freeze({ id: storageKey, chunkCount: 1 });
		},
		async activateStoredSource(source, metadata) {
			order.push('activate');
			if (options.activate) return options.activate(source, metadata);
			return Object.freeze({ levels: [] });
		},
		publish() {
			order.push('publish');
			publishCount += 1;
		},
	};
	const rawService = createProjectBinLinkedAudioRelinkService(dependencies);
	const target = Object.freeze({ projectId: project.id, projectRevision: project.revision });
	return {
		service: Object.freeze({ ...rawService, relinkLinkedAudio: (clipId: string, file: Blob, locator: ProjectBinLinkedAudioRelinkLocator) => rawService.relinkLinkedAudio(clipId, file, locator, target) }),
		rawService,
		project,
		missingSourceIds,
		order,
		releases,
		relinks,
		previewOptions,
		invalidatedSourceIds,
		metadataKeys,
		startSharedRelink: () => lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK),
		supersedeRelink: () => lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK).finish(),
		invalidateProject: () => projectGeneration.invalidate(),
		get publishCount() { return publishCount; },
	};
}

function projectFixture(extraAudio = false) {
	const extraSources = extraAudio
		? [Object.freeze({ id: 'audio-source-two', kind: 'audio' as const, storageKey: 'audio-storage-two' })]
		: [];
	const extraClips = extraAudio
		? [Object.freeze({
			id: 'bin-audio-two', sourceId: 'audio-source-two', kind: 'audio' as const, binItemId: 'compound-item',
		})]
		: [];
	return Object.freeze({
		id: 'project-bin-linked-audio-relink-project',
		revision: 4,
		sources: Object.freeze([
			Object.freeze({ id: 'audio-source', kind: 'audio' as const, storageKey: 'audio-storage' }),
			Object.freeze({ id: 'video-source', kind: 'video' as const, storageKey: 'video-storage' }),
			...extraSources,
		]),
		projectBin: Object.freeze({ clips: Object.freeze([
			Object.freeze({
				id: 'bin-audio', sourceId: 'audio-source', kind: 'audio' as const, binItemId: 'compound-item',
			}),
			Object.freeze({
				id: 'bin-video', sourceId: 'video-source', kind: 'video' as const, binItemId: 'compound-item',
			}),
			...extraClips,
		]) }),
	});
}

function replacementBinding(locator: ProjectBinLinkedAudioRelinkLocator): ProjectBinLinkedAudioRelinkBinding {
	return Object.freeze({
		kind: 'audio',
		...locator,
		bindingToken: 'binding_audio_relink_selected_01',
	});
}

function audioFile(): Blob {
	return new Blob(['same linked PCM'], { type: 'audio/wav' });
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}
