/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

test('persistent delivery waits for an unowned video export to become idle', async () => {
	const fixture = createFixture();
	let aborted = false;
	const exportAbort = {
		signal: new AbortController().signal,
		abort: () => { aborted = true; },
	};
	fixture.state.exportAbort = exportAbort;
	const service = createEditorExportService(fixture.runtime);

	assert.equal(service.persistentAudioDeliveryAvailable(), false);
	let notified = false;
	const idle = service.whenPersistentAudioDeliveryAvailable().then(() => { notified = true; });
	await Promise.resolve();
	assert.equal(notified, false);

	await service.cancelPersistentAudioDelivery();
	assert.equal(aborted, false);
	assert.equal(fixture.state.exportAbort, exportAbort);

	await service.handleExportAction('cancel');
	await idle;
	assert.equal(aborted, true);
	assert.equal(fixture.state.exportAbort, null);
	assert.equal(service.persistentAudioDeliveryAvailable(), true);
});
