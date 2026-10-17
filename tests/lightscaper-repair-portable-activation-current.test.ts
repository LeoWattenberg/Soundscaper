/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';

// The baseline reaches the actual selected Current Session, native catalog and
// Original custody. It imports no future archive or replacement backup owner.
test('actual Current Session backs up complete repaired Photos using archive7 without changing source custody', async () => {
	const f = await repairSettingsFixture();
	let primary: unknown, failed = false;
	try {
		const before = await f.inspect();
		assert.equal(before[0]!.photo.schemaVersion, 3);
		assert.ok(before[0]!.photo.versions.some(version => version.develop.processVersion === 3));
		const result = await f.session.backupCatalog();
		assert.ok(result.blob instanceof Blob);
		assert.equal(result.photoCount, before.length);
		assert.deepEqual(result.notices, []);
		const reader = new ZipReader(new BlobReader(result.blob), { useWebWorkers: false });
		try {
			const entries = await reader.getEntries();
			const project = entries.find(entry => entry.filename === 'project.json');
			assert.ok(project && !project.directory);
			const document: unknown = JSON.parse(new TextDecoder().decode(await project.getData(new Uint8ArrayWriter())));
			assert.ok(document && typeof document === 'object');
			assert.equal(Object.getOwnPropertyDescriptor(document, 'schemaVersion')?.value, 7);
		} finally { await reader.close(); }
		assert.deepEqual(await f.inspect(), before);
	} catch (error) { primary = error; failed = true; }
	const outcomes = await Promise.allSettled([f.close()]);
	const cleanup = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
	if (failed && cleanup.length) throw new AggregateError([primary, ...cleanup], 'Portable activation and cleanup failed.', { cause: primary });
	if (failed) throw primary;
	if (cleanup.length) throw new AggregateError(cleanup, 'Portable activation cleanup failed.');
});
