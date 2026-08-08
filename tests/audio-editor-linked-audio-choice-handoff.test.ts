/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	dispatchLinkedAudioChoice,
	handoffLinkedAudioChoice,
	prepareLinkedAudioChoice,
} from '../src/common/editor/ui/workspace/linked-audio-choice-handoff.ts';

const LOCATOR = Object.freeze({ locatorId: 'locator_selected_01', locatorRevision: 'revision_selected_01' });
type ProjectScope = Readonly<{ projectId: string; revision: number }>;

test('a stale chooser result is released pathlessly without reaching the controller', async () => {
	const scope: ProjectScope = Object.freeze({ projectId: 'project-original', revision: 4 });
	const currentScope: ProjectScope = Object.freeze({ projectId: 'project-duplicate', revision: 4 });
	const file = new Blob(['exact pcm']);
	const releases: unknown[] = [];
	let accepted = false;

	assert.equal(await handoffLinkedAudioChoice({
		choose: async () => ({ ...LOCATOR, file, path: '/must/not/escape.wav' }),
		isCurrent: (candidate) => candidate === currentScope,
		release: async (reference) => { releases.push(reference); return true; },
		accept: () => { accepted = true; return Promise.resolve('audio-source'); },
	}, scope), null);

	assert.equal(accepted, false);
	assert.deepEqual(releases, [LOCATOR]);
});

test('a synchronous controller rejection releases the choice before ownership handoff', async () => {
	const scope = Object.freeze({ projectId: 'project-original', revision: 4 });
	const dispatchFailure = new Error('controller disposed');
	const releases: unknown[] = [];

	await assert.rejects(handoffLinkedAudioChoice({
		choose: async () => ({ ...LOCATOR, file: new Blob(['exact pcm']) }),
		isCurrent: (candidate) => candidate === scope,
		release: async (reference) => { releases.push(reference); return true; },
		accept: () => { throw dispatchFailure; },
	}, scope), (error) => error === dispatchFailure);

	assert.deepEqual(releases, [LOCATOR]);
});

test('an asynchronous controller rejection remains owned by the controller', async () => {
	const scope = Object.freeze({ projectId: 'project-original', revision: 4 });
	const operationFailure = new Error('storage rejected candidate');
	let releaseCount = 0;

	await assert.rejects(handoffLinkedAudioChoice({
		choose: async () => ({ ...LOCATOR, file: new Blob(['exact pcm']) }),
		isCurrent: (candidate) => candidate === scope,
		release: async () => { releaseCount += 1; return true; },
		accept: () => Promise.reject(operationFailure),
	}, scope), (error) => error === operationFailure);

	assert.equal(releaseCount, 0);
});

test('changed-content classification retains the pathless choice for explicit confirmation', async () => {
	const scope = Object.freeze({ projectId: 'project-original', revision: 4 });
	const file = new Blob(['changed pcm']);
	let releaseCount = 0;

	const prepared = await prepareLinkedAudioChoice({
		choose: async () => ({ ...LOCATOR, file }),
		isCurrent: (candidate) => candidate === scope,
		release: async () => { releaseCount += 1; return true; },
		classify: async () => 'changed-content',
	}, scope);

	assert.deepEqual(prepared, {
		classification: 'changed-content',
		file,
		reference: LOCATOR,
	});
	assert.equal(Object.isFrozen(prepared), true);
	assert.equal(releaseCount, 0);
});

test('classification failure or a stale post-classification scope releases the choice', async () => {
	const scope = Object.freeze({ projectId: 'project-original', revision: 4 });
	const releases: unknown[] = [];
	const failure = new Error('classification failed');

	await assert.rejects(prepareLinkedAudioChoice({
		choose: async () => ({ ...LOCATOR, file: new Blob(['changed pcm']) }),
		isCurrent: () => true,
		release: async (reference) => { releases.push(reference); return true; },
		classify: async () => { throw failure; },
	}, scope), (error) => error === failure);

	let current = true;
	assert.equal(await prepareLinkedAudioChoice({
		choose: async () => ({ ...LOCATOR, file: new Blob(['changed pcm']) }),
		isCurrent: () => current,
		release: async (reference) => { releases.push(reference); return true; },
		classify: async () => { current = false; return 'changed-content'; },
	}, scope), null);
	assert.deepEqual(releases, [LOCATOR, LOCATOR]);
});

test('dispatch transfers asynchronous cleanup ownership only after a prepared choice', async () => {
	const operationFailure = new Error('storage rejected changed candidate');
	let releaseCount = 0;
	const prepared = Object.freeze({
		classification: 'changed-content' as const,
		file: new Blob(['changed pcm']),
		reference: LOCATOR,
	});

	await assert.rejects(dispatchLinkedAudioChoice({
		release: async () => { releaseCount += 1; return true; },
		accept: () => Promise.reject(operationFailure),
	}, prepared), (error) => error === operationFailure);
	assert.equal(releaseCount, 0);
});
