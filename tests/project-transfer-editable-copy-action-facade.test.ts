/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCrossProductHandoffActionFacade } from
	'../src/common/editor/controller/cross-product-handoff-action-facade.ts';

test('the desktop action facade owns one cancellable operation and clears it after abort', async () => {
	let started!: () => void;
	const operationStarted = new Promise<void>((resolve) => { started = resolve; });
	const facade = createCrossProductHandoffActionFacade({
		copy: { projectSaving: 'Saving project' },
		getProject: () => null,
		assertProjectHandoffAllowed: () => undefined,
		flushProject: () => undefined,
		store: {},
		fileService: { saveFile: () => undefined },
	}, {
		loadAction: () => async (_scope, _intent, { signal }) => {
			started();
			await new Promise<never>((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
			throw new Error('unreachable');
		},
	});

	assert.equal(facade.crossProductCopyActive(), false);
	const pending = facade.saveCrossProductCopy({ intent: true });
	await operationStarted;
	assert.equal(facade.crossProductCopyActive(), true);
	await assert.rejects(facade.saveCrossProductCopy({ another: true }), /already in progress/iu);
	assert.equal(facade.cancelCrossProductCopy(), true);
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(facade.crossProductCopyActive(), false);
	assert.equal(facade.cancelCrossProductCopy(), false);
});
