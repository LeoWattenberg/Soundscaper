/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FramescaperVideoProxyLifecycleV25,
	selectFramescaperVideoMediaV25,
	type FramescaperProxyProjectV25,
} from '../src/framescaper/editor-video-proxy-lifecycle-v25.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';

const ROWS = ['codec-mezzanine-and-longform', 'container-mov-mxf-matroska'] as const;

test('generation is a ProRes Proxy/MOV queue job and licensing fails closed', async () => {
	const fixture = lifecycle();
	const blocked = await fixture.controller.generate({ sourceId: 'video-1', clearedPolicyRowIds: [] });
	assert.deepEqual(blocked, {
		status: 'blocked-policy',
		blockedPolicyRowIds: [...ROWS],
	});
	assert.equal(fixture.enqueued.length, 0);

	const queued = await fixture.controller.generate({ sourceId: 'video-1', clearedPolicyRowIds: ROWS });
	assert.deepEqual(queued, { status: 'queued', jobId: 'job-1' });
	assert.equal(fixture.enqueued[0]?.kind, 'media-proxy');
	assert.deepEqual(fixture.enqueued[0]?.recipe, {
		recipeId: 'framescaper-native-prores-proxy-mov-v1',
		recipeVersion: 1,
		profileId: 'encode-mov-prores-proxy',
		container: 'mov',
		codec: 'prores_ks',
		mimeType: 'video/quicktime',
		geometry: { width: 1_280, height: 720, scaled: true },
		timingRule: 'exact-presentation-boundaries-v1',
		audioPolicy: 'ignore-proxy-container-audio-v1',
		recoveryClass: 'atomic-restart',
	});
});

test('attach, relink, and detach mutate the existing proxyAttachment relationship only', async () => {
	const fixture = lifecycle();
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	assert.equal(fixture.project.sources[0]?.proxyAttachment?.sha256, '22'.repeat(32));
	assert.equal(Object.hasOwn(fixture.project.sources[0]!, 'nativeProxyRelationship'), false);

	await fixture.controller.relink({
		sourceId: 'video-1',
		attachment: attachment({ sha256: '33'.repeat(32) }),
	});
	assert.equal(fixture.project.sources[0]?.proxyAttachment?.sha256, '33'.repeat(32));
	assert.deepEqual(fixture.cleaned, [
		`video-proxy-sha256:${'22'.repeat(32)}`,
	]);

	await fixture.controller.detach({ sourceId: 'video-1' });
	assert.equal(fixture.project.sources[0]?.proxyAttachment, null);
	assert.deepEqual(fixture.cleaned.slice(1), [
		`video-proxy-sha256:${'33'.repeat(32)}`,
		`video-timing-sha256:${'44'.repeat(32)}`,
	]);
});

test('committed cleanup survives failure and is retried by a fresh lifecycle', async () => {
	const fixture = lifecycle(25, { failCleanupOnce: true });
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	await assert.rejects(
		() => fixture.controller.detach({ sourceId: 'video-1' }),
		/simulated cleanup failure/u,
	);
	assert.equal(fixture.project.sources[0]?.proxyAttachment, null,
		'the relationship commit remains authoritative after cleanup failure');
	assert.equal(fixture.journal.length, 1);
	await fixture.restart().recoverCleanup();
	assert.deepEqual(fixture.cleaned, [
		`video-proxy-sha256:${'22'.repeat(32)}`,
		`video-timing-sha256:${'44'.repeat(32)}`,
	]);
	assert.deepEqual(fixture.journal, []);
});

test('a failed relationship commit cancels its cleanup claim without deleting live bodies', async () => {
	const fixture = lifecycle(25, { failCommitOnce: true });
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	await assert.rejects(
		() => fixture.controller.detach({ sourceId: 'video-1' }),
		/simulated commit failure/u,
	);
	assert.notEqual(fixture.project.sources[0]?.proxyAttachment, null);
	assert.deepEqual(fixture.cleaned, []);
	assert.deepEqual(fixture.journal, []);
});

