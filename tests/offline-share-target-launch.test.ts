/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act, createElement } from 'react';

import {
	handleShareTargetSubmission,
	sharedFilesBodyUrl as workerBodyUrl,
	sharedFilesCacheName,
	sharedFilesErrorParameter,
	sharedFilesLimits,
	sharedFilesManifestUrl as workerManifestUrl,
	sharedFilesTokenParameter,
} from '../scripts/lib/offline-share-target-worker.mjs';
import {
	useLaunchedFileImports,
	type LaunchedFileImportsInput,
} from '../src/common/editor/ui/workspace/useLaunchedFileImports.ts';
import {
	deliverLaunchedFiles,
	subscribeLaunchedFiles,
	type LaunchedFiles,
} from '../src/common/offline/file-handler-launch.ts';
import {
	collectSharedFiles,
	sharedFilesBodyUrl,
	sharedFilesManifestUrl,
	SHARED_FILES_CACHE_NAME,
	SHARED_FILES_ERROR_PARAMETER,
	SHARED_FILES_LIMITS,
	SHARED_FILES_TOKEN_PARAMETER,
	type SharedFilesCollection,
} from '../src/common/offline/share-target-launch.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const ORIGIN = 'https://soundscaper.org';

/** The cache both halves of a share use: the worker writes it, the document drains it. */
class ShareCacheStorage {
	readonly caches = new Map<string, ShareCache>();

	async open(name: string): Promise<ShareCache> {
		let cache = this.caches.get(name);
		if (!cache) {
			cache = new ShareCache();
			this.caches.set(name, cache);
		}
		return cache;
	}

	async keys(): Promise<string[]> {
		return [...this.caches.keys()];
	}

	shareCache(): ShareCache {
		return this.caches.get(SHARED_FILES_CACHE_NAME) ?? new ShareCache();
	}
}

class ShareCache {
	readonly entries = new Map<string, Response>();

	async match(url: string): Promise<Response | undefined> {
		return this.entries.get(String(url))?.clone();
	}

	async put(url: string, response: Response): Promise<void> {
		this.entries.set(String(url), response.clone());
	}

	async delete(url: string): Promise<boolean> {
		return this.entries.delete(String(url));
	}

	async keys(): Promise<Request[]> {
		return [...this.entries.keys()].map((url) => new Request(`${ORIGIN}${url}`));
	}
}

function mediaFile(name: string, contents: string, type = 'audio/wav'): File {
	return new File([new TextEncoder().encode(contents)], name, { type });
}

/** Stashes a real share with the real worker, and answers with the token it minted. */
async function stashShare(
	cacheStorage: ShareCacheStorage,
	files: readonly File[],
	fill = 0x2b,
): Promise<string> {
	const response = await handleShareTargetSubmission({
		configuration: { scope: '/', fallbacks: { standard: '/en/', embedded: '/embed/en/' } },
		cacheStorage,
		request: {
			method: 'POST',
			url: `${ORIGIN}/share-target`,
			headers: { get: () => 'multipart/form-data; boundary=--soundscaper' },
			formData: async () => ({ getAll: (field: string) => field === 'media' ? [...files] : [] }),
		},
		// Only getRandomValues is reached, so the stub states that much rather than
		// standing up a whole Crypto.
		cryptoImpl: {
			getRandomValues: (array: Uint8Array): Uint8Array => array.fill(fill),
		} as unknown as Crypto,
		now: () => 1_000,
	}) as Response;
	const token = new URL(String(response.headers.get('location'))).searchParams.get('share');
	assert.ok(token, 'the worker answered a stashed share without a token');
	return token;
}

interface CollectedShare {
	readonly addresses: readonly string[];
	readonly errors: readonly unknown[];
	readonly launches: readonly LaunchedFiles[];
	readonly result: SharedFilesCollection;
}

/** Collects one share the way the workspace does, capturing everything it touched. */
async function collect(t: TestContext, options: Readonly<{
	href: string;
	caches?: ShareCacheStorage | null;
	desktop?: boolean;
}>): Promise<CollectedShare> {
	const addresses: string[] = [];
	const errors: unknown[] = [];
	const launches: LaunchedFiles[] = [];
	const unsubscribe = subscribeLaunchedFiles((launch) => { launches.push(launch); });
	t.after(unsubscribe);
	const result = await collectSharedFiles({
		href: options.href,
		caches: options.caches ?? null,
		desktop: options.desktop ?? false,
		replaceAddress: (address) => { addresses.push(address); },
		onError: (error) => { errors.push(error); },
	});
	return { addresses, errors, launches, result };
}

function names(files: readonly File[]): string[] {
	return files.map((file) => file.name);
}

