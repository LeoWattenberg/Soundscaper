/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';
import {
	createFramescaperDesktopLibraryProxyMediaBinding,
} from '../desktop/project-library-v10-media-binding.ts';
import {
	FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS,
	registerFramescaperDesktopProjectLibraryV10Ipc,
} from '../desktop/project-library-v10-ipc.ts';
import {
	createFramescaperDesktopProjectLibraryV10PreloadBridge,
} from '../desktop/project-library-v10-preload.ts';
import {
	FramescaperDesktopProjectLibraryV10TransferService,
	type FramescaperDesktopProjectLibraryV10TransferHost,
} from '../desktop/project-library-v10-transfer-service.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18 } from '../src/framescaper/editor-project-feature-requirements-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECT_ID = 'framescaper-transport-project';
const SOURCE_ID = 'framescaper-video-source';
const ORIGINAL_SHA = '12'.repeat(32);
const PROXY_SHA = '34'.repeat(32);
const TIMING_SHA = '56'.repeat(32);
const PROXY_BYTES = Uint8Array.of(1, 2, 3, 4);
const TIMING_BYTES = new Uint8Array(40).fill(5);

test('opens a dormant main session only after the exact closed V10 handshake', () => {
	let hostObservations = 0;
	const host = new Proxy({}, {
		get() { hostObservations += 1; throw new Error('host observed'); },
		ownKeys() { hostObservations += 1; throw new Error('host keys observed'); },
		getOwnPropertyDescriptor() { hostObservations += 1; throw new Error('host descriptor observed'); },
	});
	const service = FramescaperDesktopProjectLibraryV10TransferService.create({
		host: host as FramescaperDesktopProjectLibraryV10TransferHost,
	});
	assert.deepEqual(service.localHandshake, createFramescaperDesktopProjectLibraryV10Handshake());
	assert.equal(Object.isFrozen(service), true);
	assert.throws(() => service.openSession({
		...service.localHandshake,
		desktopLibrarySchemaVersion: 9,
	}), /handshake/iu);
	assert.equal(hostObservations, 0);

	const validHost = hostFixture();
	const admitted = FramescaperDesktopProjectLibraryV10TransferService.create({ host: validHost.host });
	const session = admitted.openSession(createFramescaperDesktopProjectLibraryV10Handshake());
	assert.equal(Object.isFrozen(session), true);
	assert.equal(validHost.calls.length, 0);
	assert.equal(Object.isFrozen(
		admitted.openSession(createFramescaperDesktopProjectLibraryV10Handshake()),
	), true);
});

test('preserves one exact V18 document with a complete proxy and timing body pair', async () => {
	const fixture = hostFixture();
	const service = FramescaperDesktopProjectLibraryV10TransferService.create({ host: fixture.host });
	const session = service.openSession(service.localHandshake);
	const bundle = await session.readProjectBundle(PROJECT_ID);

	assert.deepEqual(bundle, publicBundle());
	assert.equal(Object.isFrozen(bundle), true);
	assert.equal(Object.isFrozen(bundle.project), true);
	assert.equal(Object.isFrozen(bundle.bodies), true);
	assert.ok(bundle.bodies.every((body) => Object.isFrozen(body)));
	assert.equal('path' in bundle, false);
	assert.equal('relativeFile' in bundle, false);
	assert.deepEqual(fixture.calls, [['bundle', PROJECT_ID]]);

	const [proxy, timing] = bundle.bodies;
	assert.ok(proxy);
	assert.ok(timing);
	assert.deepEqual(await session.readBodyChunk(readRequest(bundle, proxy)), PROXY_BYTES);
	assert.deepEqual(await session.readBodyChunk(readRequest(bundle, timing)), TIMING_BYTES);
	assert.deepEqual(fixture.calls.map(([name]) => name), [
		'bundle', 'bundle', 'body', 'bundle', 'body',
	]);
});

