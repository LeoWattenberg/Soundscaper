/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FIRST_LOCATOR,
	OLD_BINDING,
	OLD_LOCATOR,
	SECOND_LOCATOR,
	changedVideoFile,
	createHarness,
	deferred,
	replacementBinding,
	videoFile,
} from './helpers/project-bin-video-relink-harness.ts';


test('relink fences stale playback, preview, and visual before publishing a missing compound video', async () => {
	const fixture = createHarness();
	const file = new File(['same video'], 'selected.mp4', { type: 'video/mp4' });
	const projectBefore = JSON.stringify(fixture.project);

	assert.equal(await fixture.service.relinkLinkedVideo('bin-audio', file, FIRST_LOCATOR), 'video-source');

	assert.deepEqual(fixture.order, ['binding', 'timeline', 'preview', 'revoke', 'relink', 'activate', 'publish']);
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

test('an available bound video relinks without using missing-source state as eligibility', async () => {
	const fixture = createHarness({ missing: false });

	assert.equal(await fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR), 'video-source');

	assert.deepEqual(fixture.order, ['binding', 'timeline', 'preview', 'revoke', 'relink', 'activate', 'publish']);
	assert.deepEqual(fixture.releases, []);
	assert.equal(fixture.missingSourceIds.has('video-source'), false);
	assert.equal(fixture.publishCount, 1);
});

test('an available video may rebind its live locator without candidate cleanup', async () => {
	const fixture = createHarness({ missing: false });

	assert.equal(await fixture.service.relinkLinkedVideo('bin-video', videoFile(), OLD_LOCATOR), 'video-source');

	assert.equal(fixture.relinks[0]?.options.expectedBindingToken, OLD_BINDING.bindingToken);
	assert.deepEqual(fixture.releases, [], 'the live old locator is never candidate cleanup');
	assert.equal(fixture.publishCount, 1);
});

test('wrong, stale, and cancelled pre-publication relinks clean only a new candidate locator', async () => {
	const blocked = createHarness({ editingBlocked: () => true });
	await assert.rejects(
		blocked.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		/editing is blocked/iu,
	);
	assert.deepEqual(blocked.releases, [FIRST_LOCATOR]);
	assert.deepEqual(blocked.order, ['release']);

	const becameAvailable = createHarness({
		revoke: (missingSourceIds) => { missingSourceIds.delete('video-source'); },
	});
	await assert.rejects(
		becameAvailable.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		/became available before relink publication/iu,
	);
	assert.deepEqual(becameAvailable.order, ['binding', 'timeline', 'preview', 'revoke', 'release']);
	assert.deepEqual(becameAvailable.releases, [FIRST_LOCATOR]);

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

test('an available pre-publication failure restores the previous visual before candidate cleanup', async () => {
	const fixture = createHarness({
		missing: false,
		relink: async () => { throw new Error('The linked video binding changed before publication.'); },
	});

	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		/binding changed/iu,
	);

	assert.deepEqual(fixture.order, ['binding', 'timeline', 'preview', 'revoke', 'relink', 'activate', 'release']);
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
	assert.equal(fixture.missingSourceIds.has('video-source'), false, 'a restored visual stays available');
	assert.equal(fixture.publishCount, 0);
});

test('a failed visual restoration records missing state beside candidate cleanup', async () => {
	const primary = new Error('The linked video binding changed before publication.');
	let activations = 0;
	const fixture = createHarness({
		missing: false,
		relink: async () => { throw primary; },
		activate: async () => {
			activations += 1;
			throw new Error('previous video could not activate');
		},
	});

	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		(error: unknown) => error instanceof AggregateError && error.errors[0] === primary,
	);

	assert.equal(activations, 1);
	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'revoke', 'relink', 'activate', 'revoke', 'publish', 'release',
	]);
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
	assert.equal(fixture.missingSourceIds.has('video-source'), true);
	assert.equal(fixture.publishCount, 1);
	await assert.rejects(fixture.service.dispose(), /cleanup/iu);
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
	const fixture = createHarness({ editingBlocked: () => true, release: () => false });
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

	assert.deepEqual(fixture.order, ['binding', 'timeline', 'preview', 'revoke', 'relink', 'activate', 'revoke']);
	assert.deepEqual(fixture.releases, [], 'a published replacement remains owned after activation fails');
	assert.equal(fixture.missingSourceIds.has('video-source'), true);
	assert.equal(fixture.publishCount, 0);
});

test('an available activation failure records missing state on the committed binding', async () => {
	const activationFailure = new Error('selected video could not activate');
	const fixture = createHarness({
		missing: false,
		activate: async () => { throw activationFailure; },
	});

	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-video', videoFile(), FIRST_LOCATOR),
		(error) => error === activationFailure,
	);

	assert.deepEqual(fixture.order, [
		'binding', 'timeline', 'preview', 'revoke', 'relink', 'activate', 'revoke', 'publish',
	]);
	assert.deepEqual(fixture.releases, [], 'a published replacement remains owned after activation fails');
	assert.equal(fixture.missingSourceIds.has('video-source'), true);
	assert.equal(fixture.publishCount, 1);
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

test('a changed-content relink requires explicit confirmation before any side effects', async () => {
	const fixture = createHarness({ missing: false });

	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-solo-video', changedVideoFile(), FIRST_LOCATOR),
		/changed content.*requires explicit confirmation/iu,
	);

	assert.deepEqual(fixture.order, ['binding', 'release'], 'refusal precedes playback, preview, and visual work');
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
	assert.equal(fixture.publishCount, 0);
});

