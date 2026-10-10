/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { CreatePhotoLibrarySessionV3, PhotoLibrarySessionPortV2 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibraryMetadataSnapshotV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

function fixture(catalogId = 'catalog-first') {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected metadata fixture mutation.'); };
	const snapshot: PhotoLibraryMetadataSnapshotV1 = Object.freeze({ photoId: 'photo', revision: 3,
		metadata: photoArchiveFixture().photo.metadata, extracted: null, originalFileName: 'original.png', originalSha256: 'a'.repeat(64) });
	const lifetime = new PhotoLibrarySessionLifetime();
	const port: PhotoLibrarySessionPortV2 = { ...createImportTestPort(),
		develop: { schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId, photoId: 'photo', revision: 3,
			activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
			develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: unexpected },
		developImport: { schemaVersion: 2, listPresets: unexpected, importFiles: unexpected },
		cubeLuts: { schemaVersion: 1, source: { withBytes: unexpected }, importFile: unexpected },
		readMetadata: (photoId, options) => lifetime.operation(async signal => {
			signal.throwIfAborted(); assert.equal(photoId, 'photo'); return snapshot;
		}, options?.signal), close: () => lifetime.close(async () => undefined) };
	return { port, snapshot, lifetime };
}
async function mount(initial: CreatePhotoLibrarySessionV3) {
	let factory = initial, workflow: ReturnType<typeof usePhotoLibraryWorkflowV2> | null = null;
	function Harness() { workflow = usePhotoLibraryWorkflowV2(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	return { ...mounted, get current() { assert.ok(workflow); return workflow; },
		async replace(next: CreatePhotoLibrarySessionV3) { factory = next; await mounted.render(); } };
}

test('export metadata reads through the same native receiver while the real workflow action is busy', async context => {
	const f = fixture(), mounted = await mount(async () => f.port); let metadataCalls = 0, developCalls = 0;
	const nativeRead = f.port.readMetadata, nativeDevelop = f.port.develop.read;
	f.port.readMetadata = function (...args) { assert.equal(this, f.port); metadataCalls++; return Reflect.apply(nativeRead, this, args); };
	context.mock.method(f.port.develop, 'read', function (this: typeof f.port.develop, ...args: Parameters<typeof nativeDevelop>) {
		assert.equal(this, f.port.develop); developCalls++; return Reflect.apply(nativeDevelop, this, args);
	});
	try {
		await act(async () => { const status = await mounted.current.executeDevelop(async context => {
			const result = await mounted.current.readExportMetadata('photo', 3, { signal: context.signal });
			assert.equal(result.catalogId, 'catalog-first'); assert.deepEqual(result.snapshot, f.snapshot);
			assert.deepEqual(Object.keys(result.snapshot).sort(), Object.keys(f.snapshot).sort());
		}); assert.equal(status, 'completed'); });
		assert.equal(metadataCalls, 1); assert.equal(developCalls, 1); assert.equal(mounted.current.metadata, null);
	} finally { await mounted.dispose(); }
});

test('held metadata from a replaced library cannot escape with the same photo and revision', async () => {
	const first = fixture(), second = fixture('catalog-second'), entered = deferred<void>(), release = deferred<void>();
	let firstClosed = false, secondReads = 0;
	first.port.readMetadata = (_photoId, options) => first.lifetime.operation(async () => { entered.resolve(); await release.promise; return first.snapshot; }, options?.signal);
	first.port.close = () => first.lifetime.close(async () => { firstClosed = true; });
	const secondRead = second.port.readMetadata;
	second.port.readMetadata = (...args) => { secondReads++; return Reflect.apply(secondRead, second.port, args); };
	const mounted = await mount(async () => first.port), stop = new AbortController();
	const reading = mounted.current.readExportMetadata('photo', 3, { signal: stop.signal });
	const rejected = assert.rejects(reading, { name: 'AbortError' });
	try {
		await entered.promise; await mounted.replace(async () => second.port);
		assert.equal(firstClosed, false); assert.equal(await remainsPending(reading), true);
		release.resolve(); await rejected; await settle(); assert.equal(firstClosed, true);
		const next = await mounted.current.readExportMetadata('photo', 3, { signal: new AbortController().signal });
		assert.equal(next.catalogId, 'catalog-second'); assert.equal(secondReads, 1);
	} finally { release.resolve(); await rejected; await mounted.dispose(); }
});

test('retired caller cancellation is checked before a replacement slot can be acquired', async () => {
	const first = fixture(), second = fixture('catalog-second'), mounted = await mount(async () => first.port);
	const stop = new AbortController(), reason = Symbol('old export'); let opens = 0;
	try {
		const oldRead = mounted.current.readExportMetadata;
		stop.abort(reason); await mounted.replace(async () => { opens++; return second.port; });
		await assert.rejects(oldRead('photo', 3, { signal: stop.signal }), error => error === reason);
		assert.equal(opens, 0);
	} finally { await mounted.dispose(); }
});

test('export metadata refuses mismatched snapshot photo or revision without mutating the library', async () => {
	for (const change of [{ photoId: 'other' }, { revision: 4 }]) {
		const f = fixture(), mounted = await mount(async () => f.port);
		f.port.readMetadata = async () => ({ ...f.snapshot, ...change });
		try { await assert.rejects(mounted.current.readExportMetadata('photo', 3, { signal: new AbortController().signal }), /identity|revision/iu); }
		finally { await mounted.dispose(); }
	}
});
