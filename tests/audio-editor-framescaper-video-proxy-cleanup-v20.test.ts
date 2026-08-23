/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FramescaperVideoProxyCleanupCoordinatorV20,
	type FramescaperVideoProxyCleanupPortsV20,
} from '../src/framescaper/editor-video-proxy-cleanup-v20.ts';

const PROXY_KEY = `video-proxy-sha256:${'34'.repeat(32)}`;
const TIMING_KEY = `video-timing-sha256:${'56'.repeat(32)}`;

test('a selected proxy replacement is journaled before exact unreferenced bodies are reclaimed', async () => {
	const fixture = portsFixture([project(4, attachment())]);
	const cleanup = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	const claim = await cleanup.prepareReplacement(project(4, attachment()), 'video-source');

	assert.equal(fixture.saved.length, 1);
	assert.deepEqual(fixture.deleted, []);
	fixture.projects = [project(5, null)];
	await cleanup.settle(claim, fixture.projects[0]);

	assert.deepEqual(fixture.deleted, [PROXY_KEY, TIMING_KEY]);
	assert.deepEqual(fixture.journal, []);
});

test('startup recovery cancels a pre-commit claim while the current project still owns the proxy', async () => {
	const fixture = portsFixture([project(4, attachment())]);
	const first = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	await first.prepareReplacement(project(4, attachment()), 'video-source');

	const restarted = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	await restarted.recover();

	assert.deepEqual(fixture.deleted, []);
	assert.deepEqual(fixture.journal, []);
});

test('startup recovery resumes an exact post-commit cleanup idempotently after a partial delete', async () => {
	const fixture = portsFixture([project(4, attachment())]);
	const first = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	const claim = await first.prepareReplacement(project(4, attachment()), 'video-source');
	fixture.projects = [project(5, null)];
	fixture.failOnceFor = TIMING_KEY;
	await assert.rejects(first.settle(claim), /planned cleanup failure/u);
	assert.deepEqual(fixture.deleted, [PROXY_KEY]);
	assert.equal(Array.isArray(fixture.journal) ? fixture.journal.length : -1, 1);

	const restarted = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	await restarted.recover();
	assert.deepEqual(fixture.deleted, [PROXY_KEY, TIMING_KEY]);
	assert.deepEqual(fixture.journal, []);
});

test('cleanup never deletes a content-addressed body still rooted by another current project', async () => {
	const shared = attachment();
	const fixture = portsFixture([project(4, shared), project(9, shared, 'other-project')]);
	const cleanup = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	const claim = await cleanup.prepareReplacement(fixture.projects[0]!, 'video-source');
	fixture.projects = [project(5, null), fixture.projects[1]!];
	await cleanup.settle(claim, fixture.projects[0]);

	assert.deepEqual(fixture.deleted, []);
	assert.deepEqual(fixture.journal, []);
});

test('forged cleanup journals fail closed before any body is touched', async () => {
	const fixture = portsFixture([project(5, null)]);
	fixture.journal = [{ kind: 'framescaper-selected-video-proxy-cleanup', version: 1 }];
	const cleanup = new FramescaperVideoProxyCleanupCoordinatorV20(fixture.ports);
	await assert.rejects(cleanup.recover(), /cleanup journal.*invalid/iu);
	assert.deepEqual(fixture.deleted, []);
});

function portsFixture(initialProjects: Record<string, unknown>[]) {
	const fixture: {
		projects: Record<string, unknown>[];
		journal: unknown;
		saved: unknown[];
		deleted: string[];
		failOnceFor: string | null;
		ports: FramescaperVideoProxyCleanupPortsV20;
	} = {
		projects: initialProjects,
		journal: [],
		saved: [],
		deleted: [],
		failOnceFor: null,
		ports: null as never,
	};
	fixture.ports = {
		loadJournal: async () => structuredClone(fixture.journal),
		saveJournal: async (journal) => {
			fixture.journal = structuredClone(journal);
			fixture.saved.push(structuredClone(journal));
		},
		listCurrentProjects: async () => structuredClone(fixture.projects),
		deleteBody: async (storageKey) => {
			if (fixture.failOnceFor === storageKey) {
				fixture.failOnceFor = null;
				throw new Error('planned cleanup failure');
			}
			if (!fixture.deleted.includes(storageKey)) fixture.deleted.push(storageKey);
		},
	};
	return fixture;
}

function project(
	revision: number,
	proxyAttachment: Record<string, unknown> | null,
	id = 'proxy-project',
): Record<string, unknown> {
	return {
		schemaVersion: 27,
		id,
		revision,
		sources: [{
			kind: 'video',
			id: 'video-source',
			contentSha256: '12'.repeat(32),
			proxyAttachment,
		}],
	};
}

function attachment(): Record<string, unknown> {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_KEY,
		mimeType: 'video/mp4', byteLength: 1_024, sha256: '34'.repeat(32),
		originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: TIMING_KEY,
			sha256: '56'.repeat(32), sourceSha256: '34'.repeat(32),
			byteLength: 112, frameCount: 10, timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