test('the document and the worker agree on where a share is stashed', () => {
	assert.equal(SHARED_FILES_CACHE_NAME, sharedFilesCacheName());
	assert.equal(SHARED_FILES_TOKEN_PARAMETER, sharedFilesTokenParameter());
	assert.equal(SHARED_FILES_ERROR_PARAMETER, sharedFilesErrorParameter());
	assert.equal(SHARED_FILES_LIMITS.maximumFiles, sharedFilesLimits().maximumFiles);
	const token = 'c'.repeat(32);
	assert.equal(sharedFilesManifestUrl(token), workerManifestUrl(token));
	assert.equal(sharedFilesBodyUrl(token, 3), workerBodyUrl(token, 3));
});

test('a document opened without a share collects nothing and leaves its address alone', async (t) => {
	const cacheStorage = new ShareCacheStorage();

	const collected = await collect(t, { href: `${ORIGIN}/en/?launch=new-project`, caches: cacheStorage });

	assert.equal(collected.result.status, 'none');
	assert.deepEqual(collected.addresses, []);
	assert.deepEqual(collected.launches, []);
	assert.deepEqual([...cacheStorage.caches.keys()], []);
});

test('the files the worker stashed are collected, delivered and cleaned up', async (t) => {
	const cacheStorage = new ShareCacheStorage();
	const token = await stashShare(cacheStorage, [
		mediaFile('Interview.wav', 'first shared file'),
		mediaFile('Mix.sscape', 'PK shared project', 'application/vnd.soundscaper.scape+zip'),
	]);

	const collected = await collect(t, {
		href: `${ORIGIN}/en/?theme=dark&share=${token}`,
		caches: cacheStorage,
	});

	assert.equal(collected.result.status, 'collected');
	assert.deepEqual(names(collected.result.files), ['Interview.wav', 'Mix.sscape']);
	assert.deepEqual(collected.addresses, ['/en/?theme=dark'], 'the token is taken, the rest of the address kept');
	assert.equal(collected.launches.length, 1);
	const launch = collected.launches[0];
	assert.deepEqual(names(launch.files), ['Interview.wav', 'Mix.sscape']);
	assert.deepEqual(names(launch.projects), ['Mix.sscape'], 'a shared archive is routed as a project');
	assert.deepEqual(names(launch.imports), ['Interview.wav']);
	assert.equal(await launch.files[0].text(), 'first shared file');
	assert.equal(launch.files[0].type, 'audio/wav');
	assert.deepEqual([...cacheStorage.shareCache().entries.keys()], [], 'the stash is deleted as it is collected');
	assert.deepEqual(collected.errors, []);
});

test('a collected share cannot be replayed from the same address', async (t) => {
	const cacheStorage = new ShareCacheStorage();
	const token = await stashShare(cacheStorage, [mediaFile('Take.wav', 'shared')]);
	const href = `${ORIGIN}/en/?share=${token}`;

	const first = await collect(t, { href, caches: cacheStorage });
	const replay = await collect(t, { href, caches: cacheStorage });

	assert.equal(first.result.status, 'collected');
	assert.equal(replay.result.status, 'missing', 'the second attempt finds the stash already gone');
	assert.deepEqual(replay.launches, []);
	assert.deepEqual(replay.addresses, ['/en/'], 'a replayed token is still stripped from the address');
});

test('collecting one share leaves a second one still pending', async (t) => {
	const cacheStorage = new ShareCacheStorage();
	const first = await stashShare(cacheStorage, [mediaFile('First.wav', 'one')], 0x11);
	const second = await stashShare(cacheStorage, [mediaFile('Second.wav', 'two')], 0x22);

	const collected = await collect(t, { href: `${ORIGIN}/en/?share=${first}`, caches: cacheStorage });
	const later = await collect(t, { href: `${ORIGIN}/en/?share=${second}`, caches: cacheStorage });

	assert.deepEqual(names(collected.result.files), ['First.wav']);
	assert.deepEqual(names(later.result.files), ['Second.wav'], 'the other share was not swept with the first');
	assert.deepEqual([...cacheStorage.shareCache().entries.keys()], []);
});

test('a token the worker never wrote collects nothing', async (t) => {
	const cacheStorage = new ShareCacheStorage();

	const collected = await collect(t, { href: `${ORIGIN}/en/?share=${'f'.repeat(32)}`, caches: cacheStorage });

	assert.equal(collected.result.status, 'missing');
	assert.deepEqual(collected.launches, []);
	assert.deepEqual(collected.addresses, ['/en/']);
});

test('a token that is not one is refused without reaching the cache', async (t) => {
	const cacheStorage = new ShareCacheStorage();

	const collected = await collect(t, { href: `${ORIGIN}/en/?share=../../etc/passwd`, caches: cacheStorage });

	assert.equal(collected.result.status, 'missing');
	assert.deepEqual([...cacheStorage.caches.keys()], [], 'a malformed token opens no cache at all');
	assert.deepEqual(collected.addresses, ['/en/']);
});

