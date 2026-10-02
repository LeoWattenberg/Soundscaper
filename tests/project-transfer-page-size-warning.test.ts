/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferView } from '../src/common/transfer/transfer-page-view.ts';
import { createTransferPageSizeWarning } from '../src/common/transfer/transfer-page-size-warning.ts';
import { FakeDocument, settle } from './project-transfer-page-fixture.ts';

const warning = { label: 'Project archive', byteLength: 1024 ** 3, thresholdBytes: 512 * 1024 ** 2 };

test('the transfer page shows the file size and resolves Continue and Cancel independently', async () => {
	const document = new FakeDocument();
	const view = createTransferView(document as unknown as Document, 'Transfer', 'Summary');
	const confirmation = createTransferPageSizeWarning(view);
	const accepted = confirmation.confirm(warning);
	assert.ok(document.body.buttonLabels().includes('Continue'));
	assert.match(document.body.textContent, /1 GiB/u);
	assert.match(document.body.textContent, /512 MiB/u);
	await document.body.clickButton('Continue');
	assert.equal(await accepted, true);
	const declined = confirmation.confirm(warning);
	await document.body.clickButton('Cancel');
	assert.equal(await declined, false);
	confirmation.dispose();
});

test('an aborted transfer removes its pending size confirmation', async () => {
	const document = new FakeDocument();
	const view = createTransferView(document as unknown as Document, 'Transfer', 'Summary');
	const confirmation = createTransferPageSizeWarning(view);
	const operation = new AbortController();
	const decision = confirmation.confirm(warning, { signal: operation.signal });
	const rejected = assert.rejects(decision, { name: 'AbortError' });
	operation.abort();
	await rejected;
	await settle();
	assert.equal(document.body.querySelector('[data-transfer-confirm]')?.textContent, '');
	confirmation.dispose();
});