test('restart recovery rejects cleanup journals whose body keys were changed', async () => {
	const fixture = lifecycle(25, { failCleanupOnce: true });
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	await assert.rejects(
		() => fixture.controller.detach({ sourceId: 'video-1' }),
		/simulated cleanup failure/u,
	);
	fixture.tamperJournal((claim) => ({
		...claim,
		storageKeys: ['video-proxy-sha256:forged'],
	}));
	await assert.rejects(
		() => fixture.restart().recoverCleanup(),
		/forged or duplicate claim/u,
	);
	assert.deepEqual(fixture.cleaned, []);
});

test('relink refuses an attachment generated from a different original', async () => {
	const fixture = lifecycle();
	await assert.rejects(() => fixture.controller.relink({
		sourceId: 'video-1', attachment: attachment({ originalSha256: '99'.repeat(32) }),
	}), /does not bind the current original/u);
	assert.equal(fixture.project.sources[0]?.proxyAttachment, null);
});

test('adaptive preview requires fresh reattestation while export always names the original', async () => {
	const fixture = lifecycle();
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	const unattested = selectFramescaperVideoMediaV25({
		purpose: 'preview', source: fixture.project.sources[0]!, attestation: null,
		proxyBodyAvailable: true, originalBodyAvailable: true, previewWidth: 1_920,
	});
	assert.equal(unattested.kind, 'original');

	const attestation = await fixture.controller.reattest({ sourceId: 'video-1' });
	assert.equal(selectFramescaperVideoMediaV25({
		purpose: 'preview', source: fixture.project.sources[0]!, attestation,
		proxyBodyAvailable: true, originalBodyAvailable: true, previewWidth: 1_920,
	}).kind, 'proxy');
	assert.equal(selectFramescaperVideoMediaV25({
		purpose: 'export', source: fixture.project.sources[0]!, attestation,
		proxyBodyAvailable: true, originalBodyAvailable: true, previewWidth: 1_920,
	}).kind, 'original');
	assert.equal(selectFramescaperVideoMediaV25({
		purpose: 'preview', source: fixture.project.sources[0]!, attestation,
		proxyBodyAvailable: true, originalBodyAvailable: false, previewWidth: 1_920,
	}).kind, 'proxy');
	assert.equal(selectFramescaperVideoMediaV25({
		purpose: 'export', source: fixture.project.sources[0]!, attestation,
		proxyBodyAvailable: true, originalBodyAvailable: false, previewWidth: 1_920,
	}).kind, 'unavailable');
});

test('offline reporting distinguishes missing original, missing proxy, and usable proxy', async () => {
	const fixture = lifecycle();
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	const attestation = await fixture.controller.reattest({ sourceId: 'video-1' });
	assert.deepEqual(fixture.controller.offlineStatus({
		sourceId: 'video-1', originalBodyAvailable: false, proxyBodyAvailable: true, attestation,
	}), { status: 'original-offline', exportAvailable: false, previewAvailable: true });
	assert.deepEqual(fixture.controller.offlineStatus({
		sourceId: 'video-1', originalBodyAvailable: false, proxyBodyAvailable: true, attestation: null,
	}), { status: 'original-offline', exportAvailable: false, previewAvailable: false });
	assert.deepEqual(fixture.controller.offlineStatus({
		sourceId: 'video-1', originalBodyAvailable: true, proxyBodyAvailable: false, attestation,
	}), { status: 'proxy-offline', exportAvailable: true, previewAvailable: true });
	assert.deepEqual(fixture.controller.offlineStatus({
		sourceId: 'video-1', originalBodyAvailable: true, proxyBodyAvailable: true, attestation,
	}), { status: 'online', exportAvailable: true, previewAvailable: true });
});

