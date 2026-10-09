/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryDevelopBatchRequestV1 } from '../src/common/editor/photo-library-develop-settings-port-v1.ts';
import { defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { developBatchFixture, developBatchTime } from './helpers/lightscaper-develop-batch-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const selection = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const edited = () => normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })] });
function request(f: Awaited<ReturnType<typeof developBatchFixture>>): PhotoLibraryDevelopBatchRequestV1 {
	return { schemaVersion: 1, catalogId: 'catalog', targets: f.targets, label: 'Sync settings', createdAt: developBatchTime,
		action: { kind: 'paste', settings: f.settings.copy({ schemaVersion: 1, develop: edited(), selection }) } };
}

test('Develop batch shares one writer, publishes only scalar ACKs and keeps originals/metadata/history isolated per photo', async () => {
	const f = await developBatchFixture();
	try {
		const result = await f.settings.applyBatch(request(f));
		assert.equal(result.completion, 'finished'); assert.deepEqual(result.notices, []);
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'applied', 'applied']);
		assert.equal(f.calls.locks, 2); // Startup recovery, then one batch lease.
		for (const [index, outcome] of result.outcomes.entries()) {
			assert.deepEqual(Object.keys(outcome).sort(), ['code', 'historyCursor', 'index', 'photoId', 'revision', 'status', 'versionId']);
			assert.equal(outcome.revision, 1); assert.equal(outcome.historyCursor, 1); assert.equal(outcome.index, index);
			const photo = await f.repository.loadPhoto('catalog', outcome.photoId); assert.ok(photo);
			assert.deepEqual(photo.original, f.photos[index]!.original); assert.deepEqual(photo.metadata, f.photos[index]!.metadata);
			assert.equal(photo.versions[0]?.workspace?.entries[1]?.label, 'Sync settings'); assert.deepEqual(photo.versions[0]?.develop, edited());
		}
		const repeated = await f.settings.applyBatch({ ...request(f), targets: f.targets.map(target => ({ ...target, expectedRevision: 1 })) });
		assert.deepEqual(repeated.outcomes.map(outcome => outcome.status), ['unchanged', 'unchanged', 'unchanged']);
		assert.deepEqual(repeated.outcomes.map(outcome => outcome.revision), [1, 1, 1]);
	} finally { await f.close(); }
});

test('Stale revisions and missing explicit versions have separate outcomes while other selected photos still receive their own ACK', async () => {
	const f = await developBatchFixture();
	try {
		await f.repository.savePhoto({ ...f.photos[0]!, rating: 5 }, 0);
		const targets = f.targets.map((target, index) => index === 1 ? { ...target, versionId: 'missing' } : target);
		const result = await f.settings.applyBatch({ ...request(f), targets });
		assert.equal(result.completion, 'finished');
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['conflict', 'failed', 'applied']);
		assert.deepEqual(result.outcomes.map(outcome => outcome.code), ['revision-conflict', 'version-missing', null]);
		assert.equal((await f.repository.loadPhoto('catalog', f.targets[0]!.photoId))?.rating, 5);
		assert.equal((await f.repository.loadPhoto('catalog', f.targets[0]!.photoId))?.versions[0]?.develop.effects.length, 0);
		assert.equal((await f.repository.loadPhoto('catalog', f.targets[1]!.photoId))?.revision, 0);
	} finally { await f.close(); }
});

test('Batch admission rejects duplicate identities, future fields, accessors, oversized selections and hostile signal options before initialization', async () => {
	const f = await developBatchFixture(); let getters = 0;
	try {
		const base = request(f), hostile = Object.defineProperty({ ...base }, 'targets', { enumerable: true, get() { getters++; return f.targets; } });
		for (const value of [hostile, { ...base, schemaVersion: 2 }, { ...base, extra: true },
			{ ...base, targets: [f.targets[0], f.targets[0]] }, { ...base, targets: [] },
			{ ...base, targets: Array.from({ length: 65 }, (_, index) => ({ photoId: `photo-${index}`, versionId: 'master', expectedRevision: 0 })) },
			{ ...base, action: { kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure: Infinity } } }]) {
			await assert.rejects(f.settings.applyBatch(value as PhotoLibraryDevelopBatchRequestV1));
		}
		const signal = new AbortController().signal;
		Object.defineProperty(signal, 'aborted', { get() { getters++; return false; } });
		await assert.rejects(f.settings.applyBatch(base, { signal }));
		assert.equal(getters, 0); assert.equal(f.calls.initialize, 0); assert.equal(f.calls.locks, 0);
	} finally { await f.close(); }
});

