/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
	IPC,
	MAX_SHARED_PROJECT_DOCUMENT_BYTES,
	MAX_SHARED_PROJECT_ID_BYTES,
	MAX_SHARED_SOURCE_READS,
	MAX_SHARED_SOURCES,
} from '../desktop/constants.js';
import { registerDesktopProjectLibraryIpc } from '../desktop/project-library-ipc.js';

const PROJECT_ID = 'π'.repeat(12);
const DOCUMENT = JSON.stringify({ schemaVersion: 12, id: PROJECT_ID, title: 'Shared project', revision: 3 });
const SUMMARY = Object.freeze({
	id: PROJECT_ID,
	title: 'Shared project',
	revision: 3,
	updatedAt: '2026-07-29T12:34:56.789Z',
});
const SOURCE_SHA256 = '6f2c7d30e1887852cdf1ee60c14b93214f029d7fa0de1af6e709972e2d1693c7';
const SOURCE_BINDING_ID = `m${'a'.repeat(64)}`;
const SOURCE_WRITE_ID = 'b'.repeat(32);
const SECOND_SOURCE_WRITE_ID = 'c'.repeat(32);
const SOURCE_DESCRIPTOR = Object.freeze({
	bindingId: SOURCE_BINDING_ID,
	byteLength: 20,
	encoding: 'audio-f32le-chunks-v1',
	kind: 'audio',
	sha256: SOURCE_SHA256,
	sourceId: 'shared-audio-source',
	storageKey: 'shared-audio-storage',
});
const VIDEO_BINDING_ID = `v${'d'.repeat(64)}`;
const VIDEO_DESCRIPTOR = Object.freeze({
	bindingId: VIDEO_BINDING_ID,
	byteLength: 5,
	encoding: 'video-original-v1',
	kind: 'video',
	sha256: 'e'.repeat(64),
	sourceId: 'shared-video-source',
	storageKey: 'shared-video-storage',
});

test('main registers the closed shared-project service contract through the trusted handler seam', async () => {
	const calls = [];
	const service = {
		async listSharedProjects() { calls.push(['list']); return [SUMMARY]; },
		async readSharedProject(projectId) { calls.push(['read', projectId]); return DOCUMENT; },
		async commitSharedProject(request) {
			calls.push(['commit', request]);
			return { status: 'committed', document: request.document };
		},
		async deleteSharedProject(projectId) { calls.push(['delete', projectId]); return true; },
	};
	const { handlers } = harness(service);
	const event = Object.freeze({ owner: Object.freeze({ generation: 1 }) });

	assert.deepEqual(await handlers.get(IPC.listSharedProjects)(event), [SUMMARY]);
	assert.equal(await handlers.get(IPC.readSharedProject)(event, PROJECT_ID), DOCUMENT);
	assert.deepEqual(await handlers.get(IPC.commitSharedProject)(event, {
		document: DOCUMENT, expectedRevision: null,
	}), { status: 'committed', document: DOCUMENT });
	assert.equal(await handlers.get(IPC.deleteSharedProject)(event, PROJECT_ID), true);
	assert.deepEqual(structuredClone(calls), [
		['list'],
		['read', PROJECT_ID],
		['commit', { document: DOCUMENT, expectedRevision: null }],
		['delete', PROJECT_ID],
	]);
	assert.deepEqual([...handlers.keys()].sort(), [
		IPC.abortSharedSourceWrite,
		IPC.beginSharedSourceWrite,
		IPC.commitSharedProject,
		IPC.deleteSharedProject,
		IPC.finishSharedSourceWrite,
		IPC.listSharedProjects,
		IPC.readSharedProject,
		IPC.readSharedProjectBundle,
		IPC.readSharedSourceChunk,
		IPC.writeSharedSourceChunk,
	].sort());
});

