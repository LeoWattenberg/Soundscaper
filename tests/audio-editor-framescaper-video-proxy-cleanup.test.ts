/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperVideoProxyCleanupCoordinatorRetime,
} from '../src/framescaper/editor-video-proxy-cleanup-retime.ts';

test('desktop cleanup loads full project documents behind catalog summaries', async () => {
	let journal: unknown = null;
	const deleted: string[] = [];
	const loaded: string[] = [];
	const prior = projectFixture(4, attachment());
	const current = projectFixture(5, null);
	const cleanup = createFramescaperVideoProxyCleanupCoordinatorRetime({
		async loadAnalysis() { return structuredClone(journal); },
		async saveAnalysis(_key, value) {
			journal = structuredClone(value);
			return undefined;
		},
		async deleteMediaAsset(storageKey) {
			deleted.push(storageKey);
			return undefined;
		},
	}, {
		async listProjects() {
			return [{ id: 'proxy-project', title: 'Proxy project', revision: 5, updatedAt: '2026-08-31' }];
		},
		async loadProject(projectId) {
			loaded.push(projectId);
			return current;
		},
	});

	await cleanup.prepareReplacement(prior, 'video-source');
	await cleanup.recover();

	assert.deepEqual(loaded, ['proxy-project']);
	assert.deepEqual(deleted.sort(), [
		`video-proxy-sha256:${'34'.repeat(32)}`,
		`video-timing-sha256:${'56'.repeat(32)}`,
	].sort());
});

function projectFixture(revision: number, proxyAttachment: unknown): Record<string, unknown> {
	return {
		id: 'proxy-project', revision,
		sources: [{ kind: 'video', id: 'video-source', proxyAttachment }],
	};
}

function attachment(): Record<string, unknown> {
	const proxySha256 = '34'.repeat(32);
	const timingSha256 = '56'.repeat(32);
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha256}`,
		mimeType: 'video/mp4', byteLength: 1_024, sha256: proxySha256,
		originalSha256: '12'.repeat(32), originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${timingSha256}`,
			sha256: timingSha256, sourceSha256: proxySha256,
			byteLength: 112, frameCount: 10, timescale: 1_000,
			finalFrameDurationTicks: '100',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}
