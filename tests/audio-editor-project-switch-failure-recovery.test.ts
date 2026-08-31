/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture, deferred, project } from './helpers/audio-editor-project-switch-fixture.ts';

test('a source-load failure commits incoming ownership and allows same-project repair', async () => {
	const fixture = createFixture();
	const next = project('failed-source-project');
	const sourceFailure = new Error('injected source loading failure');
	let attempts = 0;
	let oldProviderDisposals = 0;
	let firstIncomingProviderDisposals = 0;
	const oldProvider = { dispose: () => { oldProviderDisposals += 1; } };
	const firstIncomingProvider = { dispose: () => { firstIncomingProviderDisposals += 1; } };
	const repairedIncomingProvider = { dispose: () => undefined };
	fixture.setSourceChunkProvider('shared-source', oldProvider);
	fixture.setLoadSources(async (candidate) => {
		if (candidate.id !== next.id) return;
		attempts += 1;
		fixture.setSourceChunkProvider(
			'shared-source',
			attempts === 1 ? firstIncomingProvider : repairedIncomingProvider,
		);
		if (attempts === 1) throw sourceFailure;
	});

	await assert.rejects(fixture.service.switchProject(next), (error) => error === sourceFailure);

	assert.strictEqual(fixture.getProject(), next);
	assert.strictEqual(fixture.state.history?.present, next);
	assert.equal(fixture.state.projectLock?.projectId, next.id);
	assert.equal(fixture.state.projectLock?.readOnly, false);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.getTab(next.id)?.readOnly, true);
	assert.equal(fixture.readOnlyUpdates.at(-1)?.reason, 'project-activation-failed');
	assert.equal(fixture.state.outputUrl, null);
	assert.equal(fixture.state.exportOutput, null);
	assert.deepEqual(fixture.revokedUrls, ['blob:old-output']);
	assert.equal(fixture.events.filter((event) => event === 'output-cleanup').length, 1);
	assert.strictEqual(fixture.getSourceChunkProvider('shared-source'), firstIncomingProvider);
	assert.equal(oldProviderDisposals, 1);
	assert.equal(firstIncomingProviderDisposals, 0);
	assert.equal(fixture.getLoadedEngineProject(), null);
	assert.deepEqual(fixture.publishedProjectIds, [next.id]);
	assert.ok(fixture.events.includes(`schedule-lock:${next.id}`));
	assert.equal(fixture.events.some((event) => event === `record-opened:${next.id}`), false);
	assert.equal(fixture.events.includes('gc'), false);

	await fixture.service.switchProject(next);

	assert.equal(attempts, 2, 'the degraded active project must bypass same-ID deduplication');
	assert.strictEqual(fixture.getLoadedEngineProject(), next);
	assert.equal(fixture.state.readOnly, false);
	assert.equal(fixture.getTab(next.id)?.readOnly, false);
	assert.strictEqual(fixture.getSourceChunkProvider('shared-source'), repairedIncomingProvider);
	assert.equal(firstIncomingProviderDisposals, 1);
	assert.deepEqual(fixture.publishedProjectIds, [next.id, next.id]);
});

test('failed export cleanup is detached before failed-target recovery', async () => {
	const fixture = createFixture();
	const next = project('failed-output-cleanup-project');
	const cleanupFailure = new Error('injected output cleanup failure');
	let cleanupCalls = 0;
	fixture.state.outputCleanup = () => {
		cleanupCalls += 1;
		throw cleanupFailure;
	};

	await assert.rejects(fixture.service.switchProject(next), (error) => error === cleanupFailure);

	assert.equal(cleanupCalls, 1);
	assert.equal(fixture.state.outputCleanup, null);
	assert.equal(fixture.state.readOnly, true);
	assert.deepEqual(fixture.publishedProjectIds, [next.id]);

	await fixture.service.switchProject(next);

	assert.equal(cleanupCalls, 1, 'same-project repair must not repeat a one-shot cleanup');
	assert.strictEqual(fixture.getLoadedEngineProject(), next);
});

test('terminal disposal during failed provider finalization skips degraded publication', async () => {
	const fixture = createFixture();
	const next = project('disposed-failed-project');
	const sourceFailure = new Error('injected source loading failure');
	const providerRetirementStarted = deferred<void>();
	const providerRetirementRelease = deferred<void>();
	let incomingProviderDisposals = 0;
	fixture.setSourceChunkProvider('shared-source', {
		dispose: async () => {
			providerRetirementStarted.resolve();
			await providerRetirementRelease.promise;
		},
	});
	fixture.setLoadSources(async (candidate) => {
		if (candidate.id !== next.id) return;
		fixture.setSourceChunkProvider('shared-source', {
			dispose: () => { incomingProviderDisposals += 1; },
		});
		throw sourceFailure;
	});

	const switching = fixture.service.switchProject(next);
	await providerRetirementStarted.promise;
	fixture.events.push('begin-disposal');
	fixture.lifetime.beginDisposal();
	providerRetirementRelease.resolve();

	await assert.rejects(switching, (error) => error === sourceFailure);

	const postDisposalEvents = fixture.events.slice(fixture.events.indexOf('begin-disposal') + 1);
	assert.equal(postDisposalEvents.includes('publish'), false);
	assert.equal(postDisposalEvents.includes('sync-meter'), false);
	assert.equal(postDisposalEvents.includes(`schedule-lock:${next.id}`), false);
	assert.ok(postDisposalEvents.includes('release-lock'));
	assert.ok(postDisposalEvents.includes('clear-source-caches'));
	assert.equal(fixture.state.projectLock, null);
	assert.equal(fixture.getSourceChunkProvider('shared-source'), undefined);
	assert.equal(incomingProviderDisposals, 1);
	assert.deepEqual(fixture.publishedProjectIds, []);
});