test('main strips every internal catalog field from service summaries', async () => {
	const internal = {
		...SUMMARY,
		entryId: 'internal-entry',
		metadataFile: 'internal/path.json',
		sha256: 'a'.repeat(64),
		fencingToken: 7,
		lease: 'internal-lease',
		preferredProduct: 'soundscaper',
		updatedAtMs: 1_775_000_000_000,
	};
	const { handlers } = harness({
		listSharedProjects: async () => [internal],
		readSharedProject: async () => null,
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
	});

	const summaries = await handlers.get(IPC.listSharedProjects)({ owner: {} });
	assert.deepEqual(summaries, [SUMMARY]);
	assert.equal(Object.isFrozen(summaries), true);
	assert.equal(Object.isFrozen(summaries[0]), true);
	assert.deepEqual(Object.keys(summaries[0]), ['id', 'title', 'revision', 'updatedAt']);
});

test('main exposes bounded owner-scoped managed-source transfer without paths', async () => {
	const calls = [];
	const service = {
		async listSharedProjects() { return []; },
		async readSharedProject() { return DOCUMENT; },
		async commitSharedProject(document) { return document; },
		async deleteSharedProject() { return false; },
		async readSharedProjectBundle(projectId) {
			calls.push(['bundle', projectId]);
			return { document: DOCUMENT, sources: [SOURCE_DESCRIPTOR] };
		},
		async beginSharedSourceWrite(declaration) {
			calls.push(['begin', declaration]);
			return { status: 'ready', chunkSize: 4, writeId: SOURCE_WRITE_ID };
		},
		async writeSharedSourceChunk(value) {
			calls.push(['write', value.offset, [...value.bytes]]);
			return { nextOffset: value.offset + value.bytes.byteLength };
		},
		async finishSharedSourceWrite(value) {
			calls.push(['finish', value]);
			return SOURCE_DESCRIPTOR;
		},
		async abortSharedSourceWrite(writeId) { calls.push(['abort', writeId]); return true; },
		async readSharedSourceChunk(bindingId, options) {
			calls.push(['read-source', bindingId, options]);
			return Uint8Array.of(1, 2, 3, 4);
		},
		async dispose() { calls.push(['dispose']); },
	};
	const { handlers, registration } = harness(service);
	const owner = Object.freeze({ generation: 2 });
	const event = { owner };
	const declaration = {
		byteLength: 20,
		encoding: 'audio-f32le-chunks-v1',
		projectId: PROJECT_ID,
		projectRevision: SUMMARY.revision,
		sha256: SOURCE_SHA256,
		sourceId: SOURCE_DESCRIPTOR.sourceId,
	};

	assert.deepEqual(await handlers.get(IPC.readSharedProjectBundle)(event, PROJECT_ID), {
		document: DOCUMENT,
		sources: [SOURCE_DESCRIPTOR],
	});
	assert.deepEqual(await handlers.get(IPC.beginSharedSourceWrite)(event, declaration), {
		status: 'ready', chunkSize: 4, writeId: SOURCE_WRITE_ID,
	});
	assert.deepEqual(await handlers.get(IPC.writeSharedSourceChunk)(event, {
		bytes: Uint8Array.of(1, 2, 3, 4), offset: 0, writeId: SOURCE_WRITE_ID,
	}), { nextOffset: 4 });
	assert.deepEqual(await handlers.get(IPC.finishSharedSourceWrite)(event, {
		sha256: SOURCE_SHA256, writeId: SOURCE_WRITE_ID,
	}), SOURCE_DESCRIPTOR);
	assert.deepEqual(await handlers.get(IPC.readSharedSourceChunk)(event, {
		bindingId: SOURCE_BINDING_ID, length: 4, offset: 0,
	}), Uint8Array.of(1, 2, 3, 4));
	await handlers.get(IPC.beginSharedSourceWrite)(event, declaration);
	assert.equal(await handlers.get(IPC.abortSharedSourceWrite)(event, SOURCE_WRITE_ID), true);
	await registration.dispose();
	assert.deepEqual(calls.map(([name]) => name), [
		'bundle', 'begin', 'write', 'finish', 'read-source', 'begin', 'abort', 'dispose',
	]);
	assert.equal(calls.some((call) => call.flat().some((value) => typeof value === 'string' && value.includes('/'))), false);
});

