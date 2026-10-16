/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopPreviewCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopPreviewCurrentV1.tsx';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoDevelopPresentationSnapshotCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

const WHITE = [255, 255, 255, 255], HALF = [188, 188, 188, 255], QUARTER = [137, 137, 137, 255];
type Owner = PhotoLibraryDevelopPresentationCurrentV1;
type Snapshot = PhotoDevelopPresentationSnapshotCurrentV1;
const recipe = (exposure: number) => normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(),
	effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure } }] });

/** Only public retirement/notification delivery is controlled. The mounted
 * Current presenter and native-word CPU renderer produce every ready image. */
async function fixture() {
	const canvas = currentAppCanvasBoundary(), retirements = new Set<() => Promise<void>>();
	const prototype = PhotoLibraryDevelopPresentationCurrentV1.prototype;
	const pause = prototype.pause, subscribe = prototype.subscribe;
	const pauseDescriptor = Object.getOwnPropertyDescriptor(prototype, 'pause'), subscribeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'subscribe');
	const listeners = new WeakMap<Owner, (snapshot: Snapshot) => void>(), owners: Owner[] = [];
	const holds: ReturnType<typeof deferred<void>>[] = [];
	let held: Readonly<{ owner: Owner; gate: ReturnType<typeof deferred<void>> }> | undefined;
	prototype.pause = function (this: Owner) {
		const current = held;
		return current?.owner === this ? current.gate.promise.then(() => pause.call(this)) : pause.call(this);
	};
	prototype.subscribe = function (this: Owner, listener) {
		owners.push(this); listeners.set(this, listener); return subscribe.call(this, listener);
	};
	let develop = recipe(0), suspended = false, reads = 0, active = 0, maximumActive = 0;
	const scopes: Uint16Array<ArrayBuffer>[] = [];
	let acquisition: ReturnType<typeof deferred<void>> | undefined;
	let sourceFailure: Readonly<{ value: unknown }> | undefined;
	const native: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume, options) => {
		assert.deepEqual(request, { schemaVersion: 1, photoId: 'photo', expectedRevision: 7 }); assert.ok(options?.signal);
		reads++; active++; maximumActive = Math.max(maximumActive, active);
		const pixels = new Uint16Array([65535, 65535, 65535, 65535]); scopes.push(pixels);
		try {
			if (acquisition) await acquisition.promise;
			options.signal.throwIfAborted();
			const failure = sourceFailure; sourceFailure = undefined; if (failure) throw failure.value;
			return await consume({ photoId: 'photo', revision: 7, frame: {
				descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels,
			} });
		} finally { pixels.fill(0); active--; }
	};
	let withOriginalFrame = native;
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), loadProxy = async () => runtime, beforePresent = Promise.resolve();
	const readPreview = async () => { assert.fail('Current native preview must use its Original port.'); };
	const registerRetirement = (retire: () => Promise<void>) => { retirements.add(retire); return () => { retirements.delete(retire); }; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewCurrentV1 photoId="photo" revision={7} develop={develop}
		withOriginalFrame={withOriginalFrame} readPreview={readPreview}
		loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} suspended={suspended}
		messages={photoDevelopCopy('en')} locale="en" />);
	const status = () => mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state');
	return {
		mounted, canvas, scopes, status, reads: () => reads, active: () => active, maximumActive: () => maximumActive,
		owner() { const owner = owners.at(-1); assert.ok(owner); return owner; },
		retireLater() {
			const owner = owners.at(-1); assert.ok(owner); const gate = deferred<void>(); holds.push(gate); held = { owner, gate };
			return { owner, release() { if (held?.gate === gate) held = undefined; gate.resolve(); } };
		},
		readyNotification(owner: Owner) {
			const snapshot = owner.snapshot(), listener = listeners.get(owner); assert.equal(snapshot.status, 'ready'); assert.ok(listener);
			return () => { listener(snapshot); };
		},
		async request(exposure: number) { develop = recipe(exposure); await mounted.render(); },
		failNextSource(value: unknown) { sourceFailure = { value }; },
		async suspend(value: boolean) { suspended = value; await mounted.render(); },
		async replaceSource() {
			acquisition = deferred<void>(); const gate = acquisition; holds.push(gate);
			withOriginalFrame = async (request, consume, options) => native(request, consume, options);
			await mounted.render(); return () => { acquisition = undefined; gate.resolve(); };
		},
		async ready(expected: readonly number[]) {
			await waitFor(async () => { await act(async () => { await settle(); }); return status() === 'ready'; }, 'current native Develop ready');
			assert.deepEqual(canvas.painted.at(-1), expected);
			assert.equal(active, 0, 'Ready must follow the joined Original borrower.');
			assert.ok(scopes.every(plane => plane.every(value => value === 0)), 'Ready must follow physical source retirement.');
		},
		async dispose() {
			held = undefined; acquisition = undefined; for (const gate of holds) gate.resolve();
			const joins = [...retirements];
			try { await mounted.dispose(); await Promise.all(joins.map(retire => retire())); }
			finally {
				if (pauseDescriptor) Object.defineProperty(prototype, 'pause', pauseDescriptor); else Reflect.deleteProperty(prototype, 'pause');
				if (subscribeDescriptor) Object.defineProperty(prototype, 'subscribe', subscribeDescriptor); else Reflect.deleteProperty(prototype, 'subscribe');
				canvas.restore();
			}
		},
	};
}

