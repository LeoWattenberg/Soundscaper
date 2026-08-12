/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	emptyDesktopLibraryMetadata,
	MAX_LIBRARY_MEDIA,
	MAX_LIBRARY_METADATA_BYTES,
	type DesktopLibraryMedia,
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
} from '../desktop/project-library-contract.ts';
import {
	createDesktopLibraryAudioMediaBinding,
	DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
	DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	DesktopLibraryManagedMediaStore,
	type DesktopLibraryManagedMediaEncoding,
	type DesktopLibraryManagedMediaStoreOptions,
	type DesktopLibraryMediaCatalogPort,
	type DesktopLibraryPublishMediaOptions,
} from '../desktop/project-library-media.ts';
import {
	TestDesktopLibraryManagedMediaInventoryPort,
} from './helpers/desktop-project-library-media-inventory-port.ts';

const PROJECT_ID = 'capacity-project';
const PROJECT_SHA256 = 'a'.repeat(64);
const MAXIMUM_MANAGED_MEDIA_BYTES = 64 * 1024 * 1024 * 1024;

test('prospective row and metadata limits reject before statfs, body, or path work', async (context) => {
	await context.test('catalog row', async (subcontext) => {
		const existing = catalogMedia('existing-capacity-storage', 1, Uint8Array.of(1));
		const metadata = metadataWith([existing]);
		let statfsCalls = 0;
		let bodyReads = 0;
		const fixture = await createFixture(subcontext, {
			createRoot: false,
			metadata,
			maximumMediaRows: 1,
			statfsImpl: async () => {
				statfsCalls += 1;
				return availableBytes(1_000);
			},
		});

		await assert.rejects(
			fixture.store.publish(declaration('row-capacity-storage', Uint8Array.of(2), () => {
				bodyReads += 1;
			})),
			/catalog.*managed-media.*limit|media.*row.*capacity/iu,
		);
		assert.equal(statfsCalls, 0);
		assert.equal(bodyReads, 0);
		await assert.rejects(readdir(fixture.root), /ENOENT/u);
	});

	await context.test('metadata bytes', async (subcontext) => {
		const metadata = emptyDesktopLibraryMetadata();
		const currentBytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
		let statfsCalls = 0;
		let bodyReads = 0;
		const fixture = await createFixture(subcontext, {
			createRoot: false,
			metadata,
			maximumMetadataBytes: currentBytes,
			statfsImpl: async () => {
				statfsCalls += 1;
				return availableBytes(1_000);
			},
		});

		await assert.rejects(
			fixture.store.publish(declaration('metadata-capacity-storage', Uint8Array.of(3), () => {
				bodyReads += 1;
			})),
			/metadata.*capacity|metadata.*byte limit/iu,
		);
		assert.equal(statfsCalls, 0);
		assert.equal(bodyReads, 0);
		await assert.rejects(readdir(fixture.root), /ENOENT/u);
	});
});

test('managed-media capacity limits are lower-only', async (context) => {
	const parent = await mkdtemp(join(tmpdir(), 'scape-library-media-capacity-limits-'));
	context.after(() => rm(parent, { recursive: true, force: true }));
	const catalog = catalogPort(emptyDesktopLibraryMetadata());
	const managedMediaRoot = join(parent, 'media');
	const base = {
		catalog: catalog.port,
		inventory: new TestDesktopLibraryManagedMediaInventoryPort(managedMediaRoot),
		managedMediaRoot,
	};

	assert.throws(
		() => new DesktopLibraryManagedMediaStore({ ...base, maximumMediaRows: MAX_LIBRARY_MEDIA + 1 }),
		/lower-only|hard maximum|no greater/iu,
	);
	assert.throws(
		() => new DesktopLibraryManagedMediaStore({
			...base,
			maximumMetadataBytes: MAX_LIBRARY_METADATA_BYTES + 1,
		}),
		/lower-only|hard maximum|no greater/iu,
	);
	assert.throws(
		() => new DesktopLibraryManagedMediaStore({
			...base,
			maximumAdmittedBytes: MAXIMUM_MANAGED_MEDIA_BYTES + 1,
		}),
		/lower-only|hard maximum|no greater/iu,
	);
});

