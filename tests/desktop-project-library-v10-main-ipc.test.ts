/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	FramescaperDesktopProjectLibraryV10Main,
} from '../desktop/project-library-v10-main.ts';
import {
	FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS,
	registerFramescaperDesktopProjectLibraryV10MainIpc,
} from '../desktop/project-library-v10-main-ipc.ts';
import {
	createFramescaperDesktopProjectLibraryV10MainPreloadBridge,
} from '../desktop/project-library-v10-main-preload.ts';
import {
	MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES,
} from '../desktop/project-library-v10-transfer-contract.ts';
import {
	v10MainPublication,
	V10_MAIN_PROJECT_ID,
} from './helpers/desktop-project-library-v10-main-fixture.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 84,
	instanceId: 'framescaper-v10-main-ipc',
});

test('one exact handshake admits bounded pathless publication and independently validated preload results', async (context) => {
	const fixture = await ipcFixture(context);
	const bridge = fixture.bridge(fixture.first);
	const publication = v10MainPublication();
	await assert.rejects(bridge.beginPublication(publication.request), /handshake/iu);
	assert.equal(fixture.calls.length, 0);
	await bridge.connect();
	for (const authority of ['lease', 'fencingToken', 'owner', 'path'] as const) {
		await assert.rejects(bridge.beginPublication({
			...publication.request,
			[authority]: authority === 'path' ? '/tmp/injected' : { fencingToken: 1 },
		}), /unsupported|fields/iu);
	}
	assert.equal(fixture.calls.length, 1);
	const admission = await bridge.beginPublication(publication.request);
	assert.deepEqual(Object.keys(admission).sort(), ['bodyCount', 'maximumChunkBytes', 'publicationId']);
	assert.equal(admission.bodyCount, 2);
	assert.equal(admission.maximumChunkBytes, MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES);

	await assert.rejects(bridge.writePublicationChunk({
		publicationId: admission.publicationId,
		bodyIndex: 0,
		offset: 0,
		bytes: new Uint8Array(MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES + 1),
	}), /chunk|limit/iu);
	for (const [bodyIndex, bytes] of publication.bodies.entries()) {
		assert.deepEqual(await bridge.writePublicationChunk({
			publicationId: admission.publicationId,
			bodyIndex,
			offset: 0,
			bytes,
		}), { bodyIndex, nextOffset: bytes.byteLength, complete: true });
	}
	const result = await bridge.finishPublication({ publicationId: admission.publicationId });
	assert.equal(result.project.projectId, V10_MAIN_PROJECT_ID);
	assert.deepEqual(await bridge.readProjectBundle(V10_MAIN_PROJECT_ID), result);
	assert.deepEqual((await bridge.listProjects()).projects.map(({ id }) => id), [V10_MAIN_PROJECT_ID]);
	const duplicated = await bridge.duplicateProject({
		sourceProjectId: V10_MAIN_PROJECT_ID,
		copyProjectId: 'framescaper-v10-ipc-copy',
		title: 'IPC copy',
		timestamp: '2026-08-13T18:00:00.000Z',
		expectedMetadataRevision: result.metadataRevision,
		expectedSource: {
			projectRevision: result.project.projectRevision,
			projectSha256: result.project.sha256,
		},
	});
	assert.equal(duplicated.project.projectId, 'framescaper-v10-ipc-copy');
	assert.deepEqual(await bridge.deleteProject({
		projectId: V10_MAIN_PROJECT_ID,
		expectedMetadataRevision: duplicated.metadataRevision,
		expectedProject: {
			projectRevision: result.project.projectRevision,
			projectSha256: result.project.sha256,
		},
	}), { projectId: V10_MAIN_PROJECT_ID, metadataRevision: 3, deleted: true });
	assert.equal(await bridge.readProjectBundle(V10_MAIN_PROJECT_ID), null);
	for (const [, payload] of fixture.calls.slice(1)) {
		assert.equal(hasForbiddenAuthority(payload), false);
	}
	await fixture.registration.dispose();
	assert.deepEqual([...fixture.handlers.keys()], []);
});

