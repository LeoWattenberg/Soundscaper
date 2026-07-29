/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
	IPC,
	MAX_SHARED_PROJECT_DOCUMENT_BYTES,
	MAX_SHARED_PROJECT_ID_BYTES,
} from '../desktop/constants.js';
import { registerDesktopProjectLibraryIpc } from '../desktop/project-library-ipc.js';

const PROJECT_ID = 'π'.repeat(12);
const DOCUMENT = JSON.stringify({ schemaVersion: 9, id: PROJECT_ID, title: 'Shared project', revision: 3 });
const SUMMARY = Object.freeze({
	id: PROJECT_ID,
	title: 'Shared project',
	revision: 3,
	updatedAt: '2026-07-29T12:34:56.789Z',
});

test('main registers the closed shared-project service contract through the trusted handler seam', async () => {
	const calls = [];
	const service = {
		async listSharedProjects() { calls.push(['list']); return [SUMMARY]; },
		async readSharedProject(projectId) { calls.push(['read', projectId]); return DOCUMENT; },
		async commitSharedProject(document) { calls.push(['commit', document]); return document; },
		async deleteSharedProject(projectId) { calls.push(['delete', projectId]); return true; },
	};
	const { handlers } = harness(service);
	const event = Object.freeze({ owner: Object.freeze({ generation: 1 }) });

	assert.deepEqual(await handlers.get(IPC.listSharedProjects)(event), [SUMMARY]);
	assert.equal(await handlers.get(IPC.readSharedProject)(event, PROJECT_ID), DOCUMENT);
	assert.equal(await handlers.get(IPC.commitSharedProject)(event, DOCUMENT), DOCUMENT);
	assert.equal(await handlers.get(IPC.deleteSharedProject)(event, PROJECT_ID), true);
	assert.deepEqual(calls, [
		['list'],
		['read', PROJECT_ID],
		['commit', DOCUMENT],
		['delete', PROJECT_ID],
	]);
	assert.deepEqual([...handlers.keys()].sort(), [
		IPC.commitSharedProject,
		IPC.deleteSharedProject,
		IPC.listSharedProjects,
		IPC.readSharedProject,
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

test('main validates project ids, document UTF-8 bytes, service results, and lower-only seams before crossing boundaries', async () => {
	let calls = 0;
	const service = {
		listSharedProjects: async () => { calls += 1; return [SUMMARY]; },
		readSharedProject: async () => { calls += 1; return null; },
		commitSharedProject: async (document) => { calls += 1; return document; },
		deleteSharedProject: async () => { calls += 1; return false; },
	};
	const { handlers } = harness(service, { maximumDocumentBytes: 8, maximumProjects: 1 });
	const event = { owner: {} };

	await assert.rejects(handlers.get(IPC.readSharedProject)(event, 'x'.repeat(MAX_SHARED_PROJECT_ID_BYTES + 1)), /project id.*byte limit/iu);
	await assert.rejects(handlers.get(IPC.commitSharedProject)(event, 'é'.repeat(5)), /document.*byte limit/iu);
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

test('sandbox preload exposes bounded pathless shared-project methods and sanitizes every result', async () => {
	const calls = [];
	const responses = new Map([
		[IPC.listSharedProjects, [{ ...SUMMARY, entryId: 'hidden', sha256: 'a'.repeat(64) }]],
		[IPC.readSharedProject, DOCUMENT],
		[IPC.commitSharedProject, DOCUMENT],
		[IPC.deleteSharedProject, true],
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
	assert.equal(await api.commitSharedProject(DOCUMENT), DOCUMENT);
	assert.equal(await api.deleteSharedProject(PROJECT_ID), true);
	assert.deepEqual(calls, [
		{ channel: IPC.listSharedProjects, value: undefined },
		{ channel: IPC.readSharedProject, value: PROJECT_ID },
		{ channel: IPC.commitSharedProject, value: DOCUMENT },
		{ channel: IPC.deleteSharedProject, value: PROJECT_ID },
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
	await assert.rejects(api.commitSharedProject(DOCUMENT), /document.*string/iu);
	await assert.rejects(api.deleteSharedProject(PROJECT_ID), /boolean/iu);
	assert.throws(() => api.readSharedProject(''), /project id/iu);
	assert.throws(() => api.commitSharedProject({ document: DOCUMENT }), /document.*string/iu);
});

function harness(service, limits = {}) {
	const handlers = new Map();
	const registration = registerDesktopProjectLibraryIpc({
		handle(channel, listener) {
			assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
			handlers.set(channel, listener);
		},
		ownerFor: (event) => event.owner,
		service,
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