test('main and preload reject project bundles above the managed-source descriptor ceiling', async () => {
	const oversizedBundle = {
		document: DOCUMENT,
		sources: Array.from({ length: MAX_SHARED_SOURCES + 1 }, () => SOURCE_DESCRIPTOR),
	};
	const { handlers } = harness({
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		readSharedProjectBundle: async () => oversizedBundle,
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
	});
	await assert.rejects(
		handlers.get(IPC.readSharedProjectBundle)({ owner: {} }, PROJECT_ID),
		/source count/u,
	);

	const { api } = await preloadHarness((channel) => Promise.resolve(
		channel === IPC.readSharedProjectBundle ? oversizedBundle : null,
	));
	await assert.rejects(api.readSharedProjectBundle(PROJECT_ID), /bundle is invalid/u);
});

test('main and preload preserve the closed managed original-video protocol', async () => {
	const declaration = {
		byteLength: VIDEO_DESCRIPTOR.byteLength,
		encoding: VIDEO_DESCRIPTOR.encoding,
		projectId: PROJECT_ID,
		projectRevision: SUMMARY.revision,
		sha256: VIDEO_DESCRIPTOR.sha256,
		sourceId: VIDEO_DESCRIPTOR.sourceId,
	};
	const declarations = [];
	let responseDescriptor = VIDEO_DESCRIPTOR;
	const { handlers } = harness({
		listSharedProjects: async () => [],
		readSharedProject: async () => DOCUMENT,
		readSharedProjectBundle: async () => ({ document: DOCUMENT, sources: [responseDescriptor] }),
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
		beginSharedSourceWrite: async (value) => {
			declarations.push(value);
			return { status: 'present', source: responseDescriptor };
		},
		readSharedSourceChunk: async () => Uint8Array.of(7),
	});
	const event = { owner: {} };
	assert.deepEqual(await handlers.get(IPC.readSharedProjectBundle)(event, PROJECT_ID), {
		document: DOCUMENT, sources: [VIDEO_DESCRIPTOR],
	});
	assert.deepEqual(await handlers.get(IPC.beginSharedSourceWrite)(event, declaration), {
		status: 'present', source: VIDEO_DESCRIPTOR,
	});
	assert.deepEqual(declarations, [declaration]);
	assert.deepEqual(await handlers.get(IPC.readSharedSourceChunk)(event, {
		bindingId: VIDEO_BINDING_ID, length: 1, offset: 0,
	}), Uint8Array.of(7));
	responseDescriptor = { ...VIDEO_DESCRIPTOR, bindingId: SOURCE_BINDING_ID };
	await assert.rejects(handlers.get(IPC.readSharedProjectBundle)(event, PROJECT_ID), /media binding/iu);

	const calls = [];
	let preloadDescriptor = VIDEO_DESCRIPTOR;
	const { api } = await preloadHarness((channel, value) => {
		calls.push({ channel, value });
		if (channel === IPC.readSharedProjectBundle) {
			return Promise.resolve({ document: DOCUMENT, sources: [preloadDescriptor] });
		}
		if (channel === IPC.beginSharedSourceWrite) {
			return Promise.resolve({ status: 'present', source: preloadDescriptor });
		}
		return Promise.resolve(Uint8Array.of(7));
	});
	assert.deepEqual((await api.readSharedProjectBundle(PROJECT_ID)).sources.map((source) => ({ ...source })), [VIDEO_DESCRIPTOR]);
	const admission = await api.beginSharedSourceWrite(declaration);
	assert.deepEqual({ ...admission, source: { ...admission.source } }, { status: 'present', source: VIDEO_DESCRIPTOR });
	assert.deepEqual(await api.readSharedSourceChunk({ bindingId: VIDEO_BINDING_ID, length: 1, offset: 0 }), Uint8Array.of(7));
	assert.deepEqual(structuredClone(calls[1]), { channel: IPC.beginSharedSourceWrite, value: declaration });
	preloadDescriptor = { ...VIDEO_DESCRIPTOR, encoding: 'audio-f32le-chunks-v1' };
	await assert.rejects(api.readSharedProjectBundle(PROJECT_ID), /kind and encoding|descriptor is invalid/iu);
	assert.throws(() => api.beginSharedSourceWrite({ ...declaration, byteLength: 0 }), /retained-media byte length.*positive/iu);
});

