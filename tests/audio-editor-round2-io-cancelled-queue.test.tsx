/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createDeliveryQueueService } from '../src/common/editor/controller/export/internal/delivery/delivery-queue-service.ts';
import { DeliveryQueueDialog } from '../src/common/editor/ui/inspector/DeliveryQueueDialog.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the delivery row can retry its own canceled job without delivering another job', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const delivered: string[] = [];
	const queue = createDeliveryQueueService({
		handleExportAction: (action, settings) => {
			assert.equal(action, 'start');
			const format = (settings as { format: string }).format;
			delivered.push(format);
			return { fileName: `master.${format}` };
		},
	});
	queue.pause();
	const first = queue.enqueue({ label: 'First WAV', settings: { format: 'wav' } });
	const second = queue.enqueue({ label: 'Second AIFF', settings: { format: 'aiff' } });
	queue.cancel(first);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<DeliveryQueueDialog isOpen
			controller={{ actions: { export: { queue, presets: { list: () => [] } } } }}
			snapshot={{ selection: null, project: { loop: { enabled: false } } }}
			copy={ENGLISH_COPY} onClose={() => undefined} />));
		const row = dom.one(`[data-delivery-queue-job="${first}"]`);
		assert.match(row.textContent, /Cancelled/u);
		const retry = row.querySelectorAll('button').find(button => button.textContent === 'Retry');
		assert.ok(retry, 'cancellation remains recoverable from the same delivery row');
		await act(async () => { reactProps(retry).onClick(); });
		assert.equal(queue.list().entries.find(entry => entry.jobId === first)?.state, 'queued');
		assert.equal(queue.list().entries.find(entry => entry.jobId === second)?.attempt, 0);
		assert.deepEqual(delivered, []);
		queue.cancel(second);
		queue.resume();
		await queue.settled();
		assert.deepEqual(delivered, ['wav']);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
