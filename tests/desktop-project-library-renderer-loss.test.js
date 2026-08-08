/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { IPC } from '../desktop/constants.js';
import { registerDesktopProjectLibraryIpc } from '../desktop/project-library-ipc.js';

const PROJECT_ID = 'renderer-loss-project';
const SOURCE_SHA256 = '6f2c7d30e1887852cdf1ee60c14b93214f029d7fa0de1af6e709972e2d1693c7';
const SOURCE_WRITE_ID = 'b'.repeat(32);

test('owner revocation aborts ordinary operations before draining them', async () => {
	const started = Promise.withResolvers();
	const owner = Object.freeze({ generation: 2 });
	let admittedSignal;
	const { handlers, registration } = harness({
		readSharedProject: async (_projectId, signal) => {
			admittedSignal = signal;
			started.resolve();
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		},
	});
	const admitted = handlers.get(IPC.readSharedProject)({ owner }, PROJECT_ID);
	await started.promise;
	const revocation = registration.revokeOwner(owner);
	assert.equal(admittedSignal.aborted, true, 'revocation aborts synchronously before its drain promise');
	await assert.rejects(admitted, /owner was revoked/iu);
	await revocation;
});

test('global disposal fences admission and aborts before draining', async () => {
	const owner = Object.freeze({ generation: 20 });
	let admittedSignal;
	const { handlers, registration } = harness({
		readSharedProject: async (_projectId, signal) => {
			admittedSignal = signal;
			return new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		},
	});
	const admitted = handlers.get(IPC.readSharedProject)({ owner }, PROJECT_ID);
	const disposal = registration.dispose();
	assert.equal(admittedSignal.aborted, true);
	await assert.rejects(admitted, /operations were disposed/iu);
	await disposal;
	await assert.rejects(handlers.get(IPC.listSharedProjects)({ owner }), /operations were disposed/iu);
});

test('renderer loss during source-write finishing retains the admission abort signal', async () => {
	const owner = Object.freeze({ generation: 21 });
	let admissionSignal;
	const finishStarted = Promise.withResolvers();
	const { handlers, registration } = harness({
		beginSharedSourceWrite: async (_declaration, signal) => {
			admissionSignal = signal;
			return { status: 'ready', chunkSize: 4, writeId: SOURCE_WRITE_ID };
		},
		finishSharedSourceWrite: async () => {
			finishStarted.resolve();
			return new Promise((_resolve, reject) => {
				admissionSignal.addEventListener('abort', () => reject(admissionSignal.reason), { once: true });
			});
		},
		abortSharedSourceWrite: async () => true,
	});
	const event = { owner };
	await handlers.get(IPC.beginSharedSourceWrite)(event, {
		byteLength: 20,
		encoding: 'audio-f32le-chunks-v1',
		projectId: PROJECT_ID,
		projectRevision: 3,
		sha256: SOURCE_SHA256,
		sourceId: 'shared-audio-source',
	});
	const finishing = handlers.get(IPC.finishSharedSourceWrite)(event, {
		sha256: SOURCE_SHA256, writeId: SOURCE_WRITE_ID,
	});
	await finishStarted.promise;
	const revocation = registration.revokeOwner(owner);
	assert.equal(admissionSignal.aborted, true);
	await assert.rejects(finishing, /owner was revoked/iu);
	await revocation;
});

function harness(overrides) {
	const handlers = new Map();
	const service = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		readSharedProjectBundle: async () => null,
		commitSharedProject: async (request) => ({ status: 'committed', document: request.document }),
		deleteSharedProject: async () => false,
		beginSharedSourceWrite: async () => ({ status: 'present', source: {} }),
		writeSharedSourceChunk: async ({ offset }) => ({ nextOffset: offset }),
		finishSharedSourceWrite: async () => ({}),
		abortSharedSourceWrite: async () => false,
		readSharedSourceChunk: async () => new Uint8Array(),
		dispose: async () => undefined,
		...overrides,
	};
	const registration = registerDesktopProjectLibraryIpc({
		handle(channel, listener) { handlers.set(channel, listener); },
		ownerFor: (event) => event.owner,
		service,
	});
	return { handlers, registration };
}