test('The whole batch and copied settings detach before lazy initialization, and a pending batch excludes other Session writers', async () => {
	const f = await developBatchFixture(), entered = deferred<void>(), release = deferred<void>(), initialize = f.ports.initialize;
	f.ports.initialize = async signal => { entered.resolve(); await release.promise; return initialize(signal); };
	const targets = f.targets.map(target => ({ ...target }));
	const value = { ...request(f), targets, action: { kind: 'relative' as const, effectType: 'tone-ladder-v1' as const, changes: { exposure: 0.5 } } };
	const work = f.settings.applyBatch(value); await entered.promise;
	try {
		value.action.changes.exposure = 4; targets[1]!.versionId = 'missing';
		await assert.rejects(f.owner.setRating(f.targets[0]!.photoId, 5), /already pending/iu);
		release.resolve(); const result = await work;
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'applied', 'applied']);
		for (const target of f.targets) assert.equal((await f.repository.loadPhoto('catalog', target.photoId))?.versions[0]?.develop.effects[0]?.params.exposure, 0.5);
	} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
});

test('Cancellation and Close join a held durable save, preserve the acknowledged slot and leave later slots explicitly unattempted', async () => {
	for (const close of [false, true]) {
		const f = await developBatchFixture(), committed = deferred<void>(), release = deferred<void>(), stop = new AbortController();
		const save = f.repository.savePhoto.bind(f.repository);
		f.repository.savePhoto = async (...args) => { const result = await save(...args); committed.resolve(); await release.promise; return result; };
		const work = f.settings.applyBatch(request(f), { signal: stop.signal }); await committed.promise;
		const reason = new Proxy({}, { getPrototypeOf() { throw new Error('Cancellation reason was reflected'); } });
		const closing = close ? f.owner.close() : null; if (!close) stop.abort(reason);
		try {
			assert.equal(await remainsPending(work), true); if (closing) assert.equal(await remainsPending(closing), true);
			release.resolve(); const result = await work; await closing;
			assert.equal(result.completion, 'cancelled'); assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'not-attempted', 'not-attempted']);
			assert.equal(result.outcomes[0]?.revision, 1); assert.equal(result.outcomes[1]?.revision, null);
			assert.equal((await f.repository.loadPhoto('catalog', f.targets[0]!.photoId))?.revision, 1);
			assert.equal((await f.repository.loadPhoto('catalog', f.targets[1]!.photoId))?.revision, 0);
		} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
	}
});

test('Lease cleanup failure retains every durable ACK and reports interruption without converting saves into failures', async () => {
	const f = await developBatchFixture();
	try {
		await f.owner.develop.read({ schemaVersion: 1, photoId: f.targets[0]!.photoId });
		f.ports.exclusive = async (_catalog, run, signal) => { await run(signal); throw new Error('Cleanup failed'); };
		const result = await f.settings.applyBatch(request(f));
		assert.equal(result.completion, 'interrupted'); assert.deepEqual(result.notices, ['cleanup-failed']);
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'applied', 'applied']);
		const reason = Object.freeze({ lease: 'unavailable' }); f.ports.exclusive = async () => { throw reason; };
		await assert.rejects(f.settings.applyBatch(request(f)), error => error === reason);
	} finally { await f.close(); }
});

test('Relative batch changes preserve differing per-photo values, explicit inactive versions and no-op revisions', async () => {
	const f = await developBatchFixture();
	try {
		for (let index = 0; index < f.photos.length; index++) {
			await f.owner.develop.apply({ schemaVersion: 1, photoId: f.targets[index]!.photoId, expectedRevision: 0,
				command: { type: 'record-develop', versionId: 'master', label: 'Initial exposure', createdAt: developBatchTime,
					develop: normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: index + 1 } })] }) } });
		}
		await f.owner.develop.apply({ schemaVersion: 1, photoId: f.targets[0]!.photoId, expectedRevision: 1,
			command: { type: 'create-virtual-copy', id: 'copy', name: 'Copy', sourceVersionId: 'master', createdAt: developBatchTime } });
		const targets = f.targets.map((target, index) => ({ ...target, expectedRevision: index === 0 ? 2 : 1 }));
		const result = await f.settings.applyBatch({ ...request(f), targets,
			action: { kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure: 0.5 } } });
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'applied', 'applied']);
		for (let index = 0; index < f.photos.length; index++) {
			const photo = await f.repository.loadPhoto('catalog', f.targets[index]!.photoId);
			assert.equal(photo?.versions[0]?.develop.effects[0]?.params.exposure, index + 1.5);
			if (index === 0) { assert.equal(photo?.activeVersionId, 'copy'); assert.equal(photo?.versions[1]?.develop.effects[0]?.params.exposure, 1); }
		}
		const noOp = await f.settings.applyBatch({ ...request(f), targets: targets.map((target, index) => ({ ...target, expectedRevision: result.outcomes[index]!.revision! })),
			action: { kind: 'relative', effectType: 'tone-ladder-v1', changes: { exposure: 0 } } });
		assert.deepEqual(noOp.outcomes.map(outcome => outcome.status), ['unchanged', 'unchanged', 'unchanged']);
	} finally { await f.close(); }
});

