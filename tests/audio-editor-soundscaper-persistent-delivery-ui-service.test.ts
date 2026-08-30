/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeliveryBatch } from '../src/common/editor/delivery-batch.ts';
import type { DeliveryBatchMember } from '../src/common/editor/delivery-batch.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import {
	createSoundscaperPersistentDeliveryUiService,
	type SoundscaperPersistentDeliveryEnqueueRequest,
	type SoundscaperPersistentDeliveryRendererBridge,
	type SoundscaperPersistentDeliverySummary,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-ui-service.ts';

const PROJECT_SHA = 'ab'.repeat(32);
const PROJECT = Object.freeze({
	id: 'project-1', revision: 7, title: 'Album', sampleRate: 48_000,
	selection: { startFrame: 0, endFrame: 48_000 },
	loop: { enabled: false, startFrame: 0, endFrame: 0 },
	tracks: [], clips: [], sources: [],
});

test('desktop batches bind one saved generation, exact ordinary plans, and an opaque destination', async () => {
	const fixture = persistentFixture();
	const batch = deliveryBatch();
	await fixture.service.refresh();
	await assert.rejects(fixture.service.enqueueBatch(batch), /destination/iu);
	assert.deepEqual(await fixture.service.selectDestination(), { grantId: 'cd'.repeat(24) });

	const ids = await fixture.service.enqueueBatch(batch);
	assert.deepEqual(ids, ['ef'.repeat(24)]);
	assert.equal(fixture.calls.enqueue.length, 1);
	const request = fixture.calls.enqueue[0];
	assert.deepEqual(request.admission, {
		projectIdentity: { projectId: 'project-1', projectRevision: 7, projectSha256: PROJECT_SHA },
		planFingerprints: [request.items[0].description.planFingerprint],
		saved: true, clean: true, named: true,
	});
	assert.equal(request.items[0].description.destinationGrantId, 'cd'.repeat(24));
	const plan = JSON.parse(request.items[0].description.planPayload);
	assert.equal(plan.kind, 'soundscaper-persistent-audio-delivery-plan');
	assert.deepEqual(plan.settings, { format: 'flac', mode: 'mix', range: 'project' });
	assert.deepEqual(plan.exportPlan, { format: 'flac', outputFrames: 48_000, version: 1 });
	assert.deepEqual(plan.batch, {
		batchId: 'batch-1', memberId: 'batch-1-1', presetId: 'preset-flac',
		target: { kind: 'project' }, mode: 'mix',
	});
	assert.equal(fixture.calls.describe, 1, 'the ordinary export service owns plan derivation');
});

test('enqueue refuses a generation change after every plan derivation and before IPC', async () => {
	const fixture = persistentFixture({ mutateOnIdentityRead: 2 });
	await fixture.service.selectDestination();
	await assert.rejects(fixture.service.enqueueBatch(deliveryBatch()), /generation|changed/iu);
	assert.equal(fixture.calls.describe, 1, 'the race occurs after the exact plan was derived');
	assert.equal(fixture.calls.enqueue.length, 0, 'no stale admission crosses IPC');
});

test('dirty, unnamed, stale, and unavailable projects refuse without saving', async () => {
	for (const update of [
		{ saveState: 'dirty' },
		{ title: '   ' },
		{ identity: null },
		{ identity: { projectId: 'project-1', projectRevision: 6, projectSha256: PROJECT_SHA } },
	]) {
		const fixture = persistentFixture(update);
		await fixture.service.selectDestination();
		await assert.rejects(fixture.service.enqueueBatch(deliveryBatch()), /saved|named|generation/iu);
		assert.equal(fixture.calls.enqueue.length, 0);
	}
});