test('main caps concurrent managed-source reads and releases capacity after settlement', async () => {
	const reads = [];
	const service = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
		async readSharedSourceChunk() {
			const pending = Promise.withResolvers();
			reads.push(pending);
			return pending.promise;
		},
	};
	const { handlers } = harness(service);
	const event = { owner: {} };
	const request = { bindingId: SOURCE_BINDING_ID, length: 1, offset: 0 };
	const active = Array.from(
		{ length: MAX_SHARED_SOURCE_READS },
		() => handlers.get(IPC.readSharedSourceChunk)(event, request),
	);
	const refused = handlers.get(IPC.readSharedSourceChunk)(event, request);

	assert.equal(reads.length, MAX_SHARED_SOURCE_READS, 'IPC reserves read capacity before calling the service');
	await assert.rejects(refused, /read capacity is exhausted/u);
	reads[0].resolve(Uint8Array.of(1));
	assert.deepEqual(await active[0], Uint8Array.of(1));

	const replacement = handlers.get(IPC.readSharedSourceChunk)(event, request);
	assert.equal(reads.length, MAX_SHARED_SOURCE_READS + 1);
	for (const pending of reads.slice(1)) pending.resolve(Uint8Array.of(2));
	assert.deepEqual(await replacement, Uint8Array.of(2));
	await Promise.all(active.slice(1));
});

test('main validates project ids, document UTF-8 bytes, service results, and lower-only seams before crossing boundaries', async () => {
	let calls = 0;
	const service = {
		listSharedProjects: async () => { calls += 1; return [SUMMARY]; },
		readSharedProject: async () => { calls += 1; return null; },
		commitSharedProject: async (request) => {
			calls += 1;
			return { status: 'committed', document: request.document };
		},
		deleteSharedProject: async () => { calls += 1; return false; },
	};
	const { handlers } = harness(service, { maximumDocumentBytes: 8, maximumProjects: 1 });
	const event = { owner: {} };

	await assert.rejects(handlers.get(IPC.readSharedProject)(event, 'x'.repeat(MAX_SHARED_PROJECT_ID_BYTES + 1)), /project id.*byte limit/iu);
	await assert.rejects(handlers.get(IPC.commitSharedProject)(event, {
		document: 'é'.repeat(5), expectedRevision: null,
	}), /document.*byte limit/iu);
	await assert.rejects(handlers.get(IPC.beginSharedSourceWrite)(event, {
		byteLength: 20,
		encoding: 'audio-f32le-chunks-v1',
		projectId: PROJECT_ID,
		projectRevision: -1,
		sha256: SOURCE_SHA256,
		sourceId: SOURCE_DESCRIPTOR.sourceId,
	}), /project revision/iu);
	assert.equal(calls, 0, 'invalid renderer values do not reach the service');
	assert.throws(
		() => harness(service, { maximumDocumentBytes: MAX_SHARED_PROJECT_DOCUMENT_BYTES + 1 }),
		/cannot exceed.*hard limit/iu,
	);

	const malformedList = harness({ ...service, listSharedProjects: async () => [SUMMARY, SUMMARY] }, { maximumProjects: 1 });
	await assert.rejects(malformedList.handlers.get(IPC.listSharedProjects)(event), /project count/iu);
	const malformedRead = harness({ ...service, readSharedProject: async () => ({ document: DOCUMENT }) });
	await assert.rejects(malformedRead.handlers.get(IPC.readSharedProject)(event, PROJECT_ID), /document.*string/iu);
	const malformedDelete = harness({ ...service, deleteSharedProject: async () => 1 });
	await assert.rejects(malformedDelete.handlers.get(IPC.deleteSharedProject)(event, PROJECT_ID), /boolean/iu);
});