test('refuses non-V10 metadata, non-V18 documents, digest drift, and incomplete body pairs', async () => {
	for (const mutate of [
		(bundle: RawBundle) => ({ ...bundle, metadata: { ...bundle.metadata, schemaVersion: 9 } }),
		(bundle: RawBundle) => ({
			...bundle,
			metadata: { ...bundle.metadata, projects: [{ ...bundle.metadata.projects[0]!, preferredProduct: 'soundscaper' }] },
		}),
		(bundle: RawBundle) => {
			const parsed = JSON.parse(bundle.document) as Record<string, unknown>;
			parsed.schemaVersion = 17;
			return { ...bundle, document: JSON.stringify(parsed) };
		},
		(bundle: RawBundle) => ({ ...bundle, document: `${bundle.document} ` }),
		(bundle: RawBundle) => ({
			...bundle,
			bodies: [{ ...bundle.bodies[0]!, bindingId: `p${'f'.repeat(64)}` }, bundle.bodies[1]!],
		}),
		(bundle: RawBundle) => ({ ...bundle, bodies: [bundle.bodies[0]!] }),
		(bundle: RawBundle) => ({
			...bundle,
			bodies: [bundle.bodies[0]!, { ...bundle.bodies[1]!, mimeType: 'application/octet-stream' }],
		}),
	] as const) {
		const fixture = hostFixture(mutate(rawBundle()));
		const service = FramescaperDesktopProjectLibraryV10TransferService.create({ host: fixture.host });
		const session = service.openSession(service.localHandshake);
		await assert.rejects(session.readProjectBundle(PROJECT_ID),
			/schema|Framescaper|digest|byte|binding|body|timing|MIME|pair/iu);
		assert.equal(fixture.calls.some(([name]) => name === 'body'), false);
	}
});

test('revalidates the exact bundle before every bounded body read', async () => {
	const fixture = hostFixture();
	const service = FramescaperDesktopProjectLibraryV10TransferService.create({ host: fixture.host });
	const session = service.openSession(service.localHandshake);
	const bundle = await session.readProjectBundle(PROJECT_ID);
	assert.ok(bundle);
	const proxy = bundle.bodies[0]!;
	const valid = readRequest(bundle, proxy);

	await assert.rejects(session.readBodyChunk({ ...valid, projectSha256: 'f'.repeat(64) }), /changed|digest|snapshot/iu);
	await assert.rejects(session.readBodyChunk({ ...valid, length: 4 * 1024 * 1024 + 1 }), /chunk|limit/iu);
	await assert.rejects(session.readBodyChunk({ ...valid, offset: proxy.byteLength }), /range|body/iu);
	assert.equal(fixture.calls.some(([name]) => name === 'body'), false);

	fixture.bodyResult = Uint8Array.of(1);
	await assert.rejects(session.readBodyChunk(valid), /length|body/iu);
	assert.equal(fixture.calls.filter(([name]) => name === 'body').length, 1);

	const controller = new AbortController();
	controller.abort(new Error('V10 transfer cancelled'));
	await assert.rejects(session.readBodyChunk({ ...valid, signal: controller.signal }), /cancelled/iu);
	assert.equal(fixture.calls.filter(([name]) => name === 'body').length, 1);
});

test('main IPC admits each renderer only through handshake and exposes no path or publication channel', async () => {
	const fixture = hostFixture();
	const service = FramescaperDesktopProjectLibraryV10TransferService.create({ host: fixture.host });
	const handlers = new Map<string, (event: unknown, value?: unknown) => Promise<unknown> | unknown>();
	const registration = registerFramescaperDesktopProjectLibraryV10Ipc({
		handle: (
			channel: string,
			handler: (event: unknown, value?: unknown) => Promise<unknown> | unknown,
		) => { handlers.set(channel, handler); },
		ownerFor: (event: unknown) => (event as { owner: object }).owner,
		service,
	});
	const first = { owner: {} };
	const second = { owner: {} };
	const poison = zeroTrapProxy({});
	assert.throws(
		() => handlers.get(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle)!(first, poison.proxy),
		/handshake/iu,
	);
	assert.deepEqual(poison.hits, [0, 0, 0, 0]);
	assert.equal(fixture.calls.length, 0);

	assert.deepEqual(await handlers.get(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake)!(
		first,
		createFramescaperDesktopProjectLibraryV10Handshake(),
	), createFramescaperDesktopProjectLibraryV10Handshake());
	assert.deepEqual(await handlers.get(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle)!(
		first,
		PROJECT_ID,
	), publicBundle());
	assert.throws(() => handlers.get(
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake,
	)!(second, {
		...createFramescaperDesktopProjectLibraryV10Handshake(), projectSchemaVersion: 17,
	}), /handshake/iu);
	assert.throws(() => handlers.get(
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle,
	)!(second, PROJECT_ID), /handshake|refused/iu);
	assert.deepEqual([...handlers.keys()].sort(), [
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake,
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readBodyChunk,
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle,
	].sort());
	assert.ok([...handlers.keys()].every((channel) => !/write|commit|delete|publish|path/iu.test(channel)));
	await registration.dispose();
});

