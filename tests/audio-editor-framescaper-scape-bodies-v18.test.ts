/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FramescaperScapeArchiveV18,
} from '../src/framescaper/scape-project-preservation-v18.ts';
import {
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_TIMING,
	archiveProject,
	archiveProxyDescriptors,
	createFramescaperV18ArchiveFixture,
	type FramescaperV18ArchiveFixture,
} from './helpers/framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('archive body construction authenticates V18 before dependency observation', () => {
	let traps = 0;
	const dependencies = new Proxy({}, {
		ownKeys() { traps += 1; throw new Error('dependency keys'); },
		getOwnPropertyDescriptor() { traps += 1; throw new Error('dependency descriptor'); },
		get() { traps += 1; throw new Error('dependency get'); },
	});
	assert.throws(() => new FramescaperScapeArchiveV18({}, dependencies), /exact Framescaper V18/iu);
	assert.equal(traps, 0);
});

test('all-null V18 stays format 1 without retained-body reads', async (context) => {
	const fixture = await setup(context);
	const result = await fixture.archive.exportProject(archiveProject({ attached: false }));
	assert.deepEqual(result, { formatVersion: 1, assets: [] });
	assert.deepEqual(fixture.storage.store.calls, { metadata: 0, load: 0, begin: 0 });
});

test('format-2 export authenticates exact row roles and both immutable bodies', async (context) => {
	const fixture = await setup(context);
	await seedBodies(fixture.storage);
	const result = await fixture.archive.exportProject(archiveProject());

	assert.equal(result.formatVersion, 2);
	assert.deepEqual(result.assets.map(({ descriptor }) => descriptor), archiveProxyDescriptors());
	assert.deepEqual(
		await Promise.all(result.assets.map(async ({ body }) => [...new Uint8Array(await body.arrayBuffer())])),
		[[...ARCHIVE_PROXY_BYTES], [...ARCHIVE_TIMING.bytes]],
	);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.assets), true);
	assert.ok(result.assets.every((asset) => Object.isFrozen(asset)));
	assert.deepEqual(fixture.storage.store.calls, { metadata: 4, load: 2, begin: 2 });
});

test('format-2 export refuses changed metadata or bytes and honors pre-abort', async (context) => {
	const fixture = await setup(context);
	await seedBodies(fixture.storage);
	const proxyKey = String(archiveProxyDescriptors()[0]!.sourceId);
	await transact(fixture.storage.database, 'mediaAssets', 'readwrite', async ({ mediaAssets }) => {
		const row = await request(mediaAssets.get(proxyKey)) as Record<string, unknown>;
		await request(mediaAssets.put({ ...row, encoding: 'original' }));
	});
	await assert.rejects(fixture.archive.exportProject(archiveProject()), /role|encoding|metadata/iu);

	const controller = new AbortController();
	controller.abort(new Error('cancel export'));
	const before = { ...fixture.storage.store.calls };
	await assert.rejects(
		fixture.archive.exportProject(archiveProject(), { signal: controller.signal }),
		/cancel export/iu,
	);
	assert.deepEqual(fixture.storage.store.calls, before);
});

interface Fixture {
	readonly storage: FramescaperV18ArchiveFixture;
	readonly archive: FramescaperScapeArchiveV18;
}

async function setup(context: TestContext): Promise<Fixture> {
	const storage = await createFramescaperV18ArchiveFixture(context);
	return {
		storage,
		archive: new FramescaperScapeArchiveV18(PROFILE, {
			store: storage.store, port: storage.port, opfs: storage.opfs,
			now: () => 1_786_550_400_000,
			createGeneration: () => 'archive-claim-generation-0001',
		}),
	};
}

async function seedBodies(storage: FramescaperV18ArchiveFixture): Promise<void> {
	const descriptors = archiveProxyDescriptors();
	for (const [index, bytes] of [ARCHIVE_PROXY_BYTES, ARCHIVE_TIMING.bytes].entries()) {
		const descriptor = descriptors[index]!;
		const writer = await storage.store.beginMediaAssetWrite(String(descriptor.sourceId), {
			name: String(descriptor.entry), kind: descriptor.kind, encoding: descriptor.encoding,
			mimeType: descriptor.mimeType,
			...(index === 1 ? {
				frameCount: ARCHIVE_TIMING.reference.frameCount,
				timescale: ARCHIVE_TIMING.reference.timescale,
				finalFrameDurationTicks: ARCHIVE_TIMING.reference.finalFrameDurationTicks,
			} : {}),
		}, {
			expectedBytes: Number(descriptor.size), expectedSha256: String(descriptor.sha256),
		});
		await writer.write(bytes);
		await writer.commitOwned();
	}
}