test('owner revocation synchronously fences new work, drains admitted work, and suppresses its late result', async () => {
	const stalled = Promise.withResolvers();
	const started = Promise.withResolvers();
	const owner = Object.freeze({ generation: 1 });
	const service = {
		listSharedProjects: async () => [],
		readSharedProject: async () => {
			started.resolve();
			await stalled.promise;
			return DOCUMENT;
		},
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
	};
	const { handlers, registration } = harness(service);
	const admitted = handlers.get(IPC.readSharedProject)({ owner }, PROJECT_ID);
	await started.promise;
	let drained = false;
	const revocation = registration.revokeOwner(owner).then(() => { drained = true; });
	await assert.rejects(
		handlers.get(IPC.deleteSharedProject)({ owner }, PROJECT_ID),
		/renderer project-library owner.*revoked/iu,
	);
	await Promise.resolve();
	assert.equal(drained, false);
	stalled.resolve();
	await assert.rejects(admitted, /renderer project-library owner.*revoked/iu);
	await revocation;
});

test('owner revocation aborts active managed-source writes', async () => {
	const aborted = [];
	const owner = Object.freeze({ generation: 3 });
	const service = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
		beginSharedSourceWrite: async () => ({
			status: 'ready', chunkSize: 4, writeId: SOURCE_WRITE_ID,
		}),
		abortSharedSourceWrite: async (writeId) => { aborted.push(writeId); return true; },
	};
	const { handlers, registration } = harness(service);
	await handlers.get(IPC.beginSharedSourceWrite)({ owner }, {
		byteLength: 20,
		encoding: 'audio-f32le-chunks-v1',
		projectId: PROJECT_ID,
		projectRevision: SUMMARY.revision,
		sha256: SOURCE_SHA256,
		sourceId: SOURCE_DESCRIPTOR.sourceId,
	});

	await registration.revokeOwner(owner);

	assert.deepEqual(aborted, [SOURCE_WRITE_ID]);
	await assert.rejects(
		handlers.get(IPC.writeSharedSourceChunk)({ owner }, {
			bytes: Uint8Array.of(1), offset: 0, writeId: SOURCE_WRITE_ID,
		}),
		/renderer project-library owner.*revoked/iu,
	);
});

test('owner revocation aborts an idle upload before draining a blocked later chunk', { timeout: 1_000 }, async () => {
	const blocked = Promise.withResolvers();
	const chunkStarted = Promise.withResolvers();
	const owner = Object.freeze({ generation: 4 });
	const writeIds = [SOURCE_WRITE_ID, SECOND_SOURCE_WRITE_ID];
	const aborted = [];
	let serviceWriteSettled = false;
	const service = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async (document) => document,
		deleteSharedProject: async () => false,
		beginSharedSourceWrite: async () => ({
			status: 'ready', chunkSize: 4, writeId: writeIds.shift(),
		}),
		async writeSharedSourceChunk() {
			chunkStarted.resolve();
			return blocked.promise.finally(() => { serviceWriteSettled = true; });
		},
		async abortSharedSourceWrite(writeId) {
			aborted.push(writeId);
			assert.equal(serviceWriteSettled, false, 'uploads are aborted before admitted chunks are drained');
			if (writeId === SECOND_SOURCE_WRITE_ID) blocked.reject(new Error('blocked chunk aborted'));
			return true;
		},
	};
	const { handlers, registration } = harness(service);
	const event = { owner };
	const declaration = {
		byteLength: 20,
		encoding: 'audio-f32le-chunks-v1',
		projectId: PROJECT_ID,
		projectRevision: SUMMARY.revision,
		sha256: SOURCE_SHA256,
		sourceId: SOURCE_DESCRIPTOR.sourceId,
	};
	await handlers.get(IPC.beginSharedSourceWrite)(event, declaration);
	await handlers.get(IPC.beginSharedSourceWrite)(event, declaration);
	const pendingWrite = handlers.get(IPC.writeSharedSourceChunk)(event, {
		bytes: Uint8Array.of(1), offset: 0, writeId: SECOND_SOURCE_WRITE_ID,
	});
	const writeRejection = assert.rejects(pendingWrite, /blocked chunk aborted/iu);
	await chunkStarted.promise;

	const revocation = registration.revokeOwner(owner);
	await assert.rejects(
		handlers.get(IPC.listSharedProjects)(event),
		/renderer project-library owner.*revoked/iu,
		'new calls are fenced synchronously',
	);
	await revocation;
	await writeRejection;
	assert.deepEqual(aborted.sort(), [SECOND_SOURCE_WRITE_ID, SOURCE_WRITE_ID].sort());
});