test('insufficient and invalid destination statfs reject before body or path work', async (context) => {
	const cases: readonly Readonly<{
		label: string;
		result: unknown;
		pattern: RegExp;
	}>[] = [
		{ label: 'insufficient bytes', result: availableBytes(3), pattern: /available.*managed-media.*capacity|disk.*space/iu },
		{ label: 'numeric bavail', result: { bavail: 4, bsize: 1n }, pattern: /filesystem capacity.*invalid/iu },
		{ label: 'numeric bsize', result: { bavail: 4n, bsize: 1 }, pattern: /filesystem capacity.*invalid/iu },
		{ label: 'negative bavail', result: { bavail: -1n, bsize: 1n }, pattern: /filesystem capacity.*invalid/iu },
		{ label: 'zero bsize', result: { bavail: 4n, bsize: 0n }, pattern: /filesystem capacity.*invalid/iu },
		{ label: 'null details', result: null, pattern: /filesystem capacity.*invalid/iu },
	];

	for (const entry of cases) {
		await context.test(entry.label, async (subcontext) => {
			const calls: unknown[][] = [];
			let bodyReads = 0;
			const fixture = await createFixture(subcontext, {
				statfsImpl: async (...args: unknown[]) => {
					calls.push(args);
					return entry.result;
				},
			});
			await assert.rejects(
				fixture.store.publish(declaration('disk-capacity-storage', Uint8Array.of(1, 2, 3, 4), () => {
					bodyReads += 1;
				})),
				entry.pattern,
			);
			assert.deepEqual(calls, [[fixture.root, { bigint: true }]]);
			assert.equal(bodyReads, 0);
			assert.deepEqual(await readdir(fixture.root), []);
		});
	}
});

test('concurrent absent publications cannot oversubscribe rows or destination bytes', async (context) => {
	await context.test('rows', async (subcontext) => {
		const statfsStarted = deferred<void>();
		const continueStatfs = deferred<unknown>();
		let statfsCalls = 0;
		let secondBodyReads = 0;
		const fixture = await createFixture(subcontext, {
			maximumMediaRows: 1,
			statfsImpl: async () => {
				statfsCalls += 1;
				statfsStarted.resolve();
				return continueStatfs.promise;
			},
		});
		const first = fixture.store.publish(declaration('concurrent-row-a', Uint8Array.of(1)));
		await statfsStarted.promise;
		await assert.rejects(
			fixture.store.publish(declaration('concurrent-row-b', Uint8Array.of(2), () => {
				secondBodyReads += 1;
			})),
			/catalog.*managed-media.*limit|media.*row.*capacity/iu,
		);
		assert.equal(statfsCalls, 1);
		assert.equal(secondBodyReads, 0);
		continueStatfs.resolve(availableBytes(1));
		await first;
	});

	await context.test('aggregate admitted bytes', async (subcontext) => {
		const statfsStarted = deferred<void>();
		const continueStatfs = deferred<unknown>();
		let statfsCalls = 0;
		let secondBodyReads = 0;
		const fixture = await createFixture(subcontext, {
			maximumAdmittedBytes: 6,
			maximumMediaRows: 2,
			statfsImpl: async () => {
				statfsCalls += 1;
				statfsStarted.resolve();
				return continueStatfs.promise;
			},
		});
		const first = fixture.store.publish(declaration(
			'concurrent-admitted-a',
			Uint8Array.of(1, 2, 3, 4),
		));
		await statfsStarted.promise;
		await assert.rejects(
			fixture.store.publish(declaration('concurrent-admitted-b', Uint8Array.of(5, 6, 7), () => {
				secondBodyReads += 1;
			})),
			/aggregate.*admitted.*managed-media|managed-media.*admitted.*limit/iu,
		);
		assert.equal(statfsCalls, 1, 'aggregate admission rejects before a second statfs call');
		assert.equal(secondBodyReads, 0);
		continueStatfs.resolve(availableBytes(6));
		await first;
	});

	await context.test('destination bytes', async (subcontext) => {
		const firstBodyStarted = deferred<void>();
		const continueFirstBody = deferred<void>();
		let secondBodyReads = 0;
		let statfsCalls = 0;
		const fixture = await createFixture(subcontext, {
			maximumMediaRows: 2,
			statfsImpl: async () => {
				statfsCalls += 1;
				return availableBytes(6);
			},
		});
		const firstBytes = Uint8Array.of(1, 2, 3, 4);
		const first = fixture.store.publish({
			...declaration('concurrent-byte-a', firstBytes),
			chunks: (async function* () {
				firstBodyStarted.resolve();
				await continueFirstBody.promise;
				yield firstBytes;
			})(),
		});
		await firstBodyStarted.promise;
		await assert.rejects(
			fixture.store.publish(declaration('concurrent-byte-b', Uint8Array.of(5, 6, 7), () => {
				secondBodyReads += 1;
			})),
			/available.*managed-media.*capacity|disk.*space/iu,
		);
		assert.equal(statfsCalls, 2);
		assert.equal(secondBodyReads, 0);
		continueFirstBody.resolve();
		await first;
	});
});

