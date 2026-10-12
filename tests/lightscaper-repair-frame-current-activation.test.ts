/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { repairBackupCurrentFixture } from './helpers/lightscaper-repair-backup-current-fixture.ts';

for (const placement of ['active', 'redo'] as const) {
	test(`selected native Current Session captures a complete Photo3 with ${placement} repairs through the explicit editable handoff`, async () => {
		const f = await repairBackupCurrentFixture(placement, 1);
		let primary: unknown, failed = false;
		try {
			const before = await f.inspect(), photo = before[0]!;
			assert.equal(photo.schemaVersion, 3);
			const selected = photo.versions.find(version => version.id === photo.activeVersionId)!;
			assert.equal(selected.develop.processVersion, placement === 'active' ? 3 : 1);
			// Before activation this reaches the real selected legacy child. A
			// genuine named Current child replaces that subject without changing
			// fixtures, binding, metadata, Original, or custody assertions.
			const port: unknown = Object.getOwnPropertyDescriptor(f.session, 'imageHandoffCurrent')?.value ?? f.session.imageHandoff;
			assert.ok(port && typeof port === 'object');
			const method: unknown = Object.getOwnPropertyDescriptor(port, 'withCapture')?.value;
			assert.equal(typeof method, 'function');
			let deliveries = 0;
			await Reflect.apply(method as (...args: unknown[]) => unknown, port, [
				{ catalogId: photo.catalogId, photoId: photo.id, versionId: selected.id, expectedRevision: photo.revision },
				async (view: unknown) => {
					deliveries++;
					assert.ok(view && typeof view === 'object');
					const descriptors = Object.getOwnPropertyDescriptors(view);
					assert.equal(descriptors.schemaVersion?.value, 2);
					const facts: unknown = JSON.parse(descriptors.factsJson?.value as string);
					assert.ok(facts && typeof facts === 'object');
					assert.equal(Object.getOwnPropertyDescriptor(facts, 'schemaVersion')?.value, 2);
					assert.equal(Object.getOwnPropertyDescriptor(facts, 'photoSchemaVersion')?.value, 3);
					const version: unknown = Object.getOwnPropertyDescriptor(facts, 'version')?.value;
					assert.ok(version && typeof version === 'object');
					assert.deepEqual(Object.getOwnPropertyDescriptor(version, 'develop')?.value, selected.develop);
					const original: unknown = descriptors.originalBlob?.value;
					assert.ok(original instanceof Blob);
					assert.equal(original.size, photo.original.byteLength);
					assert.equal(await digestMediaContent(original), photo.original.contentSha256);
					assert.deepEqual(new Uint8Array(await original.arrayBuffer()), new Uint8Array(await f.records[0]!.original.arrayBuffer()));
				},
			]);
			assert.equal(deliveries, 1);
			assert.deepEqual(await f.inspect(), before);
		} catch (error) { primary = error; failed = true; }
		const outcomes = await Promise.allSettled([f.close()]);
		const cleanup = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
		if (failed && cleanup.length) throw new AggregateError([primary, ...cleanup], 'Current editable activation and cleanup failed.', { cause: primary });
		if (failed) throw primary;
		if (cleanup.length) throw new AggregateError(cleanup, 'Current editable activation cleanup failed.');
	});
}