test('sandbox preload exposes bounded pathless shared-project methods and sanitizes every result', async () => {
	const calls = [];
	const responses = new Map([
		[IPC.listSharedProjects, [{ ...SUMMARY, entryId: 'hidden', sha256: 'a'.repeat(64) }]],
		[IPC.readSharedProject, DOCUMENT],
		[IPC.readSharedProjectBundle, { document: DOCUMENT, sources: [SOURCE_DESCRIPTOR] }],
		[IPC.commitSharedProject, { status: 'committed', document: DOCUMENT }],
		[IPC.deleteSharedProject, true],
		[IPC.beginSharedSourceWrite, { status: 'ready', chunkSize: 4, writeId: SOURCE_WRITE_ID }],
		[IPC.writeSharedSourceChunk, { nextOffset: 4 }],
		[IPC.finishSharedSourceWrite, SOURCE_DESCRIPTOR],
		[IPC.abortSharedSourceWrite, true],
		[IPC.readSharedSourceChunk, Uint8Array.of(1, 2, 3, 4)],
	]);
	const { api, projectDocument } = await preloadHarness((channel, value) => {
		calls.push({ channel, value });
		return Promise.resolve(responses.get(channel));
	});

	const summaries = await api.listSharedProjects();
	assert.deepEqual([...summaries].map((summary) => ({ ...summary })), [SUMMARY]);
	assert.equal(Object.isFrozen(summaries), true);
	assert.equal(Object.isFrozen(summaries[0]), true);
	assert.equal(await api.readSharedProject(PROJECT_ID), DOCUMENT);
	const bundle = await api.readSharedProjectBundle(PROJECT_ID);
	assert.equal(bundle.document, DOCUMENT);
	assert.deepEqual(bundle.sources.map((source) => ({ ...source })), [SOURCE_DESCRIPTOR]);
	assert.deepEqual({ ...await api.commitSharedProject({ document: DOCUMENT, expectedRevision: null }) }, {
		status: 'committed', document: DOCUMENT,
	});
	assert.equal(await api.deleteSharedProject(PROJECT_ID), true);
	const declaration = {
		byteLength: 20,
		encoding: 'audio-f32le-chunks-v1',
		projectId: PROJECT_ID,
		projectRevision: SUMMARY.revision,
		sha256: SOURCE_SHA256,
		sourceId: SOURCE_DESCRIPTOR.sourceId,
	};
	assert.deepEqual({ ...await api.beginSharedSourceWrite(declaration) }, {
		status: 'ready', chunkSize: 4, writeId: SOURCE_WRITE_ID,
	});
	assert.deepEqual({ ...await api.writeSharedSourceChunk({
		bytes: Uint8Array.of(1, 2, 3, 4), offset: 0, writeId: SOURCE_WRITE_ID,
	}) }, { nextOffset: 4 });
	assert.deepEqual({ ...await api.finishSharedSourceWrite({
		sha256: SOURCE_SHA256, writeId: SOURCE_WRITE_ID,
	}) }, SOURCE_DESCRIPTOR);
	assert.equal(await api.abortSharedSourceWrite(SOURCE_WRITE_ID), true);
	assert.deepEqual(await api.readSharedSourceChunk({
		bindingId: SOURCE_BINDING_ID, length: 4, offset: 0,
	}), Uint8Array.of(1, 2, 3, 4));
	assert.deepEqual(structuredClone(calls), [
		{ channel: IPC.listSharedProjects, value: undefined },
		{ channel: IPC.readSharedProject, value: PROJECT_ID },
		{ channel: IPC.readSharedProjectBundle, value: PROJECT_ID },
		{ channel: IPC.commitSharedProject, value: { document: DOCUMENT, expectedRevision: null } },
		{ channel: IPC.deleteSharedProject, value: PROJECT_ID },
		{ channel: IPC.beginSharedSourceWrite, value: declaration },
		{ channel: IPC.writeSharedSourceChunk, value: {
			bytes: Uint8Array.of(1, 2, 3, 4), offset: 0, writeId: SOURCE_WRITE_ID,
		} },
		{ channel: IPC.finishSharedSourceWrite, value: {
			sha256: SOURCE_SHA256, writeId: SOURCE_WRITE_ID,
		} },
		{ channel: IPC.abortSharedSourceWrite, value: SOURCE_WRITE_ID },
		{ channel: IPC.readSharedSourceChunk, value: {
			bindingId: SOURCE_BINDING_ID, length: 4, offset: 0,
		} },
	]);
	assert.throws(() => projectDocument('é'.repeat(5), 8), /document.*byte limit/iu);
	assert.equal(projectDocument('\ud83d\ude00', 4), '\ud83d\ude00');
	assert.throws(() => projectDocument('\ud83d\ude00', 3), /document.*byte limit/iu);
	assert.equal(projectDocument('\ud800', 3), '\ud800', 'a lone surrogate has the three-byte replacement encoding');
	assert.throws(() => projectDocument('\ud800', 2), /document.*byte limit/iu);
	assert.throws(() => projectDocument('{}', MAX_SHARED_PROJECT_DOCUMENT_BYTES + 1), /cannot exceed.*hard limit/iu);
});

