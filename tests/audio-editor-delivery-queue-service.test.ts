/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeliveryQueueService } from '../src/common/editor/controller/delivery-queue-service.ts';
import { createExportActionGroup } from '../src/common/editor/controller/export-action-group.ts';

function harness(runExport?: (settings: unknown) => Promise<unknown> | unknown) {
	const calls: Array<[string, unknown]> = [];
	let ids = 0;
	const state: Record<string, unknown> = {};
	let published = 0;
	const service = createDeliveryQueueService({
		handleExportAction: async (action, settings) => {
			calls.push([action, settings]);
			if (action === 'start' && runExport) return runExport(settings);
			return undefined;
		},
		publishDocumentSnapshot: () => { published += 1; },
		createId: (prefix) => `${prefix}-${++ids}`,
		state,
	});
	return { service, calls, state, published: () => published };
}

test('a queued delivery runs through the ordinary export action', async () => {
	const { service, calls } = harness();
	service.enqueue({ label: 'Master', settings: { format: 'wav' } });
	await service.settled();
	assert.deepEqual(calls, [['start', { format: 'wav' }]], 'a batch member is one ordinary export');
	assert.equal(service.list().entries[0].state, 'completed');
});

test('members run one at a time in order, each with its own settings', async () => {
	const { service, calls } = harness();
	service.enqueue({ label: 'A', settings: { format: 'wav' } });
	service.enqueue({ label: 'B', settings: { format: 'mp3' } });
	await service.settled();
	assert.deepEqual(calls.map(([, settings]) => settings), [{ format: 'wav' }, { format: 'mp3' }]);
	assert.deepEqual(service.list().entries.map(({ state }) => state), ['completed', 'completed']);
});

test('every web-tier job declares atomic restart rather than a resume it cannot honour', () => {
	const { service } = harness();
	service.enqueue({ label: 'A' });
	assert.equal(service.list().entries[0].recoveryClass, 'atomic-restart');
	assert.equal(service.list().entries[0].taskKind, 'encoded-export');
});

test('a failing member does not strand the rest of the batch', async () => {
	const { service } = harness((settings) => {
		if ((settings as { format?: string })?.format === 'mp3') throw new Error('encoder fault');
		return undefined;
	});
	service.enqueue({ label: 'A', settings: { format: 'wav' } });
	service.enqueue({ label: 'B', settings: { format: 'mp3' } });
	service.enqueue({ label: 'C', settings: { format: 'flac' } });
	await service.settled();
	assert.deepEqual(
		service.list().entries.map(({ state }) => state),
		['completed', 'failed', 'completed'],
	);
});

test('cancelling a running member also cancels the export it is running', async () => {
	let release = () => undefined;
	const blocked = new Promise((resolve) => { release = resolve as () => undefined; });
	const { service, calls } = harness(() => blocked);
	service.enqueue({ label: 'A' });
	await Promise.resolve();

	service.cancel(service.list().entries[0].jobId);
	assert.ok(
		calls.some(([action]) => action === 'cancel'),
		'the queue must stop the render, not merely mark the row',
	);
	release();
	await service.settled();
	assert.equal(service.list().entries[0].state, 'cancelled');
});

test('cancelling a finished member is refused rather than silently ignored', async () => {
	const { service } = harness();
	service.enqueue({ label: 'A' });
	await service.settled();
	assert.throws(
		() => service.cancel(service.list().entries[0].jobId),
		/already completed/u,
		'a delivery that already happened cannot be un-delivered',
	);
});

test('queue state is published so the snapshot never has to poll', async () => {
	const { service, state, published } = harness();
	service.enqueue({ label: 'A' });
	await service.settled();
	assert.ok(published() >= 3, 'queued, running, and completed each publish');
	const queue = state.deliveryQueue as { entries: Array<{ label: string }> };
	assert.equal(queue.entries[0].label, 'A');
});

