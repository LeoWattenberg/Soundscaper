/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryExportJournalAccess, PhotoLibraryExportJournalSettings } from '../src/common/editor/photo-library-session-port-v2.ts';
import { PhotoRasterExportJournalErrorV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { PhotoRasterExportJournalOwnerCurrentV1 as PhotoRasterExportJournalOwnerV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-current-v1.ts';
import { createPhotoRasterExportJournalV1, normalizePhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { readPhotoRasterExportBindingCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

// Initial behavioral RED uses the existing owner against genuine Current
// native Session accesses. Only the explicit Current owner changes after GO.
type Fixture = Awaited<ReturnType<typeof repairRasterFixture>>;
type Owner = PhotoRasterExportJournalOwnerV1;
const observe = <Value>(work: Promise<Value>) => work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

async function plan(f: Fixture, sidecarEnabled: boolean) {
	const photo = f.photos[0]!, request = { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision };
	const binding = await readPhotoRasterExportBindingCurrentV1(request, f.readSidecar, new AbortController().signal, sidecarEnabled);
	const batch = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'native-current-claim', format: 'png', filenameTemplate: '{name}',
		...(sidecarEnabled ? { sidecarEnabled: true } : {}), members: [{ photoId: photo.id, versionId: photo.activeVersionId,
			expectedRevision: photo.revision, sourceFileName: photo.metadata.fileName }] });
	return createPhotoRasterExportJournalV1(batch, { catalogId: photo.catalogId, filenameTemplate: '{name}', bindings: [binding] });
}
async function prepare(f: Fixture, first: Owner, second: Owner, companion: boolean) {
	await first.create(await plan(f, companion));
	const member = first.current!.members[0]!;
	if (companion) {
		await first.started(member.jobId);
		// Establish the wire's prior raster ACK; this is a scalar-state fixture,
		// not a claim that this test delivered or decoded an image.
		await first.committed(member.jobId, { status: 'download-started', method: 'download', fileName: member.fileName, size: 4 });
	}
	await second.load(); assert.deepEqual(second.current, first.current); return member.jobId;
}
function assertNoPixelOwner(f: Fixture): void {
	assert.equal(f.codecs.calls.opens, 0); assert.deepEqual(f.events, []);
	assert.equal(f.encoded.length, 0); assert.equal(f.outputs.length, 0); assert.equal(f.borrowed.length, 0);
}
async function durable(access: Readonly<PhotoLibraryExportJournalAccess>) {
	return normalizePhotoRasterExportJournalV1(await access.settings.get(photoRasterExportJournalKeyV1(access.catalogId)));
}

for (const companion of [false, true]) test(`native Current ${companion ? 'JSON companion' : 'image'} claim grants exactly one authorization across identical overlapping owner transitions`, async () => {
	const f = await repairRasterFixture(), release = deferred<void>(), entered = deferred<void>();
	const controls = { hold: false }, owners: Owner[] = [], nativeACKs: Array<Readonly<{ writer: 'first' | 'second'; ack: boolean }>> = [];
	const work: { first?: Promise<unknown>; second?: Promise<unknown> } = {};
	try {
		assert.ok(f.session.exportJournalCurrent);
		const firstAccess = await f.session.exportJournalCurrent.open(), secondAccess = await f.session.exportJournalCurrent.open();
		assert.equal(firstAccess.catalogId, f.photos[0]!.catalogId); assert.equal(secondAccess.catalogId, firstAccess.catalogId);
		const firstReplace = firstAccess.settings.replaceIfCurrent, secondReplace = secondAccess.settings.replaceIfCurrent;
		const firstSettings: PhotoLibraryExportJournalSettings = { ...firstAccess.settings, async replaceIfCurrent(...args) {
			const ack = await Reflect.apply(firstReplace, firstAccess.settings, args) as boolean;
			if (controls.hold) { nativeACKs.push({ writer: 'first', ack }); entered.resolve(); await release.promise; } return ack;
		} };
		const secondSettings: PhotoLibraryExportJournalSettings = { ...secondAccess.settings, async replaceIfCurrent(...args) {
			const ack = await Reflect.apply(secondReplace, secondAccess.settings, args) as boolean; nativeACKs.push({ writer: 'second', ack }); return ack;
		} };
		const first = new PhotoRasterExportJournalOwnerV1(firstSettings, firstAccess.catalogId), second = new PhotoRasterExportJournalOwnerV1(secondSettings, secondAccess.catalogId);
		owners.push(first, second); const jobId = await prepare(f, first, second, companion), before = first.current!;
		controls.hold = true;
		const firstWork = observe(companion ? first.sidecarStarted(jobId) : first.started(jobId)); work.first = firstWork;
		assert.equal(await Promise.race([entered.promise.then(() => true), firstWork.then(() => false)]), true);
		// The second native CAS runs while the first positive ACK is still held:
		// explicit false must not become authority merely by matching that row.
		const secondWork = observe(companion ? second.sidecarStarted(jobId) : second.started(jobId)); work.second = secondWork;
		const secondResult = await secondWork; release.resolve(); const firstResult = await firstWork;
		assert.deepEqual(nativeACKs, [{ writer: 'first', ack: true }, { writer: 'second', ack: false }]);
		const stored = await durable(secondAccess); assert.equal(stored.revision, before.revision + 1);
		assert.equal(companion ? stored.members[0]!.sidecar!.state : stored.members[0]!.state, 'started');
		assertNoPixelOwner(f);
		assert.equal(Number(firstResult.ok) + Number(secondResult.ok), 1);
		assert.equal(firstResult.ok, true); assert.equal(secondResult.ok, false);
		const reopened = new PhotoRasterExportJournalOwnerV1((await f.session.exportJournalCurrent.open()).settings, firstAccess.catalogId); owners.push(reopened);
		assert.deepEqual(await reopened.load(), stored);
		await assert.rejects(companion ? reopened.sidecarStarted(jobId) : reopened.started(jobId)); assertNoPixelOwner(f);
	} finally {
		release.resolve(); await Promise.allSettled([work.first, work.second]); await Promise.all(owners.map(owner => owner.closeAndJoin())); await f.close();
	}
});

test('native Current lost returned CAS ACK preserves durable uncertainty without authorizing a fresh image', async () => {
	const f = await repairRasterFixture(), owners: Owner[] = [], controls = { loseACK: false }, nativeACKs: boolean[] = [];
	const primary = Proxy.revocable({}, {}); primary.revoke();
	try {
		assert.ok(f.session.exportJournalCurrent); const access = await f.session.exportJournalCurrent.open(), nativeReplace = access.settings.replaceIfCurrent;
		const settings: PhotoLibraryExportJournalSettings = { ...access.settings, async replaceIfCurrent(...args) {
			const ack = await Reflect.apply(nativeReplace, access.settings, args) as boolean; nativeACKs.push(ack);
			if (controls.loseACK) throw primary.proxy; return ack;
		} };
		const owner = new PhotoRasterExportJournalOwnerV1(settings, access.catalogId); owners.push(owner); await owner.create(await plan(f, false));
		const member = owner.current!.members[0]!, before = owner.current!; controls.loseACK = true;
		const result = await observe(owner.started(member.jobId)); assert.deepEqual(nativeACKs, [true]);
		const stored = await durable(access); assert.equal(stored.revision, before.revision + 1); assert.equal(stored.members[0]!.state, 'started');
		assertNoPixelOwner(f); assert.equal(result.ok, false);
		if (!result.ok) { assert.ok(result.error instanceof PhotoRasterExportJournalErrorV1); assert.equal(result.error.failure.cause === primary.proxy, true); }
		const reopened = new PhotoRasterExportJournalOwnerV1((await f.session.exportJournalCurrent.open()).settings, access.catalogId); owners.push(reopened);
		assert.deepEqual(await reopened.load(), stored); await assert.rejects(reopened.started(member.jobId)); assertNoPixelOwner(f);
	} finally { await Promise.all(owners.map(owner => owner.closeAndJoin())); await f.close(); }
});
