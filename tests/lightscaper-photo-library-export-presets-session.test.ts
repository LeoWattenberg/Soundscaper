/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

import type { PhotoLibraryExportPresetsAccessV1, PhotoRasterExportPresetV1, PhotoExportPresetCommandV1 } from '../src/common/editor/photo-library-export-presets-port-v1.ts';
const RECIPE: PhotoRasterExportPresetV1 = Object.freeze({ schemaVersion: 1, id: 'preset-1', name: 'Small capture', format: 'png', filenameTemplate: 'Chosen {index:3}-{name}',
	output: { sizing: { kind: 'percentage' as const, percentage: 50 }, quality: 'nearest' as const, metadataScope: 'capture' as const, sharpen: { amount: 37, threshold: 9 } }, sidecarEnabled: true });
async function fixture() {
	const f = await currentDevelopFixture(1); let closed = 0;
	const ports: PhotoLibrarySessionPortsV2 & { exportPresetSettings: typeof f.settings } = {
		catalog: f.repository, stacks: f.repository, smartCollections: f.repository,
		initialize: async () => { const root = await f.repository.loadCatalog('catalog-1'); assert.ok(root); return root; },
		closeResources: async () => { closed++; }, journal: f.settings, settings: f.settings, exportPresetSettings: f.settings,
		media: { writeAsset: async () => assert.fail('Preset cannot write bodies'), custody: {
			findDigestPage: async () => ({ matches: [], afterAssetId: null }), stage: async () => undefined, promote: async () => undefined,
			releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }),
		} },
	};
	return { ...f, ports, closed: () => closed };
}
async function presets(session: PhotoLibrarySessionV2): Promise<Readonly<PhotoLibraryExportPresetsAccessV1>> {
	assert.ok(session.exportPresets, 'Actual selected Session must expose export preset persistence'); return session.exportPresets.open();
}

test('actual selected Session saves, closes, reopens, applies the scalar recipe and deletes it durably', async () => {
	const f = await fixture(), first = new PhotoLibrarySessionV2(f.ports); let second: PhotoLibrarySessionV2 | null = null;
	try {
		const before = await first.readPage(), port = await presets(first), empty = await port.list({ schemaVersion: 1 });
		assert.equal(empty.catalogId, 'catalog-1'); assert.equal(empty.revision, 0);
		const saved = await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: RECIPE } });
		assert.equal(saved.snapshot.revision, 1); await first.close(); assert.equal(f.closed(), 1);
		second = new PhotoLibrarySessionV2(f.ports);
		const reopened = await presets(second), listed = await reopened.list({ schemaVersion: 1 });
		assert.deepEqual(listed.presets, [{ id: 'preset-1', name: 'Small capture' }]);
		const { preset } = await reopened.read({ schemaVersion: 1, presetId: 'preset-1', expectedRevision: listed.revision });
		assert.deepEqual(preset, RECIPE); // Applying lends detached scalar settings, never a photo or native destination.
		assert.deepEqual(await second.readPage(), before);
		await reopened.write({ schemaVersion: 1, command: { type: 'delete', expectedRevision: listed.revision, presetId: 'preset-1' } });
		assert.deepEqual((await reopened.list({ schemaVersion: 1 })).presets, []);
	} finally { await first.close(); await second?.close(); await f.close(); }
});

test('actual Session refuses request getters before storage I/O and does not hold a writer across returned methods', async () => {
	const f = await fixture(), initialize = f.ports.initialize; let initialized = 0, getters = 0;
	const session = new PhotoLibrarySessionV2({ ...f.ports, initialize: async signal => { initialized++; return initialize(signal); } });
	try {
		const port = await presets(session); const before = initialized;
		const command = { schemaVersion: 1 as const, get command(): PhotoExportPresetCommandV1 { getters++; throw new Error('Getter called'); } };
		await assert.rejects(port.write(command), TypeError); assert.equal(getters, 0); assert.equal(initialized, before);
		await session.setRating('photo-1', 4); // Merely retaining the preset port owns no exclusive writer.
		assert.equal((await session.readPage()).rows[0]?.rating, 4);
	} finally { await session.close(); await f.close(); }
});
test('Session close joins held real preset CAS and preserves its known ACK through late lease failure', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), primary = Symbol('late lease cleanup'); let armed = false;
	const settings = f.ports.exportPresetSettings;
	const ports = { ...f.ports, exportPresetSettings: { get: settings.get.bind(settings), readEntry: settings.readEntry.bind(settings), replaceIfCurrent: settings.replaceIfCurrent.bind(settings),
		async putIfAbsent(key: string, next: unknown) { entered.resolve(); await release.promise; return settings.putIfAbsent(key, next); } },
		exclusive: async <Result,>(_id: string, run: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> => {
			assert.ok(signal); const result = await run(signal); if (armed) throw primary; return result;
		} };
	const session = new PhotoLibrarySessionV2(ports), port = await presets(session); armed = true;
	const work = port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: RECIPE } });
	try {
		await entered.promise; const closing = session.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.closed(), 0);
		release.resolve(); const ack = await work; assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.notices, ['cleanup-failed']);
		await closing; assert.equal(f.closed(), 1); await assert.rejects(port.list({ schemaVersion: 1 }), /closed/u);
	} finally { release.resolve(); await work.catch(() => undefined); await session.close(); await f.close(); }
});