test('a stash whose manifest cannot be read is swept rather than trusted', async (t) => {
	const cacheStorage = new ShareCacheStorage();
	const token = 'd'.repeat(32);
	const cache = await cacheStorage.open(SHARED_FILES_CACHE_NAME);
	await cache.put(sharedFilesManifestUrl(token), new Response('{"schemaVersion":9}'));
	await cache.put(sharedFilesBodyUrl(token, 0), new Response('orphaned bytes'));

	const collected = await collect(t, { href: `${ORIGIN}/en/?share=${token}`, caches: cacheStorage });

	assert.equal(collected.result.status, 'unreadable');
	assert.deepEqual([...cache.entries.keys()], [], 'an unreadable stash leaves nothing behind');
	assert.deepEqual(collected.launches, []);
});

test('a share missing one body opens the rest of the batch and reports the loss', async (t) => {
	const cacheStorage = new ShareCacheStorage();
	const token = await stashShare(cacheStorage, [
		mediaFile('Kept.wav', 'kept bytes'),
		mediaFile('Lost.wav', 'lost bytes'),
	]);
	await (await cacheStorage.open(SHARED_FILES_CACHE_NAME)).delete(sharedFilesBodyUrl(token, 1));

	const collected = await collect(t, { href: `${ORIGIN}/en/?share=${token}`, caches: cacheStorage });

	assert.equal(collected.result.status, 'collected');
	assert.deepEqual(names(collected.result.files), ['Kept.wav']);
	assert.equal(collected.errors.length, 1);
	assert.match(String((collected.errors[0] as Error).message), /Lost\.wav/u);
});

test('a share the worker refused is reported rather than opened empty', async (t) => {
	const cacheStorage = new ShareCacheStorage();

	const collected = await collect(t, { href: `${ORIGIN}/en/?share-error=too-large`, caches: cacheStorage });

	assert.equal(collected.result.status, 'refused');
	assert.deepEqual(collected.addresses, ['/en/']);
	assert.equal(collected.errors.length, 1);
	assert.match(String((collected.errors[0] as Error).message), /larger than a share may carry/u);
	assert.deepEqual([...cacheStorage.caches.keys()], []);
});

test('a document with no cache storage collects nothing', async (t) => {
	const collected = await collect(t, { href: `${ORIGIN}/en/?share=${'a'.repeat(32)}`, caches: null });

	assert.equal(collected.result.status, 'unsupported');
	assert.deepEqual(collected.addresses, ['/en/'], 'the token is still taken so a refresh does not retry it');
});

test('the desktop build collects no shares and leaves the address untouched', async (t) => {
	const cacheStorage = new ShareCacheStorage();

	const collected = await collect(t, {
		href: `${ORIGIN}/en/?share=${'a'.repeat(32)}`,
		caches: cacheStorage,
		desktop: true,
	});

	assert.equal(collected.result.status, 'unsupported');
	assert.deepEqual(collected.addresses, []);
	assert.deepEqual([...cacheStorage.caches.keys()], []);
});

test('the workspace routes a share through the import a launch and a drop already take', async (t) => {
	const shared = [mediaFile('Shared.wav', 'shared bytes')];
	const workspace = await mountedWorkspace({
		collect: () => deliverLaunchedFiles(shared),
	});
	t.after(workspace.cleanup);

	await workspace.mount();
	await workspace.settle();

	assert.deepEqual(workspace.imported, [['Shared.wav']]);
	assert.deepEqual(workspace.collects, [false]);
	assert.deepEqual(workspace.errors, []);
});

test('a desktop workspace still asks, and is answered, without a share', async (t) => {
	const workspace = await mountedWorkspace({ desktop: true, collect: () => undefined });
	t.after(workspace.cleanup);

	await workspace.mount();
	await workspace.settle();

	assert.deepEqual(workspace.collects, [true], 'the collection declines itself for desktop');
	assert.deepEqual(workspace.imported, []);
});

function LaunchedFileImportsHarness(input: LaunchedFileImportsInput): null {
	useLaunchedFileImports(input);
	return null;
}

/** A mounted stand-in for the workspace: the hook, its routed import and its error sink. */
async function mountedWorkspace(options: Readonly<{
	collect: (options: Readonly<{ desktop: boolean }>) => unknown;
	desktop?: boolean;
}>) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const imported: string[][] = [];
	const errors: unknown[] = [];
	const collects: boolean[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let mounted = false;
	return {
		imported,
		errors,
		collects,
		mount: async (): Promise<void> => {
			mounted = true;
			await act(async () => {
				root.render(createElement(LaunchedFileImportsHarness, {
					controller: { ready: Promise.resolve() },
					importFiles: (files: readonly File[]) => { imported.push(names([...files])); },
					onError: (error: unknown) => { errors.push(error); },
					desktop: options.desktop ?? false,
					claim: () => undefined,
					collect: (input: Readonly<{ desktop: boolean }>) => {
						collects.push(input.desktop);
						return options.collect(input);
					},
				}));
			});
		},
		settle: async (): Promise<void> => {
			await act(async () => { await Promise.resolve(); await Promise.resolve(); });
		},
		cleanup: async (): Promise<void> => {
			if (mounted) await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