test('an authorized changed-content relink probes the candidate and purges stale derivatives', async () => {
	const fixture = createHarness({ missing: false });
	const file = changedVideoFile();
	const projectBefore = JSON.stringify(fixture.project);

	assert.equal(
		await fixture.service.relinkLinkedVideo('bin-solo-video', file, FIRST_LOCATOR, {
			allowChangedContent: true,
		}),
		'video-solo-source',
	);

	assert.deepEqual(fixture.order, [
		'binding', 'probe', 'timeline', 'preview', 'revoke', 'relink', 'derivatives', 'activate', 'publish',
	]);
	assert.deepEqual(fixture.revokedIds, ['video-solo-source']);
	const relink = fixture.relinks[0];
	assert.equal(relink?.options.admission, 'changed-content');
	assert.equal(relink?.options.expectedSnapshot, file);
	assert.deepEqual(fixture.releases, []);
	assert.equal(fixture.publishCount, 1);
	assert.equal(JSON.stringify(fixture.project), projectBefore, 'relink must not edit the canonical project');
});

test('changed-content relink refuses audio-paired items and retained-audio sources', async () => {
	const paired = createHarness({ missing: false });
	await assert.rejects(
		paired.service.relinkLinkedVideo('bin-video', changedVideoFile(), FIRST_LOCATOR, {
			allowChangedContent: true,
		}),
		/pairs the video with an audio member/iu,
	);
	assert.deepEqual(paired.order, ['binding', 'release']);

	const audible = createHarness({ missing: false });
	await assert.rejects(
		audible.service.relinkLinkedVideo('bin-audible-video', changedVideoFile(), FIRST_LOCATOR, {
			allowChangedContent: true,
		}),
		/retains canonical extracted audio.*silent video source/iu,
	);
	assert.deepEqual(audible.order, ['binding', 'release']);
	assert.deepEqual(audible.releases, [FIRST_LOCATOR]);
});

test('a failed changed-content probe releases only the candidate before side effects', async () => {
	const fixture = createHarness({
		missing: false,
		admitCandidate: async () => {
			throw new Error('The selected video does not match the linked source frame size.');
		},
	});

	await assert.rejects(
		fixture.service.relinkLinkedVideo('bin-solo-video', changedVideoFile(), FIRST_LOCATOR, {
			allowChangedContent: true,
		}),
		/does not match the linked source frame size/iu,
	);

	assert.deepEqual(fixture.order, ['binding', 'probe', 'release']);
	assert.deepEqual(fixture.releases, [FIRST_LOCATOR]);
	assert.equal(fixture.missingSourceIds.has('video-solo-source'), false);
	assert.equal(fixture.publishCount, 0);
});

test('a failed derivative purge keeps the relink and reports cleanup at disposal', async () => {
	const fixture = createHarness({
		missing: false,
		deleteDerivatives: async () => { throw new Error('derivative purge failed'); },
	});

	assert.equal(
		await fixture.service.relinkLinkedVideo('bin-solo-video', changedVideoFile(), FIRST_LOCATOR, {
			allowChangedContent: true,
		}),
		'video-solo-source',
	);

	assert.equal(fixture.publishCount, 1);
	await assert.rejects(fixture.service.dispose(), /candidate cleanup failed/iu);
});

test('classifyLinkedVideoRelink distinguishes exact from changed content', async () => {
	const fixture = createHarness({ missing: false });
	assert.equal(await fixture.service.classifyLinkedVideoRelink('bin-video', videoFile()), 'exact-content');
	assert.equal(
		await fixture.service.classifyLinkedVideoRelink('bin-video', changedVideoFile()),
		'changed-content',
	);
	const sameSizeChanged = new File(['same-video!'.slice(0, 10)], 'other.mp4', { type: 'video/mp4' });
	assert.equal(sameSizeChanged.size, videoFile().size);
	assert.equal(
		await fixture.service.classifyLinkedVideoRelink('bin-video', sameSizeChanged),
		'changed-content',
	);

	const unbound = createHarness({ getBinding: async () => null });
	await assert.rejects(
		unbound.service.classifyLinkedVideoRelink('bin-video', videoFile()),
		/not currently bound/iu,
	);
});

test('relink eligibility reports only a bound single-video item', async () => {
	const bound = createHarness({ missing: false });
	assert.equal(await bound.service.canRelinkLinkedVideo('bin-video'), true);
	assert.equal(await bound.service.canRelinkLinkedVideo('bin-audio'), true, 'the compound item resolves its video');
	assert.equal(await bound.service.canRelinkLinkedVideo('bin-solo-audio'), false);
	assert.equal(await bound.service.canRelinkLinkedVideo('unknown-item'), false);
	assert.deepEqual(bound.order, ['binding', 'binding'], 'video-free items never consult the binding');

	const unbound = createHarness({ getBinding: async () => null });
	assert.equal(await unbound.service.canRelinkLinkedVideo('bin-video'), false);
});
