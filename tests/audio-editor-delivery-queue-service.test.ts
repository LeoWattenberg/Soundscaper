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

test('the export action group exposes start, cancel, report, presets, and queue', () => {
	const group = createExportActionGroup({
		handleExportAction: () => undefined,
		state: {},
		persistSetting: () => undefined,
	});
	assert.deepEqual(Object.keys(group).sort(), ['cancel', 'presets', 'queue', 'saveReport', 'start']);
});

test('the queue service refuses to exist without the export action', () => {
	assert.throws(() => createDeliveryQueueService({} as never), /requires the export action/u);
});