test('preload performs one handshake before operational IPC and revalidates every response', async () => {
	const calls: Array<[string, unknown]> = [];
	let response: unknown = createFramescaperDesktopProjectLibraryV10Handshake();
	const bridge = createFramescaperDesktopProjectLibraryV10PreloadBridge({
		invoke: async (channel: string, value?: unknown) => {
			calls.push([channel, value]);
			if (channel === FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake) return response;
			if (channel === FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle) return publicBundle();
			return PROXY_BYTES;
		},
	});
	await assert.rejects(bridge.readProjectBundle(PROJECT_ID), /handshake/iu);
	assert.equal(calls.length, 0);
	await bridge.connect();
	assert.equal(bridge.handshakeState(), 'admitted');
	assert.deepEqual(await bridge.readProjectBundle(PROJECT_ID), publicBundle());
	const bundle = publicBundle();
	assert.deepEqual(await bridge.readBodyChunk(readRequest(bundle, bundle.bodies[0]!)), PROXY_BYTES);
	assert.deepEqual(calls.map(([channel]) => channel), [
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake,
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle,
		FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readBodyChunk,
	]);

	const refusedCalls: Array<[string, unknown]> = [];
	const refused = createFramescaperDesktopProjectLibraryV10PreloadBridge({
		invoke: async (channel: string, value?: unknown) => {
			refusedCalls.push([channel, value]);
			return { ...createFramescaperDesktopProjectLibraryV10Handshake(), desktopDatabaseUserVersion: 11 };
		},
	});
	await assert.rejects(refused.connect(), /handshake/iu);
	await assert.rejects(refused.readProjectBundle(PROJECT_ID), /refused/iu);
	assert.equal(refusedCalls.length, 1);
	assert.equal(refused.handshakeState(), 'refused');

	response = createFramescaperDesktopProjectLibraryV10Handshake();
	const malformed = createFramescaperDesktopProjectLibraryV10PreloadBridge({
		invoke: async (channel: string) => channel === FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake
			? response
			: { ...publicBundle(), document: '{}' },
	});
	await malformed.connect();
	await assert.rejects(malformed.readProjectBundle(PROJECT_ID), /schema|document|digest/iu);
});

test('keeps the V10 transport dormant and leaves the V9 main, preload, and IPC owners untouched', async () => {
	for (const legacy of ['desktop/main.mjs', 'desktop/preload.mjs', 'desktop/project-library-ipc.js']) {
		assert.doesNotMatch(await readFile(resolve(ROOT, legacy), 'utf8'), /framescaper:v10|project-library-v10-(?:ipc|preload|transfer)/iu);
	}
	for (const module of [
		'desktop/project-library-v10-ipc.ts',
		'desktop/project-library-v10-preload.ts',
		'desktop/project-library-v10-transfer-contract.ts',
		'desktop/project-library-v10-transfer-service.ts',
	]) {
		const source = await readFile(resolve(ROOT, module), 'utf8');
		assert.doesNotMatch(source, /project-library-ipc\.js|preload\.mjs|main\.mjs|electron|project-library-host\.ts/iu);
	}
});

interface RawBundle {
	readonly metadata: ReturnType<typeof metadata>;
	readonly document: string;
	readonly bodies: readonly Record<string, unknown>[];
}

function hostFixture(initialBundle: unknown = rawBundle()) {
	const calls: Array<readonly unknown[]> = [];
	const bundle = initialBundle;
	let bodyResult: Uint8Array<ArrayBufferLike> = PROXY_BYTES;
	const host: FramescaperDesktopProjectLibraryV10TransferHost = {
		async readProjectBundle(projectId) {
			calls.push(['bundle', projectId]);
			return bundle;
		},
		async readBodyChunk(body, options) {
			calls.push(['body', body.kind, options.offset, options.length]);
			return body.kind === 'video-timing' ? TIMING_BYTES : bodyResult;
		},
	};
	return {
		calls,
		host,
		get bodyResult() { return bodyResult; },
		set bodyResult(value: Uint8Array) { bodyResult = value; },
	};
}