test('the cumulative V26 candidate inherits the complete V25 proxy lifecycle', async () => {
	const fixture = lifecycle(26);
	await fixture.controller.attach({ sourceId: 'video-1', attachment: attachment() });
	assert.equal(fixture.project.schemaVersion, 26);
	assert.equal(fixture.project.sources[0]?.proxyAttachment?.sha256, '22'.repeat(32));
	const queued = await fixture.controller.generate({ sourceId: 'video-1', clearedPolicyRowIds: ROWS });
	assert.deepEqual(queued, { status: 'queued', jobId: 'job-1' });
});

function lifecycle(
	schemaVersion: 25 | 26 = 25,
	options: Readonly<{ failCleanupOnce?: boolean; failCommitOnce?: boolean }> = {},
) {
	let project: FramescaperProxyProjectV25 = projectFixture(schemaVersion);
	const enqueued: Record<string, unknown>[] = [];
	const cleaned: string[] = [];
	let journal: unknown = [];
	let cleanupFailures = options.failCleanupOnce === true ? 1 : 0;
	let commitFailures = options.failCommitOnce === true ? 1 : 0;
	const create = () => new FramescaperVideoProxyLifecycleV25({
		getProject: () => project,
		commitProject: (next) => {
			if (commitFailures > 0 && project.sources[0]?.proxyAttachment !== null) {
				commitFailures -= 1;
				throw new Error('simulated commit failure');
			}
			project = next;
		},
		enqueueProxy: (job) => { enqueued.push(job); return 'job-1'; },
		reattestAttachment: () => true,
		cleanupBody: (storageKey) => {
			if (cleanupFailures > 0) {
				cleanupFailures -= 1;
				throw new Error('simulated cleanup failure');
			}
			cleaned.push(storageKey);
		},
		loadCleanupJournal: () => structuredClone(journal),
		saveCleanupJournal: (_projectId, value) => { journal = structuredClone(value); },
	});
	const controller = create();
	return {
		controller,
		enqueued,
		cleaned,
		restart: create,
		tamperJournal: (mutate: (claim: Record<string, unknown>) => unknown) => {
			journal = (journal as readonly unknown[]).map((claim) => (
				mutate(claim as Record<string, unknown>)
			));
		},
		get project() { return project; },
		get journal() { return structuredClone(journal) as readonly unknown[]; },
	};
}

function projectFixture(schemaVersion: 25 | 26 = 25): FramescaperProxyProjectV25 {
	return {
		schemaVersion,
		id: 'project-1',
		revision: 0,
		sources: [{
			kind: 'video' as const,
			id: 'video-1',
			storageKey: 'video-original',
			mimeType: 'video/mp4',
			contentSha256: '11'.repeat(32),
			width: 3_840,
			height: 2_160,
			characteristics: createUnreportedVideoSourceCharacteristicsV25(),
			proxyAttachment: null,
		}],
	};
}

function attachment(overrides: Readonly<Record<string, unknown>> = {}) {
	const proxySha = String(overrides.sha256 ?? '22'.repeat(32));
	const timingSha = '44'.repeat(32);
	return {
		kind: 'video-proxy-attachment' as const,
		version: 1 as const,
		rule: 'exact-original-generation-proxy-content-and-timing-v1' as const,
		storageKey: `video-proxy-sha256:${proxySha}`,
		mimeType: 'video/quicktime',
		byteLength: 1_000,
		sha256: proxySha,
		originalSha256: '11'.repeat(32),
		originalAuthorityKind: 'owned' as const,
		generatorId: 'framescaper-media-host',
		generatorVersion: 1,
		recipeId: 'framescaper-native-prores-proxy-mov-v1',
		recipeVersion: 1,
		timingBackendId: 'framescaper-media-host',
		timingRule: 'exact-presentation-boundaries-v1' as const,
		frameCount: 10,
		boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1' as const,
			storageKey: `video-timing-sha256:${timingSha}`,
			sha256: timingSha,
			sourceSha256: proxySha,
			byteLength: 112,
			frameCount: 10,
			timescale: 24,
			finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1' as const,
		...overrides,
	};
}