test('concurrent metadata reservations account for other absent bindings before statfs', async (context) => {
	const firstDescriptor = catalogMedia('metadata-reservation-a', 1, Uint8Array.of(1));
	const secondDescriptor = catalogMedia('metadata-reservation-b', 1, Uint8Array.of(2));
	const oneRowBytes = Math.max(
		metadataBytes(1, [firstDescriptor]),
		metadataBytes(1, [secondDescriptor]),
	);
	assert.ok(metadataBytes(2, [firstDescriptor, secondDescriptor]) > oneRowBytes);
	const statfsStarted = deferred<void>();
	const continueStatfs = deferred<unknown>();
	let statfsCalls = 0;
	let secondBodyReads = 0;
	const fixture = await createFixture(context, {
		maximumMediaRows: 2,
		maximumMetadataBytes: oneRowBytes,
		statfsImpl: async () => {
			statfsCalls += 1;
			statfsStarted.resolve();
			return continueStatfs.promise;
		},
	});
	const first = fixture.store.publish(declaration('metadata-reservation-a', Uint8Array.of(1)));
	await statfsStarted.promise;
	await assert.rejects(
		fixture.store.publish(declaration('metadata-reservation-b', Uint8Array.of(2), () => {
			secondBodyReads += 1;
		})),
		/metadata.*capacity|metadata.*byte limit/iu,
	);
	assert.equal(statfsCalls, 1);
	assert.equal(secondBodyReads, 0);
	continueStatfs.resolve(availableBytes(2));
	await first;
});

test('statfs, body, and catalog failures each release capacity for a later binding', async (context) => {
	await context.test('statfs failure', async (subcontext) => {
		let failStatfs = true;
		const fixture = await createFixture(subcontext, {
			maximumMediaRows: 1,
			statfsImpl: async () => {
				if (failStatfs) throw new Error('injected statfs failure');
				return availableBytes(2);
			},
		});
		await assert.rejects(
			fixture.store.publish(declaration('failed-statfs-storage', Uint8Array.of(1))),
			/inspect.*filesystem capacity|statfs/iu,
		);
		failStatfs = false;
		await fixture.store.publish(declaration('after-statfs-storage', Uint8Array.of(2)));
	});

	await context.test('body failure', async (subcontext) => {
		const fixture = await createFixture(subcontext, {
			maximumMediaRows: 1,
			statfsImpl: async () => availableBytes(2),
		});
		const failed = declaration('failed-body-storage', Uint8Array.of(1));
		await assert.rejects(fixture.store.publish({
			...failed,
			chunks: (async function* () {
				throw new Error('injected body failure');
			})(),
		}), /injected body failure/iu);
		await fixture.store.publish(declaration('after-body-storage', Uint8Array.of(2)));
	});

	await context.test('catalog failure', async (subcontext) => {
		const fixture = await createFixture(subcontext, {
			maximumMediaRows: 1,
			statfsImpl: async () => availableBytes(2),
		});
		let failPublication = true;
		fixture.catalog.onPublish = () => {
			if (failPublication) throw new Error('injected descriptor publication failure');
		};
		await assert.rejects(
			fixture.store.publish(declaration('failed-capacity-storage', Uint8Array.of(1))),
			/injected descriptor publication failure/iu,
		);
		failPublication = false;
		await fixture.store.publish(declaration('replacement-capacity-storage', Uint8Array.of(2)));
	});
});

test('capacity remains held until descriptor publication settles', async (context) => {
	const publicationStarted = deferred<void>();
	const continuePublication = deferred<void>();
	let statfsCalls = 0;
	const fixture = await createFixture(context, {
		maximumMediaRows: 1,
		statfsImpl: async () => { statfsCalls += 1; return availableBytes(2); },
	});
	fixture.catalog.onPublish = async () => {
		publicationStarted.resolve();
		await continuePublication.promise;
	};
	const first = fixture.store.publish(declaration('held-capacity-storage', Uint8Array.of(1)));
	await publicationStarted.promise;
	await assert.rejects(
		fixture.store.publish(declaration('held-capacity-contender', Uint8Array.of(2))),
		/catalog.*managed-media.*limit|media.*row.*capacity/iu,
	);
	assert.equal(statfsCalls, 1);
	continuePublication.resolve();
	await first;
});

