/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV18Handshake,
} from '../desktop/project-library-v18-contract.ts';
import { FramescaperDesktopProjectLibraryV18Main } from '../desktop/project-library-v18-main.ts';
import { canonicalMediaContentBlob } from '../src/common/editor/storage/media-content-digest.ts';
import {
	acquireFramescaperDesktopV27Bodies,
	prepareFramescaperDesktopV27PublicationBodies,
	validateFramescaperDesktopV27Bodies,
	type FramescaperDesktopV27BodyDescriptor,
} from '../src/framescaper/desktop-project-library-v27-body-transfer.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectStoreV27 } from '../src/framescaper/editor-project-store-v27.ts';
import {
	createFramescaperV27DurableBodyFixture,
	seedFramescaperV27DurableBodies,
} from './helpers/framescaper-v27-durable-body-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const EXPECTED_KINDS = [
	'video-original', 'video-proxy', 'video-timing',
	'framescaper-still', 'framescaper-freeze-render',
	'framescaper-cube-lut', 'framescaper-motion-analysis',
];

test('V27 desktop transfer plans and acquires every exact durable body role', async (context) => {
	const fixture = await createFramescaperV27DurableBodyFixture();
	const sender = await productStore(context);
	const recipient = await productStore(context);
	await seedFramescaperV27DurableBodies(sender, fixture);
	const projectSha256 = digest(new TextEncoder().encode(JSON.stringify(fixture.project)));
	const prepared = await prepareFramescaperDesktopV27PublicationBodies(
		fixture.project, projectSha256, sender,
	);
	const descriptors = prepared.map(({ descriptor }) => descriptor);
	assert.deepEqual(descriptors.map(({ kind }) => kind), EXPECTED_KINDS);
	assert.deepEqual(
		validateFramescaperDesktopV27Bodies(fixture.project, projectSha256, descriptors),
		descriptors,
	);

	await acquireFramescaperDesktopV27Bodies(
		fixture.project, projectSha256, descriptors, bodyBridge(prepared), recipient,
	);
	for (const [storageKey, expected] of fixture.bodies) {
		const body = canonicalMediaContentBlob(await recipient.loadMediaAsset(storageKey));
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), expected.bytes, storageKey);
	}
});

test('V27 desktop acquisition rolls back earlier owned publications on late corruption', async (context) => {
	const fixture = await createFramescaperV27DurableBodyFixture();
	const sender = await productStore(context);
	const recipient = await productStore(context);
	await seedFramescaperV27DurableBodies(sender, fixture);
	const projectSha256 = digest(new TextEncoder().encode(JSON.stringify(fixture.project)));
	const prepared = await prepareFramescaperDesktopV27PublicationBodies(
		fixture.project, projectSha256, sender,
	);
	const corrupt = bodyBridge(prepared, 'framescaper-motion-analysis');

	await assert.rejects(acquireFramescaperDesktopV27Bodies(
		fixture.project, projectSha256, prepared.map(({ descriptor }) => descriptor), corrupt, recipient,
	), /digest|SHA-256|motion|analysis/iu);
	for (const storageKey of fixture.bodies.keys()) {
		assert.equal(await recipient.getMediaAssetMetadata(storageKey), null, `rollback leaked ${storageKey}`);
	}
});

test('V27 desktop descriptors cannot exchange finishing roles or exceed role bounds', async (context) => {
	const fixture = await createFramescaperV27DurableBodyFixture();
	const sender = await productStore(context);
	await seedFramescaperV27DurableBodies(sender, fixture);
	const projectSha256 = digest(new TextEncoder().encode(JSON.stringify(fixture.project)));
	const prepared = await prepareFramescaperDesktopV27PublicationBodies(
		fixture.project, projectSha256, sender,
	);
	const descriptors = structuredClone(prepared.map(({ descriptor }) => descriptor));
	const lut = descriptors.find(({ kind }) => kind === 'framescaper-cube-lut')!;
	(lut as unknown as { kind: string }).kind = 'framescaper-still';
	assert.throws(
		() => validateFramescaperDesktopV27Bodies(fixture.project, projectSha256, descriptors),
		/role|descriptor|binding|inventory|encoding/iu,
	);
	const oversized = structuredClone(prepared.map(({ descriptor }) => descriptor));
	const still = oversized.find(({ kind }) => kind === 'framescaper-still')!;
	(still as unknown as { byteLength: number }).byteLength = 512 * 1024 * 1024 + 1;
	assert.throws(
		() => validateFramescaperDesktopV27Bodies(fixture.project, projectSha256, oversized),
		/size|length|bound|descriptor/iu,
	);
});