test('queue entries stay small status rows and never carry delivery settings', async () => {
	const { service } = harness();
	service.enqueue({ label: 'A', settings: { format: 'wav', metadataTitle: 'x'.repeat(500) } });
	await service.settled();
	const serialized = JSON.stringify(service.list());
	assert.ok(!serialized.includes('xxxxx'), 'settings must not ride on the queue record');
	assert.ok(serialized.length < 512);
});

test('the export action group exposes every delivery surface the menus bind to', () => {
	const group = createExportActionGroup({
		handleExportAction: () => undefined,
		state: {},
		persistSetting: () => undefined,
	});
	assert.deepEqual(
		Object.keys(group).sort(),
		['cancel', 'exportEdl', 'exportFcpxml', 'exportOtio', 'presets', 'queue', 'saveReport', 'start'],
		'a surface missing here is a menu entry bound to undefined',
	);
});

test('the queue service refuses to exist without the export action', () => {
	assert.throws(() => createDeliveryQueueService({} as never), /requires the export action/u);
});

test('cancelling a queued member leaves the running one alone', async () => {
	// The cancel reached whichever member happened to be rendering, which is a
	// different job than the one the operator pointed at.
	let releaseFirst: () => void = () => undefined;
	const { service, calls } = harness(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
	const first = service.enqueue({ label: 'A', settings: { format: 'wav' } });
	const second = service.enqueue({ label: 'B', settings: { format: 'mp3' } });
	await Promise.resolve();

	service.cancel(second);
	assert.deepEqual(calls.map(([action]) => action), ['start'], 'the running export is untouched');
	releaseFirst();
	await service.settled();

	assert.deepEqual(service.list().entries.map(({ jobId, state }) => [jobId, state]), [
		[first, 'completed'], [second, 'cancelled'],
	]);
});

test('a batch queues its members in order, each as an ordinary delivery', async () => {
	const { service, calls } = harness();
	const batch = {
		batchId: 'batch-1',
		members: [
			{ memberId: 'batch-1-1', label: 'Mix — WAV', presetId: 'wav', target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format: 'wav', range: 'project' } },
			{ memberId: 'batch-1-2', label: 'Mix — MP3', presetId: 'mp3', target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format: 'mp3', range: 'project' } },
		],
	};
	assert.deepEqual(service.enqueueBatch(batch), ['batch-1-1', 'batch-1-2']);
	await service.settled();

	assert.deepEqual(calls.map(([, settings]) => (settings as { format: string }).format), ['wav', 'mp3']);
	assert.equal(service.batchIdForJob('batch-1-2'), 'batch-1');
	const report = service.batchReport('batch-1');
	assert.deepEqual(report.items.map(({ data }) => data.state), ['delivered', 'delivered']);
});

test('a partial batch publishes what delivered and reports the rest, then retries only those', async () => {
	const { service } = harness((settings) => {
		if ((settings as { format?: string })?.format === 'mp3') throw new Error('encoder fault');
		return { fileName: 'album-mix.wav' };
	});
	const member = (index: number, format: string) => ({
		memberId: `batch-1-${index}`, label: `Member ${index}`, presetId: format,
		target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format },
	});
	const batch = { batchId: 'batch-1', members: [member(1, 'wav'), member(2, 'mp3'), member(3, 'flac')] };
	service.enqueueBatch(batch);
	await service.settled();

	const report = service.batchReport('batch-1');
	assert.deepEqual(report.items.map(({ data }) => data.state), ['delivered', 'failed', 'delivered']);
	assert.equal(report.items[0].data.fileName, 'album-mix.wav');
	assert.equal(report.items[1].data.fileName, null, 'a failed member published nothing');

	assert.deepEqual(service.retryBatchFailures('batch-1'), ['batch-1-2'],
		'only the member that did not deliver is re-run');
	await service.settled();
	assert.equal(service.batchReport('batch-1').items[1].data.state, 'failed');
	assert.equal(
		service.list().entries.find(({ jobId }) => jobId === 'batch-1-2')?.attempt,
		2,
		'the retried member ran a second time; the delivered ones did not',
	);
});