test('catalog growth between admission and publication is revalidated against the lower row limit', async (context) => {
	const bodyStarted = deferred<void>();
	const continueBody = deferred<void>();
	const fixture = await createFixture(context, {
		maximumMediaRows: 1,
		statfsImpl: async () => availableBytes(2),
	});
	const bytes = Uint8Array.of(1);
	const publication = fixture.store.publish({
		...declaration('catalog-growth-target', bytes),
		chunks: (async function* () {
			bodyStarted.resolve();
			await continueBody.promise;
			yield bytes;
		})(),
	});
	await bodyStarted.promise;
	const external = catalogMedia('catalog-growth-external', 1, Uint8Array.of(2));
	fixture.catalog.metadata = metadataWith([external]);
	continueBody.resolve();

	await assert.rejects(
		publication,
		/catalog.*managed-media.*row capacity/iu,
	);
	assert.deepEqual(fixture.catalog.metadata.media, [external]);
});

test('row refusal precedes donor hard-link reuse and body consumption', async (context) => {
	const donor = catalogMedia('capacity-donor', 1, Uint8Array.of(1));
	let hardLinks = 0;
	let statfsCalls = 0;
	let bodyReads = 0;
	const fixture = await createFixture(context, {
		hardLink: async () => { hardLinks += 1; },
		metadata: metadataWith([donor]),
		maximumMediaRows: 1,
		statfsImpl: async () => { statfsCalls += 1; return availableBytes(1); },
	});
	await assert.rejects(fixture.store.publish({
		...declaration('capacity-rebound', Uint8Array.of(1), () => { bodyReads += 1; }),
		reuseExistingBody: true,
	}), /catalog.*managed-media.*limit|media.*row.*capacity/iu);
	assert.equal(statfsCalls, 0);
	assert.equal(hardLinks, 0);
	assert.equal(bodyReads, 0);
});

test('an exact-present retry remains usable at row capacity without statfs or body consumption', async (context) => {
	let statfsCalls = 0;
	let refuseStatfs = false;
	const fixture = await createFixture(context, {
		maximumMediaRows: 1,
		statfsImpl: async () => {
			statfsCalls += 1;
			if (refuseStatfs) throw new Error('exact-present retry must not inspect capacity');
			return availableBytes(4);
		},
	});
	const bytes = Uint8Array.of(2, 3, 5, 7);
	const first = await fixture.store.publish(declaration('exact-present-storage', bytes));
	refuseStatfs = true;
	let retryBodyReads = 0;
	const retry = await fixture.store.publish(declaration('exact-present-storage', bytes, () => {
		retryBodyReads += 1;
	}));

	assert.deepEqual(retry, first);
	assert.equal(statfsCalls, 1);
	assert.equal(retryBodyReads, 0);
});

test('audio and video absent publications share the same capacity path', async (context) => {
	const statfsCalls: unknown[][] = [];
	const fixture = await createFixture(context, {
		maximumMediaRows: 2,
		statfsImpl: async (...args: unknown[]) => {
			statfsCalls.push(args);
			return availableBytes(8);
		},
	});
	const audioBytes = Uint8Array.of(1, 2, 3);
	const videoBytes = Uint8Array.of(4, 5, 6, 7);
	const audio = await fixture.store.publishAudio({
		...withoutEncoding(declaration('capacity-audio', audioBytes)),
	});
	const video = await fixture.store.publish(declaration(
		'capacity-video',
		videoBytes,
		undefined,
		DESKTOP_LIBRARY_VIDEO_MEDIA_ENCODING,
	));

	assert.equal(audio.id.startsWith('m'), true);
	assert.equal(video.id.startsWith('v'), true);
	assert.deepEqual(statfsCalls, [
		[fixture.root, { bigint: true }],
		[fixture.root, { bigint: true }],
	]);
});

interface MutableCatalog {
	readonly port: DesktopLibraryMediaCatalogPort;
	metadata: DesktopLibraryMetadata;
	onPublish: ((candidate: DesktopLibraryMetadata) => PromiseLike<void> | void) | null;
}