test('cancelled destination pickers are no-ops that preserve the prior opaque grant', async () => {
	const initial = persistentFixture({ selectCancelled: true });
	assert.equal(await initial.service.selectDestination(), null);
	const fixture = persistentFixture({ cancelSecondSelection: true, reauthorizeCancelled: true });
	const selected = await fixture.service.selectDestination();
	assert.deepEqual(selected, { grantId: 'cd'.repeat(24) });
	assert.deepEqual(await fixture.service.selectDestination(), selected);
	assert.deepEqual(await fixture.service.reauthorizeDestination('aa'.repeat(24)), selected);
});

test('the restart mirror exposes persistent states, reports, control, order, and same-root reauthorization', async () => {
	const completed = summary({
		jobId: '11'.repeat(24), state: 'completed', batchId: 'batch-restart',
		batchMember: member('11'.repeat(24)),
		result: {
			kind: 'soundscaper-delivery-result', version: 1,
			projectIdentity: {
				projectId: PROJECT.id, projectRevision: PROJECT.revision, projectSha256: PROJECT_SHA,
			},
			planFingerprint: '12'.repeat(32),
			publication: { fileName: 'album.flac', byteLength: 12, sha256: '55'.repeat(32) },
			report: deliveryReport(),
		},
		report: deliveryReport(),
	});
	const failed = summary({
		jobId: '22'.repeat(24), state: 'failed', batchId: 'batch-restart',
		batchMember: member('22'.repeat(24)), lastFailureCode: 'encode-failed',
	});
	const authorization = summary({
		jobId: '33'.repeat(24), state: 'needs-authorization', destinationGrantId: '44'.repeat(24),
	});
	const fixture = persistentFixture({ entries: [completed, failed, authorization], paused: true });
	await fixture.service.refresh();

	assert.equal(fixture.service.list().paused, true);
	assert.deepEqual(fixture.service.list().entries.map(({ state }) => state), [
		'completed', 'failed', 'needs-authorization',
	]);
	assert.equal(fixture.service.report(completed.jobId)?.counts.preserved, 1);
	assert.equal(fixture.service.batchReport('batch-restart')?.counts.preserved, 1);
	assert.deepEqual(await fixture.service.retryBatchFailures('batch-restart'), [failed.jobId]);
	await fixture.service.reauthorizeDestination(authorization.destinationGrantId);
	await fixture.service.pause();
	await fixture.service.resume();
	await fixture.service.cancel(authorization.jobId);
	await fixture.service.retry(failed.jobId);
	await fixture.service.reorder(authorization.jobId, 0);

	assert.deepEqual(fixture.calls.controls, [
		['retry', { jobId: failed.jobId }],
		['reauthorizeDestination', { grantId: authorization.destinationGrantId }],
		['pause', undefined], ['resume', undefined],
		['cancel', { jobId: authorization.jobId }], ['retry', { jobId: failed.jobId }],
		['reorder', { jobId: authorization.jobId, position: 0 }],
	]);
});

