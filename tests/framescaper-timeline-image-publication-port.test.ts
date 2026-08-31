/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperTimelineImageCurrentProjectPublicationTimelineImage as createPort,
} from '../src/framescaper/editor-timeline-image-current-project-publication-timeline-image.ts';

type Data = Record<string, unknown>;

const PROJECT = createFramescaperProjectTimelineImage(PROFILE, {}) as unknown as Data;
const PUBLISHED = createFramescaperProjectTimelineImage(
	PROFILE,
	{ title: 'Published' } as never,
) as unknown as Data;

const BODY = Object.freeze({
	arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
});

function harness(overrides: Data = {}): Readonly<{ dependencies: never; calls: string[] }> {
	const calls: string[] = [];
	const controller: Data = {
		project: PROJECT,
		actions: { project: { openById: async () => { calls.push('openById'); } } },
	};
	const dependencies = {
		controller,
		session: {
			captureProjectHistory: () => ({ token: {}, history: { present: PROJECT } }),
			assertProjectHistoryToken: () => { calls.push('assertToken'); },
			updateProjectHistory: () => { calls.push('updateHistory'); },
			markProjectSaved: () => { calls.push('markSaved'); },
		},
		executeCommand: () => ({ present: PUBLISHED }),
		publishIfCurrent: async () => PUBLISHED,
		now: () => new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	};
	return { calls, dependencies: dependencies as unknown as never };
}

function adopting(overrides: Data = {}): Readonly<{ dependencies: never; calls: string[] }> {
	const built = harness(overrides);
	const controller = (built.dependencies as unknown as Data).controller as Data;
	(controller.actions as Data).project = {
		openById: async (_projectId: string, options: Data = {}) => {
			built.calls.push(options.adoptSessionRevision === true ? 'openById:adopt' : 'openById');
			if (options.adoptSessionRevision !== true) return;
			controller.project = PUBLISHED;
		},
	};
	return built;
}

function publish(dependencies: never): Promise<Data> {
	return createPort(dependencies).publish({
		project: PROJECT,
		command: { type: 'timeline-image/publish' },
		body: BODY,
	} as never) as unknown as Promise<Data>;
}

function isStale(pattern: RegExp): (error: Error) => boolean {
	return (error) => {
		assert.equal(error.name, 'AbortError');
		assert.match(error.message, pattern);
		return true;
	};
}

test('a current project publishes and the editor adopts the new revision', async () => {
	const { dependencies, calls } = adopting();

	const published = await publish(dependencies);

	assert.equal(published, PUBLISHED);
	assert.deepEqual(calls, [
		'assertToken', 'assertToken', 'assertToken', 'updateHistory', 'markSaved', 'openById:adopt',
	]);
});

test('the history token is reasserted after every await the publication performs', async () => {
	const { dependencies, calls } = adopting();

	await publish(dependencies);

	assert.equal(
		calls.filter((call) => call === 'assertToken').length,
		3,
		'each suspension point must revalidate the captured history token',
	);
});

test('a project that moved before publication is refused as stale', async () => {
	const { dependencies } = harness({
		controller: { project: PUBLISHED, actions: { project: { openById: async () => undefined } } },
	});

	await assert.rejects(
		() => publish(dependencies),
		isStale(/project changed before image publication/u),
	);
});

test('a history whose present revision drifted is refused as stale', async () => {
	const { dependencies } = harness({
		session: {
			captureProjectHistory: () => ({ token: {}, history: { present: PUBLISHED } }),
			assertProjectHistoryToken: () => undefined,
			updateProjectHistory: () => undefined,
			markProjectSaved: () => undefined,
		},
	});

	await assert.rejects(
		() => publish(dependencies),
		isStale(/history changed before image publication/u),
	);
});

test('a superseded compare-and-set is refused rather than retried', async () => {
	const { dependencies } = harness({ publishIfCurrent: async () => null });

	await assert.rejects(
		() => publish(dependencies),
		isStale(/revision was superseded before publication/u),
	);
});

test('storage returning a different revision is a hard failure, not a staleness retry', async () => {
	const { dependencies } = harness({
		publishIfCurrent: async () => createFramescaperProjectTimelineImage(
			PROFILE,
			{ title: 'Different' } as never,
		),
	});

	await assert.rejects(() => publish(dependencies), (error: Error) => {
		assert.notEqual(error.name, 'AbortError');
		assert.match(error.message, /returned a different project revision/u);
		return true;
	});
});

test('a published revision the editor failed to adopt is reported as stale', async () => {
	const { dependencies } = harness();

	await assert.rejects(
		() => publish(dependencies),
		isStale(/was not adopted by the active editor/u),
	);
});

test('the publication port refuses an incomplete dependency composition', () => {
	for (const overrides of [
		{ executeCommand: 1 },
		{ publishIfCurrent: 1 },
		{ session: {} },
		{ controller: { project: PROJECT, actions: {} } },
	]) {
		assert.throws(() => createPort(harness(overrides).dependencies), TypeError);
	}
	assert.throws(() => createPort(null as never), TypeError);
});