test('Native compare-and-swap conflicts and pre-ACK write failures remain separate from durable successes', async () => {
	const f = await developBatchFixture(), save = f.repository.savePhoto.bind(f.repository);
	let position = 0;
	f.repository.savePhoto = async (...args) => {
		position++;
		if (position === 1) {
			const photo = normalizePhotoDocumentV1(args[0]); await save({ ...photo, versions: f.photos[0]!.versions, rating: 5 }, 0);
			return save(...args); // Same expected revision now loses the real native CAS.
		}
		if (position === 2) throw Object.freeze({ failed: 'before publication' });
		return save(...args);
	};
	try {
		const result = await f.settings.applyBatch(request(f));
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['conflict', 'failed', 'applied']);
		assert.deepEqual(result.outcomes.map(outcome => outcome.code), ['revision-conflict', 'operation-failed', null]);
		assert.equal((await f.repository.loadPhoto('catalog', f.targets[0]!.photoId))?.versions[0]?.develop.effects.length, 0);
		assert.equal((await f.repository.loadPhoto('catalog', f.targets[1]!.photoId))?.revision, 0);
		assert.equal((await f.repository.loadPhoto('catalog', f.targets[2]!.photoId))?.revision, 1);
	} finally { await f.close(); }
});

test('An opaque cancellation before startup rejects unchanged, foreign catalogs refuse, and the final late abort preserves finished ACKs', async () => {
	const f = await developBatchFixture(), stop = new AbortController();
	const reason = new Proxy({}, { getPrototypeOf() { throw new Error('Opaque abort reflected'); } }); stop.abort(reason);
	try {
		await assert.rejects(f.settings.applyBatch(request(f), { signal: stop.signal }), error => error === reason);
		assert.equal(f.calls.initialize, 0);
		await assert.rejects(f.settings.applyBatch({ ...request(f), catalogId: 'foreign' }), /another catalog/iu);
		for (const target of f.targets) assert.equal((await f.repository.loadPhoto('catalog', target.photoId))?.revision, 0);
		const late = new AbortController(), save = f.repository.savePhoto.bind(f.repository); let count = 0;
		f.repository.savePhoto = async (...args) => { const result = await save(...args); count++; if (count === 3) late.abort(reason); return result; };
		const result = await f.settings.applyBatch(request(f), { signal: late.signal });
		assert.equal(result.completion, 'finished'); assert.deepEqual(result.notices, []);
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'applied', 'applied']);
	} finally { await f.close(); }
});

test('Shape-valid oversized settings refuse as a whole before lazy initialization or a catalog lease', async () => {
	const f = await developBatchFixture();
	try {
		const develop = normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), masks: Array.from({ length: 3 }, (_, index) => ({
			schemaVersion: 1, id: `mask-${index}`, kind: 'mask', inputs: [], outputNodeId: 'path',
			nodes: [{ id: 'path', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
				points: Array.from({ length: 16_000 }, () => ({ position: { x: 0.5, y: 0.5 }, inHandle: null, outHandle: null })) }] }],
		})) });
		assert.ok(new TextEncoder().encode(JSON.stringify(develop)).byteLength > 2_097_152);
		await assert.rejects(f.settings.applyBatch({ ...request(f), action: { kind: 'paste',
			settings: { schemaVersion: 1, kind: 'photo-develop-settings', develop, selection } } }), /byte/iu);
		assert.equal(f.calls.initialize, 0); assert.equal(f.calls.locks, 0);
	} finally { await f.close(); }
});

test('A separate lease cleanup failure after an acknowledged save and cancellation remains visible beside unattempted targets', async () => {
	const f = await developBatchFixture(), stop = new AbortController(), reason = Object.freeze({ cancelled: true });
	const save = f.repository.savePhoto.bind(f.repository), cleanup = new Error('Independent lease cleanup failure');
	try {
		await f.owner.develop.read({ schemaVersion: 1, photoId: f.targets[0]!.photoId });
		f.repository.savePhoto = async (...args) => { const result = await save(...args); stop.abort(reason); return result; };
		f.ports.exclusive = async (_catalog, run, signal) => { await Promise.allSettled([run(signal)]); throw cleanup; };
		const result = await f.settings.applyBatch(request(f), { signal: stop.signal });
		assert.equal(result.completion, 'interrupted'); assert.deepEqual(result.notices, ['cleanup-failed']);
		assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['applied', 'not-attempted', 'not-attempted']);
		assert.equal(result.outcomes[0]?.revision, 1);
	} finally { await f.close(); }
});