test('Current preview marks a new recipe pending immediately while predecessor retirement is held', async () => {
	const f = await fixture();
	try {
		await f.ready(WHITE); assert.equal(f.reads(), 1);
		const before = f.mounted.dom.one('[data-photo-develop-before]'), after = f.mounted.dom.one('[data-photo-develop-after]');
		const retirement = f.retireLater();
		await f.request(-1);
		assert.equal(f.status(), 'pending', 'The changed interaction must never inherit the previous recipe\'s ready status.');
		assert.equal(f.reads(), 1, 'A truthful pending status must not bypass predecessor retirement.');
		assert.deepEqual(f.canvas.painted.at(-1), WHITE);
		await act(async () => { retirement.release(); await settle(); });
		await f.ready(HALF); assert.equal(f.reads(), 2); assert.equal(f.maximumActive(), 1);
		assert.equal(f.mounted.dom.one('[data-photo-develop-before]'), before);
		assert.equal(f.mounted.dom.one('[data-photo-develop-after]'), after);
	} finally { await f.dispose(); }
});

test('a superseded ready notification cannot clear pending for the latest queued Current recipe', async () => {
	const f = await fixture();
	try {
		await f.ready(WHITE);
		const deliverPriorReady = f.readyNotification(f.owner()), retirement = f.retireLater();
		await f.request(-1); await f.request(-2);
		assert.equal(f.status(), 'pending');
		await act(async () => { deliverPriorReady(); await settle(); });
		assert.equal(f.status(), 'pending', 'An earlier accepted interaction cannot certify the latest requested recipe.');
		assert.equal(f.reads(), 1);
		await act(async () => { retirement.release(); await settle(); });
		await f.ready(QUARTER); assert.equal(f.reads(), 2, 'Only the latest queued recipe may acquire its native Original.');
		assert.equal(f.maximumActive(), 1);
	} finally { await f.dispose(); }
});

test('Current suspension and source-owner replacement do not inherit ready from the retired interaction', async () => {
	const f = await fixture();
	try {
		await f.ready(WHITE); const firstOwner = f.owner(), firstRetirement = f.retireLater();
		await f.suspend(true);
		assert.equal(f.status(), 'idle', 'Suspension must not advertise a ready active preview while retirement is held.');
		await f.request(-1); assert.equal(f.status(), 'idle'); assert.equal(f.reads(), 1);
		await act(async () => { firstRetirement.release(); await settle(); });
		assert.equal(f.status(), 'idle'); assert.equal(f.reads(), 1);
		await f.suspend(false); await f.ready(HALF); assert.equal(f.owner(), firstOwner);
		const secondRetirement = f.retireLater();
		const releaseSource = await f.replaceSource();
		assert.notEqual(f.owner(), firstOwner); assert.equal(f.status(), 'pending');
		assert.equal(f.reads(), 2, 'Replacement must wait for the old owner before acquiring a new source.');
		await act(async () => { secondRetirement.release(); await settle(); });
		assert.equal(f.status(), 'pending', 'A held replacement Original cannot inherit the prior owner\'s ready snapshot.');
		assert.equal(f.reads(), 3); assert.equal(f.active(), 1);
		await act(async () => { releaseSource(); await settle(); });
		await f.ready(HALF); assert.equal(f.maximumActive(), 1);
	} finally { await f.dispose(); }
});

test('Current request failure belongs to the new interaction and a successor can recover after joined retirement', async () => {
	const f = await fixture(); let reflected = 0;
	const failure = new Proxy({}, { get() { reflected++; assert.fail('Opaque source failure must not be reflected into UI.'); } });
	try {
		await f.ready(WHITE); const failedRetirement = f.retireLater(); f.failNextSource(failure);
		await f.request(-1); assert.equal(f.status(), 'pending');
		await act(async () => { failedRetirement.release(); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return f.status() === 'failed'; }, 'current native source failure');
		assert.equal(f.mounted.dom.one('[role="alert"]').textContent, photoDevelopCopy('en').previewFailed);
		assert.equal(f.reads(), 2); assert.equal(f.active(), 0); assert.equal(reflected, 0);
		assert.ok(f.scopes.every(plane => plane.every(value => value === 0)));
		const recoveredRetirement = f.retireLater(); await f.request(-2);
		assert.equal(f.status(), 'pending', 'A prior failure must not replace the successor interaction\'s pending state.');
		assert.equal(f.mounted.dom.container.querySelectorAll('[role="alert"]').length, 0);
		await act(async () => { recoveredRetirement.release(); await settle(); });
		await f.ready(QUARTER); assert.equal(f.reads(), 3); assert.equal(f.maximumActive(), 1); assert.equal(reflected, 0);
	} finally { await f.dispose(); }
});