test('a batch report names every member, including ones the queue never reached', async () => {
	const { service } = harness();
	const batch = {
		batchId: 'batch-1',
		members: [
			{ memberId: 'batch-1-1', label: 'A', presetId: 'wav', target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format: 'wav' } },
			{ memberId: 'batch-1-2', label: 'B', presetId: 'wav', target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format: 'wav' } },
		],
	};
	service.pause();
	service.enqueueBatch(batch);
	assert.deepEqual(service.batchReport('batch-1').items.map(({ data }) => data.state), [
		'not-started', 'not-started',
	]);
	assert.throws(() => service.batchReport('batch-9'), /is not queued/u);
	service.resume();
	await service.settled();
	assert.deepEqual(service.batchReport('batch-1').items.map(({ data }) => data.state), [
		'delivered', 'delivered',
	]);
});

test('a member report is captured per member rather than shared with the batch', async () => {
	const sealed = { schemaVersion: 1, format: 'delivery', items: [] };
	const calls: unknown[] = [];
	const state: Record<string, unknown> = {};
	const service = createDeliveryQueueService({
		handleExportAction: (action, settings) => {
			calls.push(action);
			if (action === 'start') state.deliveryReport = { ...sealed, subject: settings };
			return { fileName: 'out.wav' };
		},
		state,
	});
	service.enqueueBatch({
		batchId: 'b',
		members: [
			{ memberId: 'b-1', label: 'A', presetId: 'wav', target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format: 'wav' } },
			{ memberId: 'b-2', label: 'B', presetId: 'mp3', target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format: 'mp3' } },
		],
	});
	await service.settled();

	const reports = service.batchReport('b').items.map(({ data }) => (data.report as { subject: unknown }).subject);
	assert.deepEqual(reports, [{ format: 'wav' }, { format: 'mp3' }],
		'each member carries the report of its own delivery');
});

test('a batch killed mid-flight publishes nothing partial and returns the member whole', () => {
	// The web tier's queue is in-session, so its whole recovery story is atomic
	// restart: the member that was rendering when the session died published
	// nothing, and the report says it was not delivered rather than that it was.
	let inFlight: (() => void) | null = null;
	const { service } = harness((settings) => {
		if ((settings as { format?: string })?.format !== 'mp3') return { fileName: 'member.out' };
		return new Promise<void>((resolve) => { inFlight = resolve; });
	});
	const member = (index: number, format: string) => ({
		memberId: `batch-1-${index}`, label: `Member ${index}`, presetId: format,
		target: { kind: 'project' as const }, mode: 'mix' as const, settings: { format },
	});
	service.enqueueBatch({
		batchId: 'batch-1', members: [member(1, 'wav'), member(2, 'mp3'), member(3, 'flac')],
	});

	return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve()).then(() => {
		assert.equal(service.list().entries[1].state, 'running', 'the second member is mid-flight');
		assert.deepEqual(service.batchReport('batch-1').items.map(({ data }) => data.state), [
			'delivered', 'not-started', 'not-started',
		], 'a running member has delivered nothing yet');
		assert.equal(service.batchReport('batch-1').items[1].data.fileName, null);

		service.recover();
		assert.deepEqual(service.list().entries.map(({ state }) => state), [
			'completed', 'queued', 'queued',
		], 'the interrupted member returns whole, never half-done');
		assert.equal(
			service.list().entries[1].lastFailureCode, null,
			'and is not labelled with a failure it did not have',
		);
		assert.deepEqual(service.retryBatchFailures('batch-1'), ['batch-1-2', 'batch-1-3'],
			'a re-run covers exactly what did not deliver');
		inFlight?.();
	});
});