test('V18 main durably retains and duplicates the complete V27 body inventory', async (context) => {
	const fixture = await createFramescaperV27DurableBodyFixture();
	const sender = await productStore(context);
	await seedFramescaperV27DurableBodies(sender, fixture);
	const projectSha256 = digest(new TextEncoder().encode(JSON.stringify(fixture.project)));
	const prepared = await prepareFramescaperDesktopV27PublicationBodies(
		fixture.project, projectSha256, sender,
	);
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v18-v27-bodies-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const main = await FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 1881, instanceId: 'v18-v27-body-retention' },
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: () => undefined,
		qualification: null,
	});
	context.after(async () => { await main.close(); });
	const session = main.openSession(main.localHandshake);
	context.after(async () => { await session.close(); });
	const publicationId = 'd1'.repeat(24);
	await session.beginPublication({
		publicationId, expectedMetadataRevision: 0, expectedProject: null,
		project: fixture.project, bodies: prepared.map(({ descriptor }) => descriptor),
	});
	for (const [bodyIndex, body] of prepared.entries()) {
		await session.writePublicationChunk({
			publicationId, bodyIndex, offset: 0,
			bytes: new Uint8Array(await body.blob.arrayBuffer()),
		});
	}
	const published = await session.finishPublication({ publicationId }) as Bundle;
	assert.deepEqual(published.bodies.map(({ kind }) => kind), EXPECTED_KINDS);
	for (const [index, body] of prepared.entries()) {
		assert.deepEqual(await main.readNativeBody(published.bodies[index]),
			new Uint8Array(await body.blob.arrayBuffer()));
	}
	const duplicate = await session.duplicateProject({
		sourceProjectId: fixture.project.id, copyProjectId: 'v27-body-retained-copy',
		title: 'V27 body retained copy', timestamp: '2026-08-23T15:00:00.000Z',
		expectedMetadataRevision: 1,
		expectedSource: { projectRevision: fixture.project.revision, projectSha256 },
	}) as Bundle;
	assert.deepEqual(duplicate.bodies, published.bodies);
});

async function productStore(context: TestContext) {
	const store = createFramescaperProjectStoreV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
	});
	await store.ready();
	context.after(async () => { await store.close(); });
	return store;
}

function bodyBridge(
	prepared: readonly Readonly<{ descriptor: FramescaperDesktopV27BodyDescriptor; blob: Blob }>[],
	corruptKind: FramescaperDesktopV27BodyDescriptor['kind'] | null = null,
) {
	const byKey = new Map(prepared.map((item) => [key(item.descriptor), item]));
	return {
		async readBodyChunk(request: Readonly<{
			body: FramescaperDesktopV27BodyDescriptor;
			offset: number;
			length: number;
		}>): Promise<Uint8Array> {
			const item = byKey.get(key(request.body));
			if (!item) throw new Error('missing body fixture');
			const value = new Uint8Array(await item.blob.slice(
				request.offset, request.offset + request.length,
			).arrayBuffer());
			if (request.body.kind === corruptKind && request.offset === 0) value[0] ^= 0xff;
			return value;
		},
	};
}

function key(body: Pick<FramescaperDesktopV27BodyDescriptor, 'kind' | 'storageKey'>): string {
	return JSON.stringify([body.kind, body.storageKey]);
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

interface Bundle {
	readonly bodies: readonly Readonly<FramescaperDesktopV27BodyDescriptor>[];
}