interface Fixture {
	readonly catalog: MutableCatalog;
	readonly root: string;
	readonly store: DesktopLibraryManagedMediaStore;
}

async function createFixture(
	context: TestContext,
	options: Readonly<{
		createRoot?: boolean;
		metadata?: DesktopLibraryMetadata;
		maximumMediaRows?: number;
		maximumMetadataBytes?: number;
		maximumAdmittedBytes?: number;
		statfsImpl?: (...args: unknown[]) => PromiseLike<unknown> | unknown;
		hardLink?: (existingPath: string, newPath: string) => Promise<void>;
	}> = {},
): Promise<Fixture> {
	const parent = await mkdtemp(join(tmpdir(), 'scape-library-media-capacity-'));
	context.after(() => rm(parent, { recursive: true, force: true }));
	const root = join(parent, 'media');
	if (options.createRoot !== false) await mkdir(root, { recursive: true, mode: 0o700 });
	const catalog = catalogPort(options.metadata ?? emptyDesktopLibraryMetadata());
	const storeOptions: DesktopLibraryManagedMediaStoreOptions = {
		catalog: catalog.port,
		inventory: new TestDesktopLibraryManagedMediaInventoryPort(root),
		managedMediaRoot: root,
		randomId: () => 'f'.repeat(32),
		...(options.maximumMediaRows === undefined ? {} : { maximumMediaRows: options.maximumMediaRows }),
		...(options.maximumMetadataBytes === undefined ? {} : {
			maximumMetadataBytes: options.maximumMetadataBytes,
		}),
		...(options.maximumAdmittedBytes === undefined ? {} : {
			maximumAdmittedBytes: options.maximumAdmittedBytes,
		}),
		...(options.statfsImpl === undefined ? {} : { statfsImpl: options.statfsImpl }),
		...(options.hardLink === undefined ? {} : { hardLink: options.hardLink }),
	};
	return { catalog, root, store: new DesktopLibraryManagedMediaStore(storeOptions) };
}

function catalogPort(initial: DesktopLibraryMetadata): MutableCatalog {
	const catalog = {
		metadata: initial,
		onPublish: null,
	} as MutableCatalog;
	const port: DesktopLibraryMediaCatalogPort = {
		readMetadata: () => catalog.metadata,
		publishMetadata: async (candidate) => {
			await catalog.onPublish?.(candidate);
			catalog.metadata = validateDesktopLibraryMetadata(candidate);
			return catalog.metadata;
		},
	};
	Object.defineProperty(catalog, 'port', { enumerable: true, value: port });
	return catalog;
}

function declaration(
	storageKey: string,
	bytes: Uint8Array,
	onRead?: () => void,
	encoding: DesktopLibraryManagedMediaEncoding = DESKTOP_LIBRARY_AUDIO_MEDIA_ENCODING,
): DesktopLibraryPublishMediaOptions {
	return {
		projectId: PROJECT_ID,
		projectRevision: 1,
		projectSha256: PROJECT_SHA256,
		storageKey,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
		chunks: (async function* () {
			onRead?.();
			yield bytes;
		})(),
		encoding,
	};
}

function withoutEncoding(
	options: DesktopLibraryPublishMediaOptions,
): Omit<DesktopLibraryPublishMediaOptions, 'encoding'> {
	const { encoding: _encoding, ...rest } = options;
	return rest;
}

function catalogMedia(storageKey: string, revision: number, bytes: Uint8Array): DesktopLibraryMedia {
	const binding = createDesktopLibraryAudioMediaBinding(PROJECT_ID, storageKey, revision, PROJECT_SHA256);
	return Object.freeze({ ...binding, byteLength: bytes.byteLength, sha256: digest(bytes) });
}

function metadataWith(media: readonly DesktopLibraryMedia[]): DesktopLibraryMetadata {
	return validateDesktopLibraryMetadata({ schemaVersion: 9, revision: 0, projects: [], media });
}

function metadataBytes(revision: number, media: readonly DesktopLibraryMedia[]): number {
	return Buffer.byteLength(JSON.stringify({ schemaVersion: 9, revision, projects: [], media }), 'utf8');
}

function availableBytes(bytes: number): Readonly<{ bavail: bigint; bsize: bigint }> {
	return Object.freeze({ bavail: BigInt(bytes), bsize: 1n });
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