function persistentFixture(overrides: Record<string, unknown> = {}) {
	const calls: {
		enqueue: SoundscaperPersistentDeliveryEnqueueRequest[];
		controls: Array<[string, unknown]>; describe: number;
	} = { enqueue: [], controls: [], describe: 0 };
	let entries = Array.isArray(overrides.entries)
		? overrides.entries as SoundscaperPersistentDeliverySummary[]
		: [];
	let paused = Boolean(overrides.paused);
	let selections = 0;
	let identityReads = 0;
	let projectGeneration = 1;
	const identity = Object.hasOwn(overrides, 'identity') ? overrides.identity : {
		projectId: PROJECT.id, projectRevision: PROJECT.revision, projectSha256: PROJECT_SHA,
	};
	const bridge: SoundscaperPersistentDeliveryRendererBridge = {
		selectDestination: async () => {
			selections += 1;
			return overrides.selectCancelled === true
				|| (overrides.cancelSecondSelection === true && selections > 1)
				? null : { grantId: 'cd'.repeat(24) };
		},
		reauthorizeDestination: async (request) => {
			recordControl('reauthorizeDestination', request);
			return overrides.reauthorizeCancelled === true ? null : { grantId: request.grantId };
		},
		currentProjectIdentity: async () => {
			identityReads += 1;
			if (identityReads === overrides.mutateOnIdentityRead) {
				project.revision += 1;
				projectGeneration += 1;
			}
			return identity as never;
		},
		enqueueBatch: async (request) => {
			calls.enqueue.push(request);
			entries = [summary({
				jobId: 'ef'.repeat(24), state: 'queued', batchId: request.items[0]?.batch?.batchId ?? null,
				batchMember: request.items[0]?.batch?.member ?? null,
			})];
			return entries;
		},
		list: async () => ({ entries, paused, nextCursor: null }),
		events: async () => ({ events: [], nextSequence: 0, hasMore: false }),
		pause: async () => { paused = true; recordControl('pause', undefined); },
		resume: async () => { paused = false; recordControl('resume', undefined); },
		reorder: async (request) => { recordControl('reorder', request); },
		cancel: async (request) => { recordControl('cancel', request); },
		retry: async (request) => { recordControl('retry', request); },
	};
	function recordControl(name: string, request: unknown): void {
		calls.controls.push([name, request]);
	}
	const project = { ...PROJECT, title: overrides.title ?? PROJECT.title };
	return {
		calls,
		service: createSoundscaperPersistentDeliveryUiService({
			bridge,
			getProject: () => project,
			getSaveState: () => overrides.saveState ?? 'saved',
			captureProjectGeneration: () => Object.freeze({ generation: projectGeneration, projectId: project.id }),
			assertProjectGeneration: (token) => {
				const observed = token as Readonly<{ generation: number; projectId: string }>;
				if (observed.generation !== projectGeneration || observed.projectId !== project.id) {
					throw new Error('Project generation changed.');
				}
			},
			describeMember: async (batchMember) => {
				calls.describe += 1;
				return {
					settings: batchMember.settings,
					exportPlan: { version: 1, format: batchMember.settings.format, outputFrames: 48_000 },
				};
			},
			publishDocumentSnapshot: () => undefined,
		}),
	};
}

function deliveryBatch() {
	return createDeliveryBatch(PROJECT as never, {
		batchId: 'batch-1', targets: [{ kind: 'project' }],
		presets: [{
			id: 'preset-flac', label: 'FLAC', kind: 'audio', schemaVersion: 1,
			format: 'flac', settings: {}, licensingRowId: null, fallbackPresetId: null,
		}] as never,
	});
}

function member(memberId: string): DeliveryBatchMember {
	return Object.freeze({
		memberId, label: memberId, presetId: 'preset-flac', target: { kind: 'project' as const },
		mode: 'mix', settings: { format: 'flac', mode: 'mix', range: 'project' },
	});
}

function summary(
	overrides: Partial<SoundscaperPersistentDeliverySummary>,
): SoundscaperPersistentDeliverySummary {
	return Object.freeze({
		jobId: '00'.repeat(24), label: 'Delivery', state: 'queued', attempt: 0, progress: null,
		lastFailureCode: null,
		projectIdentity: { projectId: PROJECT.id, projectRevision: PROJECT.revision, projectSha256: PROJECT_SHA },
		planFingerprint: '12'.repeat(32), destinationGrantId: 'cd'.repeat(24),
		batchId: null, batchMember: null, report: null, result: null,
		...overrides,
	}) as SoundscaperPersistentDeliverySummary;
}

function deliveryReport(): DeliveryReport {
	return Object.freeze({
		schemaVersion: 1 as const, format: 'delivery' as const, direction: 'export' as const,
		subject: { format: 'flac', container: 'flac', codec: 'flac', sampleRate: 48_000, channelCount: 2, lossless: true },
		items: [{ code: 'audio', severity: 'info' as const, disposition: 'preserved' as const, scope: { kind: 'mix' }, data: {} }],
		counts: { preserved: 1, converted: 0, missing: 0, omitted: 0 },
	});
}
