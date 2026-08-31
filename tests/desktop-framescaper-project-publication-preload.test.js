/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLICATION_ID = 'ab'.repeat(24);
const HANDSHAKE_CHANNEL = 'framescaper:v1:project-library:handshake';
const BEGIN_CHANNEL = 'framescaper:v1:project-library:publication:begin';
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const MAXIMUM_BODIES = 5_118;

/**
 * The sandbox preload is a CommonJS Electron entry point, so it is evaluated here with a
 * stub `electron` rather than imported. Doing so exercises the bridge the packaged renderer
 * actually calls: source-text assertions cannot tell a working clone from one that throws.
 */
async function exposedBridges(publicationInvoke = (_channel, value) => Promise.resolve({
	publicationId: value.publicationId,
	maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
	bodyCount: value.bodies.length,
	requiredBodyIndexes: value.bodies.length ? [value.bodies.length - 1] : [],
})) {
	const source = await readFile(resolve(ROOT, 'desktop/preload.mjs'), 'utf8');
	const exposed = new Map();
	const invocations = [];
	const electron = {
		contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
		ipcRenderer: {
			on: () => undefined,
			send: () => undefined,
			// A compliant main echoes the handshake it was offered and admits the publication.
			invoke: (channel, value) => {
				invocations.push({ channel, value });
				if (channel === HANDSHAKE_CHANNEL) return Promise.resolve(structuredClone(value));
				return publicationInvoke(channel, value);
			},
		},
	};
	const context = createContext({
		require: (specifier) => {
			if (specifier !== 'electron') throw new Error(`Unexpected preload require: ${specifier}`);
			return electron;
		},
		structuredClone,
		console,
	});
	runInContext(source, context, { filename: 'desktop/preload.mjs' });
	const library = exposed.get('framescaperDesktop').v1.projectLibrary;
	await library.connect();
	assert.equal(library.handshakeState(), 'admitted');
	return { library, invocations };
}

test('a Framescaper publication clones every body instead of cloning against its index', async () => {
	const { library, invocations } = await exposedBridges();

	const bodies = [
		{ bindingId: 'm'.padEnd(65, '1'), byteLength: 4 },
		{ bindingId: 't'.padEnd(65, '2'), byteLength: 40 },
	];
	const admitted = await library.beginPublication({
		publicationId: PUBLICATION_ID,
		expectedMetadataRevision: 1,
		expectedProject: { projectId: 'framescaper-timing-probe' },
		project: { projectId: 'framescaper-timing-probe' },
		bodies,
	});
	// The bridge builds its result inside the preload realm, so compare cloned structure.
	assert.deepEqual(structuredClone(admitted), {
		publicationId: PUBLICATION_ID, maximumChunkBytes: MAXIMUM_CHUNK_BYTES, bodyCount: 2,
		requiredBodyIndexes: [1],
	});

	const published = invocations.at(-1);
	assert.equal(published.channel, BEGIN_CHANNEL);
	assert.deepEqual(structuredClone(published.value.bodies), bodies);
	// Cloning is the point of the call: the renderer's own objects must not cross the bridge.
	for (const [index, body] of bodies.entries()) {
		assert.notEqual(published.value.bodies[index], body);
	}
});

test('a Framescaper publication with no bodies is still admitted', async () => {
	const { library, invocations } = await exposedBridges();
	const admitted = await library.beginPublication({
		publicationId: PUBLICATION_ID,
		expectedMetadataRevision: 0,
		expectedProject: { projectId: 'framescaper-empty' },
		project: { projectId: 'framescaper-empty' },
		bodies: [],
	});
	assert.equal(admitted.bodyCount, 0);
	assert.deepEqual(structuredClone(admitted.requiredBodyIndexes), []);
	assert.deepEqual(structuredClone(invocations.at(-1).value.bodies), []);
});

test('the baseline preload admits its full transcript-extended body inventory and refuses one more', async () => {
	const admittedFixture = await exposedBridges();
	const bodies = Array.from({ length: MAXIMUM_BODIES }, (_, bodyIndex) => ({ bodyIndex }));
	assert.equal((await admittedFixture.library.beginPublication({
		publicationId: PUBLICATION_ID, expectedMetadataRevision: 0,
		expectedProject: null, project: {}, bodies,
	})).bodyCount, MAXIMUM_BODIES);
	const refusedFixture = await exposedBridges();
	assert.throws(() => refusedFixture.library.beginPublication({
		publicationId: PUBLICATION_ID, expectedMetadataRevision: 0,
		expectedProject: null, project: {}, bodies: [...bodies, {}],
	}), /bounded.*array/iu);
	assert.equal(refusedFixture.invocations.length, 1, 'only the handshake crossed IPC');
});

test('a rejected publication completion still retires its preload-side active id', async () => {
	const { library, invocations } = await exposedBridges((channel, value) => {
		if (channel === BEGIN_CHANNEL) return Promise.resolve({
			publicationId: value.publicationId, maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
			bodyCount: 0, requiredBodyIndexes: [],
		});
		return Promise.reject(new Error('main refused publication completion'));
	});
	await library.beginPublication({
		publicationId: PUBLICATION_ID, expectedMetadataRevision: 0,
		expectedProject: null, project: {}, bodies: [],
	});
	await assert.rejects(library.finishPublication({ publicationId: PUBLICATION_ID }),
		/main refused publication completion/u);
	await assert.rejects(async () => library.abortPublication({ publicationId: PUBLICATION_ID }), /not active/iu);
	assert.equal(invocations.length, 3, 'the stale abort is refused before another IPC call');
});