function rawBundle(): RawBundle {
	const document = projectDocument();
	return { metadata: metadata(document), document, bodies: bodyDescriptors(document) };
}

function publicBundle() {
	const raw = rawBundle();
	return {
		metadataRevision: raw.metadata.revision,
		project: raw.metadata.projects[0]!,
		document: raw.document,
		bodies: raw.bodies,
	};
}

function metadata(document: string = projectDocument()) {
	const sha256 = digest(new TextEncoder().encode(document));
	const binding = createFramescaperDesktopLibraryProxyMediaBinding(
		PROJECT_ID, `video-proxy-sha256:${PROXY_SHA}`, 1, sha256,
	);
	return {
		schemaVersion: 10 as const,
		revision: 3,
		projects: [{
			id: 'framescaper-v10-entry', projectId: PROJECT_ID, name: 'Framescaper transport',
			metadataFile: `framescaper-v10-entry/1-${sha256}.json`, preferredProduct: 'framescaper' as const,
			updatedAtMs: 1, projectSchemaVersion: 18 as const, projectRevision: 1,
			byteLength: new TextEncoder().encode(document).byteLength, sha256,
		}],
		media: [{
			id: binding.id, relativeFile: binding.relativeFile, category: 'proxy' as const,
			byteLength: PROXY_BYTES.byteLength, sha256: PROXY_SHA,
		}],
	};
}

function bodyDescriptors(document: string) {
	const projectSha256 = digest(new TextEncoder().encode(document));
	const binding = createFramescaperDesktopLibraryProxyMediaBinding(
		PROJECT_ID, `video-proxy-sha256:${PROXY_SHA}`, 1, projectSha256,
	);
	return [{
		kind: 'video-proxy', encoding: 'video-proxy-v1', bindingId: binding.id,
		sourceId: `video-proxy-sha256:${PROXY_SHA}`, storageKey: `video-proxy-sha256:${PROXY_SHA}`,
		mimeType: 'video/mp4', byteLength: PROXY_BYTES.byteLength, sha256: PROXY_SHA,
	}, {
		kind: 'video-timing', encoding: 'soundscaper-video-timing-v1',
		sourceId: `video-timing-sha256:${TIMING_SHA}`,
		storageKey: `video-timing-sha256:${TIMING_SHA}`,
		mimeType: 'application/vnd.soundscaper.video-timing',
		byteLength: TIMING_BYTES.byteLength, sha256: TIMING_SHA,
	}];
}

function readRequest(bundle: ReturnType<typeof publicBundle>, body: Record<string, unknown>) {
	return {
		projectId: PROJECT_ID,
		metadataRevision: bundle.metadataRevision,
		projectRevision: bundle.project.projectRevision,
		projectSha256: bundle.project.sha256,
		body,
		offset: 0,
		length: Number(body.byteLength),
	};
}

function projectDocument(): string {
	return JSON.stringify(attachedProject());
}

function attachedProject(): FramescaperProjectV18 {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: PROJECT_ID, title: 'Framescaper transport', now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSourceV10({
			id: SOURCE_ID, name: 'Video', storageKey: SOURCE_ID, mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA, frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 1, frameRate: { num: 1, den: 1 }, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: SOURCE_ID, title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 1,
			sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true })],
		sequences: [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	});
	const next = structuredClone(project) as unknown as Record<string, unknown>;
	next.revision = 1;
	next.updatedAt = '2026-08-13T10:01:00.000Z';
	((next.sources as Record<string, unknown>[])[0]!).proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${PROXY_SHA}`, mimeType: 'video/mp4',
		byteLength: PROXY_BYTES.byteLength, sha256: PROXY_SHA,
		originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 1, boundaryCount: 2,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: `video-timing-sha256:${TIMING_SHA}`,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: TIMING_BYTES.byteLength,
			frameCount: 1, timescale: 1, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	const manifest = next.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
	next.featureRequirements = {
		schemaVersion: manifest.schemaVersion,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return next as unknown as FramescaperProjectV18;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
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