test('sandbox preload rejects malformed service values without leaking them to the renderer', async () => {
	const { api } = await preloadHarness((channel) => Promise.resolve(
		channel === IPC.listSharedProjects
			? [{ ...SUMMARY, updatedAt: 'not-an-instant' }]
			: channel === IPC.deleteSharedProject ? 1 : { document: DOCUMENT },
	));

	await assert.rejects(api.listSharedProjects(), /updatedAt/iu);
	await assert.rejects(api.readSharedProject(PROJECT_ID), /document.*string/iu);
	await assert.rejects(api.commitSharedProject({ document: DOCUMENT, expectedRevision: null }), /commit result/iu);
	await assert.rejects(api.deleteSharedProject(PROJECT_ID), /boolean/iu);
	assert.throws(() => api.readSharedProject(''), /project id/iu);
	assert.throws(() => api.commitSharedProject({ document: DOCUMENT }), /unsupported fields/iu);
	assert.throws(() => api.commitSharedProject({ document: DOCUMENT, expectedRevision: '1' }), /expected revision/iu);
});

function harness(service, limits = {}) {
	const handlers = new Map();
	const registration = registerDesktopProjectLibraryIpc({
		handle(channel, listener) {
			assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
			handlers.set(channel, listener);
		},
		ownerFor: (event) => event.owner,
		service: {
			readSharedProjectBundle: async () => null,
			beginSharedSourceWrite: async () => ({ status: 'present', source: SOURCE_DESCRIPTOR }),
			writeSharedSourceChunk: async ({ offset, bytes }) => ({ nextOffset: offset + bytes.byteLength }),
			finishSharedSourceWrite: async () => SOURCE_DESCRIPTOR,
			abortSharedSourceWrite: async () => false,
			readSharedSourceChunk: async (_bindingId, { length }) => new Uint8Array(length),
			dispose: async () => undefined,
			...service,
		},
		...limits,
	});
	return { handlers, registration };
}

async function preloadHarness(invoke) {
	const exposed = new Map();
	const source = `${await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8')}\n`
		+ 'globalThis.__projectDocumentForTest = projectDocument;';
	const context = {
		ArrayBuffer,
		Date,
		Object,
		Promise,
		RangeError,
		String,
		TextEncoder,
		TypeError,
		Uint8Array,
		URL,
		require: () => ({
			contextBridge: { exposeInMainWorld: (name, value) => { exposed.set(name, value); } },
			ipcRenderer: { invoke, send() {}, on() {}, removeListener() {} },
		}),
	};
	vm.runInNewContext(source, context);
	return {
		api: exposed.get('scapeDesktop').v1,
		projectDocument: context.__projectDocumentForTest,
	};
}