test('main binds publication ids to admitted owner references and revocation aborts blocked bytes', async (context) => {
	const fixture = await ipcFixture(context);
	const handshake = fixture.handlers.get(
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.handshake,
	)!;
	await handshake(fixture.first, createFramescaperDesktopProjectLibraryV10Handshake());
	await handshake(fixture.second, createFramescaperDesktopProjectLibraryV10Handshake());
	const begin = fixture.handlers.get(
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.beginPublication,
	)!;
	const write = fixture.handlers.get(
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.writePublicationChunk,
	)!;
	const finish = fixture.handlers.get(
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.finishPublication,
	)!;
	const publication = v10MainPublication();
	const admission = await begin(fixture.first, publication.request) as { publicationId: string };
	await assert.rejects(async () => begin(fixture.second, publication.request), /capacity|active|busy/iu);
	await assert.rejects(async () => write(fixture.second, {
		publicationId: admission.publicationId,
		bodyIndex: 0,
		offset: 0,
		bytes: publication.bodies[0],
	}), /owner|session|publication/iu);

	const poison = zeroTrapProxy({});
	const unadmitted = { owner: {} };
	assert.throws(() => begin(unadmitted, poison.proxy), /handshake/iu);
	assert.deepEqual(poison.hits, [0, 0, 0, 0]);
	await fixture.registration.revokeOwner(fixture.first.owner);
	await assert.rejects(
		async () => finish(fixture.first, { publicationId: admission.publicationId }),
		/refused|handshake|session|closed/iu,
	);
	assert.equal(fixture.main.snapshot().activePublication, false);
});

test('preload refusal is sticky and performs no operational IPC after a remote mismatch', async () => {
	const calls: string[] = [];
	const bridge = createFramescaperDesktopProjectLibraryV10MainPreloadBridge({
		invoke: async (channel: string) => {
			calls.push(channel);
			return {
				...createFramescaperDesktopProjectLibraryV10Handshake(),
				projectSchemaVersion: 17,
			};
		},
	});
	await assert.rejects(bridge.connect(), /handshake/iu);
	await assert.rejects(bridge.beginPublication(v10MainPublication().request), /refused/iu);
	assert.deepEqual(calls, [FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.handshake]);
	assert.equal(bridge.handshakeState(), 'refused');
});

test('the composed main stays product-owned and does not widen V9 or shared preload owners', async () => {
	for (const legacy of ['desktop/main.mjs', 'desktop/preload.mjs', 'desktop/project-library-ipc.js']) {
		assert.doesNotMatch(await readFile(resolve(ROOT, legacy), 'utf8'),
			/framescaper:v10|project-library-v10-main|publication-transport/iu);
	}
	for (const module of [
		'desktop/project-library-v10-main.ts',
		'desktop/project-library-v10-main-session.ts',
		'desktop/project-library-v10-main-ipc.ts',
		'desktop/project-library-v10-main-preload.ts',
	]) {
		const source = await readFile(resolve(ROOT, module), 'utf8');
		assert.doesNotMatch(source, /project-library-host\.ts|project-library-ipc\.js|electron\/main|main\.mjs|preload\.mjs/iu);
	}
});

type Handler = (event: Event, value?: unknown) => Promise<unknown> | unknown;
interface Event { readonly owner: object }

async function ipcFixture(context: TestContext) {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-v10-main-ipc-'));
	context.after(() => rm(appDataPath, { force: true, recursive: true }));
	const main = await FramescaperDesktopProjectLibraryV10Main.start({
		appDataPath,
		owner: OWNER,
		handshake: createFramescaperDesktopProjectLibraryV10Handshake(),
	});
	context.after(() => main.close());
	const handlers = new Map<string, Handler>();
	const calls: Array<readonly [string, unknown]> = [];
	const registration = registerFramescaperDesktopProjectLibraryV10MainIpc({
		handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
		removeHandler: (channel: string) => { handlers.delete(channel); },
		ownerFor: (event: unknown) => (event as Event).owner,
		main,
	});
	context.after(() => registration.dispose());
	const first = { owner: {} };
	const second = { owner: {} };
	return {
		main,
		handlers,
		calls,
		registration,
		first,
		second,
		bridge(event: Event) {
			return createFramescaperDesktopProjectLibraryV10MainPreloadBridge({
				invoke: async (channel: string, value?: unknown) => {
					calls.push([channel, value]);
					const handler = handlers.get(channel);
					if (!handler) throw new Error(`missing V10 handler: ${channel}`);
					return handler(event, value);
				},
			});
		},
	};
}

function hasForbiddenAuthority(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key === 'string' && /lease|fenc|owner|path|file|journal/iu.test(key)) {
			return true;
		}
	}
	return false;
}

function zeroTrapProxy(target: object) {
	const hits = [0, 0, 0, 0];
	return { proxy: new Proxy(target, {
		getPrototypeOf() { hits[0] += 1; throw new Error('prototype trap'); },
		ownKeys() { hits[1] += 1; throw new Error('keys trap'); },
		getOwnPropertyDescriptor() { hits[2] += 1; throw new Error('descriptor trap'); },
		get() { hits[3] += 1; throw new Error('get trap'); },
	}), hits };
}
