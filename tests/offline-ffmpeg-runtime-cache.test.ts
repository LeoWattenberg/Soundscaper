/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	installLatestFfmpegRuntime,
	type VerifiedRuntimeRelease,
	type VerifiedRuntimeStore,
	type VerifiedRuntimeTransaction,
} from '../src/common/offline/ffmpeg-runtime-cache.ts';

const RUNTIME_ROOT = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/';
test('a complete digest-verified runtime becomes active only after every staged file settles', async () => {
	const fixture = runtimeFixture();
	const store = new MemoryRuntimeStore();
	const progress: Array<Readonly<{ completedBytes: number; totalBytes: number }>> = [];

	const result = await installLatestFfmpegRuntime({
		pointerUrl: `${RUNTIME_ROOT}latest.json`,
		fetchImpl: fixture.fetch,
		store,
		onProgress: (value) => progress.push(value),
	});

	assert.equal(result.status, 'installed');
	assert.equal(result.release.releaseId, fixture.release.releaseId);
	assert.deepEqual(store.events, [
		`begin:${fixture.release.releaseId}`,
		'put:ffmpeg-core.js',
		'put:ffmpeg-core.wasm',
		`commit:${fixture.release.releaseId}`,
	]);
	assert.equal(store.active?.releaseId, fixture.release.releaseId);
	assert.deepEqual([...store.activeFiles.keys()], ['ffmpeg-core.js', 'ffmpeg-core.wasm']);
	assert.deepEqual(progress.at(-1), {
		completedBytes: fixture.totalRuntimeBytes,
		totalBytes: fixture.totalRuntimeBytes,
	});
});

test('encoded pointer, manifest, and runtime wire lengths do not replace decoded verification', async () => {
	const fixture = runtimeFixture();
	const store = new MemoryRuntimeStore();
	const fetchImpl = encodedFetch(fixture.fetch, (url, decodedBytes) => {
		if (url.endsWith('/latest.json')) return 2 * 1024 * 1024;
		if (url.endsWith('/manifest.json')) return decodedBytes + 17;
		return decodedBytes + 23;
	});

	const result = await installLatestFfmpegRuntime({
		pointerUrl: `${RUNTIME_ROOT}latest.json`,
		fetchImpl,
		store,
	});

	assert.equal(result.status, 'installed');
	assert.equal(store.active?.releaseId, fixture.release.releaseId);
	assert.deepEqual(store.cachedResponseHeaders, new Map([
		['ffmpeg-core.js', {
			contentEncoding: null,
			contentLength: String(fixture.release.files[0]?.byteLength),
			contentType: 'text/javascript; charset=utf-8',
		}],
		['ffmpeg-core.wasm', {
			contentEncoding: null,
			contentLength: String(fixture.release.files[1]?.byteLength),
			contentType: 'application/wasm',
		}],
	]));
});

test('JavaScript runtime responses accept an absent or UTF-8 charset and stage the manifest type', async () => {
	for (const contentType of [
		'text/javascript',
		'text/javascript; charset=utf-8',
		'Text/JavaScript; charset="UTF-8"',
	]) {
		const fixture = runtimeFixture({
			runtimeContentType: (name) => name.endsWith('.js') ? contentType : 'application/wasm',
		});
		const store = new MemoryRuntimeStore();

		const result = await installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
		});

		assert.equal(result.status, 'installed');
		assert.equal(
			store.cachedResponseHeaders.get('ffmpeg-core.js')?.contentType,
			'text/javascript; charset=utf-8',
		);
	}
});

test('JavaScript runtime responses reject non-UTF-8 charsets and extra MIME parameters', async () => {
	for (const contentType of [
		'text/javascript; charset=iso-8859-1',
		'text/javascript; charset=utf-8; version=1',
		'text/javascript; version=1',
	]) {
		const fixture = runtimeFixture({
			runtimeContentType: (name) => name.endsWith('.js') ? contentType : 'application/wasm',
		});
		const store = new MemoryRuntimeStore(previousRelease());

		await assert.rejects(
			() => installLatestFfmpegRuntime({
				pointerUrl: `${RUNTIME_ROOT}latest.json`,
				fetchImpl: fixture.fetch,
				store,
			}),
			/ffmpeg-core\.js Content-Type does not match/u,
		);
		assert.equal(store.active?.releaseId, '0'.repeat(64));
	}
});

test('WebAssembly runtime responses retain their exact parameter-free MIME requirement', async () => {
	const fixture = runtimeFixture({
		runtimeContentType: (name) => name.endsWith('.wasm')
			? 'application/wasm; charset=utf-8'
			: 'text/javascript',
	});
	const store = new MemoryRuntimeStore(previousRelease());

	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
		}),
		/ffmpeg-core\.wasm Content-Type does not match/u,
	);
	assert.equal(store.active?.releaseId, '0'.repeat(64));
});

test('encoded wire lengths do not weaken decoded manifest and runtime verification', async () => {
	for (const [fixtureOptions, expectedError] of [
		[{ alterManifest: true }, /manifest SHA-256 does not match/u],
		[{ alterFile: 'ffmpeg-core.js' }, /ffmpeg-core\.js SHA-256 does not match/u],
		[{ truncateFile: 'ffmpeg-core.wasm' }, /ffmpeg-core\.wasm.*byte length/u],
	] as const) {
		const fixture = runtimeFixture(fixtureOptions);
		const previous = previousRelease();
		const store = new MemoryRuntimeStore(previous);
		const fetchImpl = encodedFetch(
			fixture.fetch,
			(_url, decodedBytes) => decodedBytes + 29,
		);

		await assert.rejects(
			() => installLatestFfmpegRuntime({
				pointerUrl: `${RUNTIME_ROOT}latest.json`,
				fetchImpl,
				store,
			}),
			expectedError,
		);
		assert.equal(store.active, previous);
	}
});

test('unencoded manifest and runtime Content-Length mismatches remain rejected', async () => {
	for (const target of ['manifest.json', 'ffmpeg-core.js']) {
		const fixture = runtimeFixture();
		const store = new MemoryRuntimeStore(previousRelease());
		const fetchImpl = contentLengthReplacingFetch(fixture.fetch, target, (decodedBytes) => decodedBytes + 1);

		await assert.rejects(
			() => installLatestFfmpegRuntime({
				pointerUrl: `${RUNTIME_ROOT}latest.json`,
				fetchImpl,
				store,
			}),
			/Content-Length does not match its verified byte length/u,
		);
		assert.equal(store.active?.releaseId, '0'.repeat(64));
	}
});

test('an altered release manifest is rejected before a staging transaction starts', async () => {
	const fixture = runtimeFixture({ alterManifest: true });
	const previous = previousRelease();
	const store = new MemoryRuntimeStore(previous);

	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
		}),
		/manifest SHA-256 does not match/u,
	);

	assert.deepEqual(store.events, []);
	assert.equal(store.active, previous);
});

test('a partial runtime update rolls back its candidate and retains the previous verified release', async () => {
	const fixture = runtimeFixture({ truncateFile: 'ffmpeg-core.wasm' });
	const previous = previousRelease();
	const store = new MemoryRuntimeStore(previous);

	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
		}),
		/ffmpeg-core\.wasm.*byte length/u,
	);

	assert.deepEqual(store.events, [
		`begin:${fixture.release.releaseId}`,
		'put:ffmpeg-core.js',
		`rollback:${fixture.release.releaseId}`,
	]);
	assert.equal(store.active, previous);
	assert.deepEqual([...store.activeFiles], []);
});

test('a runtime body digest mismatch never promotes the candidate', async () => {
	const fixture = runtimeFixture({ alterFile: 'ffmpeg-core.js' });
	const store = new MemoryRuntimeStore(previousRelease());

	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
		}),
		/ffmpeg-core\.js SHA-256 does not match/u,
	);
	assert.equal(store.active?.releaseId, '0'.repeat(64));
	assert.equal(store.events.at(-1), `rollback:${fixture.release.releaseId}`);
});

test('an already active identical release performs no runtime body downloads', async () => {
	const fixture = runtimeFixture();
	const store = new MemoryRuntimeStore(fixture.release);

	const result = await installLatestFfmpegRuntime({
		pointerUrl: `${RUNTIME_ROOT}latest.json`,
		fetchImpl: fixture.fetch,
		store,
	});

	assert.equal(result.status, 'current');
	assert.deepEqual(store.events, []);
	assert.deepEqual(fixture.requestedUrls, [
		`${RUNTIME_ROOT}latest.json`,
		`${RUNTIME_ROOT}releases/${fixture.release.releaseId}/manifest.json`,
	]);
});

test('runtime pointers cannot escape their versioned origin or release directory', async () => {
	for (const overrideJsPath of [
		() => 'https://example.invalid/ffmpeg-core.js',
		(releaseId: string) => `runtime/ffmpeg/0.12.10/releases/${releaseId}/../ffmpeg-core.js`,
		(releaseId: string) => `runtime/ffmpeg/0.12.10/releases/${releaseId}/nested/ffmpeg-core.js`,
	]) {
		const fixture = runtimeFixture({ overrideJsPath });
		const store = new MemoryRuntimeStore(previousRelease());
		await assert.rejects(
			() => installLatestFfmpegRuntime({
				pointerUrl: `${RUNTIME_ROOT}latest.json`,
				fetchImpl: fixture.fetch,
				store,
			}),
			/path|release directory|origin/u,
		);
		assert.deepEqual(store.events, []);
	}
});

test('cancellation preserves its exact reason and rolls back staged bytes', async () => {
	const reason = new Error('leave the installed runtime alone');
	const controller = new AbortController();
	const fixture = runtimeFixture({
		afterRuntimeRequest: (name) => {
			if (name === 'ffmpeg-core.js') controller.abort(reason);
		},
	});
	const store = new MemoryRuntimeStore(previousRelease());

	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
			signal: controller.signal,
		}),
		(error: unknown) => error === reason,
	);
	assert.equal(store.active?.releaseId, '0'.repeat(64));
	assert.equal(store.events.at(-1), `rollback:${fixture.release.releaseId}`);
});

test('an early candidate-store refusal cannot strand the streaming producer', async () => {
	const fixture = runtimeFixture();
	const refusal = new Error('candidate cache quota exhausted');
	const events: string[] = [];
	const store: VerifiedRuntimeStore = {
		readActive: async () => previousRelease(),
		begin: async () => ({
			put: async () => {
				events.push('put');
				throw refusal;
			},
			commit: async () => { events.push('commit'); },
			rollback: async () => { events.push('rollback'); },
		}),
	};

	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: `${RUNTIME_ROOT}latest.json`,
			fetchImpl: fixture.fetch,
			store,
		}),
		(error: unknown) => error === refusal,
	);
	assert.deepEqual(events, ['put', 'rollback']);
});

test('the runtime pointer is pinned to the production asset origin', async () => {
	const fixture = runtimeFixture();
	await assert.rejects(
		() => installLatestFfmpegRuntime({
			pointerUrl: 'https://example.invalid/runtime/ffmpeg/0.12.10/latest.json',
			fetchImpl: fixture.fetch,
			store: new MemoryRuntimeStore(),
		}),
		/production asset origin/u,
	);
	assert.deepEqual(fixture.requestedUrls, []);
});

class MemoryRuntimeStore implements VerifiedRuntimeStore {
	active: VerifiedRuntimeRelease | null;
	activeFiles = new Map<string, Uint8Array>();
	readonly cachedResponseHeaders = new Map<string, Readonly<{
		contentEncoding: string | null;
		contentLength: string | null;
		contentType: string | null;
	}>>();
	readonly events: string[] = [];

	constructor(active: VerifiedRuntimeRelease | null = null) {
		this.active = active;
	}

	async readActive(): Promise<VerifiedRuntimeRelease | null> {
		return this.active;
	}

	async begin(release: VerifiedRuntimeRelease): Promise<VerifiedRuntimeTransaction> {
		this.events.push(`begin:${release.releaseId}`);
		const staged = new Map<string, Uint8Array>();
		return {
			put: async (file, response) => {
				this.events.push(`put:${file.name}`);
				this.cachedResponseHeaders.set(file.name, Object.freeze({
					contentEncoding: response.headers.get('content-encoding'),
					contentLength: response.headers.get('content-length'),
					contentType: response.headers.get('content-type'),
				}));
				staged.set(file.name, new Uint8Array(await response.arrayBuffer()));
			},
			commit: async () => {
				this.events.push(`commit:${release.releaseId}`);
				this.active = release;
				this.activeFiles = staged;
			},
			rollback: async () => {
				this.events.push(`rollback:${release.releaseId}`);
				staged.clear();
			},
		};
	}
}

function runtimeFixture(options: {
	readonly afterRuntimeRequest?: (name: string) => void;
	readonly alterFile?: string;
	readonly alterManifest?: boolean;
	readonly overrideJsPath?: (releaseId: string) => string;
	readonly runtimeContentType?: (name: string) => string;
	readonly truncateFile?: string;
} = {}) {
	const runtime = new Map([
		['ffmpeg-core.js', new TextEncoder().encode('self.createFfmpegCore = true;')],
		['ffmpeg-core.wasm', Uint8Array.from({ length: 37 }, (_, index) => index * 7 & 0xff)],
	]);
	const runtimeFiles = [...runtime].map(([name, bytes]) => ({
		name,
		byteLength: bytes.byteLength,
		sha256: digest(bytes),
		contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8',
	}));
	const manifest = {
		schemaVersion: 1,
		id: 'ffmpeg-core-0.12.10',
		package: { name: '@ffmpeg/core', version: '0.12.10' },
		runtime: {
			publicPrefix: 'runtime/ffmpeg/0.12.10',
			files: runtimeFiles,
		},
		publication: { manifestName: 'manifest.json' },
	};
	const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
	const manifestSha256 = digest(manifestBytes);
	const releaseId = manifestSha256;
	const prefix = `runtime/ffmpeg/0.12.10/releases/${releaseId}`;
	const pointer = {
		schemaVersion: 1,
		releaseId,
		manifest: {
			path: `${prefix}/manifest.json`,
			byteLength: manifestBytes.byteLength,
			sha256: manifestSha256,
		},
		files: Object.fromEntries(runtimeFiles.map((file) => [file.name, {
			path: file.name === 'ffmpeg-core.js' && options.overrideJsPath
				? options.overrideJsPath(releaseId)
				: `${prefix}/${file.name}`,
			byteLength: file.byteLength,
			sha256: file.sha256,
		}])),
	};
	const requestedUrls: string[] = [];
	const fetch = async (input: string | URL | Request): Promise<Response> => {
		const url = String(input instanceof Request ? input.url : input);
		requestedUrls.push(url);
		if (url === `${RUNTIME_ROOT}latest.json`) return jsonResponse(pointer);
		if (url === `${RUNTIME_ROOT}releases/${releaseId}/manifest.json`) {
			const bytes = manifestBytes.slice();
			if (options.alterManifest) bytes[0] ^= 0xff;
			return byteResponse(bytes, 'application/json; charset=utf-8');
		}
		const name = url.split('/').at(-1) || '';
		const source = runtime.get(name);
		if (!source) return new Response(null, { status: 404 });
		options.afterRuntimeRequest?.(name);
		let bytes = source;
		if (options.truncateFile === name) bytes = source.subarray(0, source.byteLength - 1);
		if (options.alterFile === name) {
			bytes = source.slice();
			bytes[0] ^= 0xff;
		}
		return byteResponse(
			bytes,
			options.runtimeContentType?.(name)
				?? (name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8'),
		);
	};
	const release = Object.freeze({
		schemaVersion: 1 as const,
		releaseId,
		manifestSha256,
		baseUrl: `${RUNTIME_ROOT}releases/${releaseId}/`,
		files: Object.freeze(runtimeFiles.map((file) => Object.freeze({
			...file,
			url: `${RUNTIME_ROOT}releases/${releaseId}/${file.name}`,
		}))),
	});
	return {
		fetch,
		manifest,
		pointer,
		release,
		requestedUrls,
		totalRuntimeBytes: [...runtime.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
	};
}

function previousRelease(): VerifiedRuntimeRelease {
	return Object.freeze({
		schemaVersion: 1,
		releaseId: '0'.repeat(64),
		manifestSha256: '0'.repeat(64),
		baseUrl: `${RUNTIME_ROOT}releases/${'0'.repeat(64)}/`,
		files: Object.freeze([]),
	});
}

function jsonResponse(value: unknown): Response {
	return byteResponse(new TextEncoder().encode(JSON.stringify(value)), 'application/json; charset=utf-8');
}

function byteResponse(bytes: Uint8Array, contentType: string): Response {
	return new Response(Uint8Array.from(bytes).buffer, {
		status: 200,
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': contentType,
		},
	});
}

function encodedFetch(
	fetchImpl: typeof fetch,
	wireLength: (url: string, decodedBytes: number) => number,
): typeof fetch {
	return async (input, init) => {
		const response = await fetchImpl(input, init);
		const url = String(input instanceof Request ? input.url : input);
		const bytes = new Uint8Array(await response.arrayBuffer());
		const headers = new Headers(response.headers);
		headers.set('content-encoding', 'br');
		headers.set('content-length', String(wireLength(url, bytes.byteLength)));
		return new Response(bytes, { status: response.status, headers });
	};
}

function contentLengthReplacingFetch(
	fetchImpl: typeof fetch,
	target: string,
	replacement: (decodedBytes: number) => number,
): typeof fetch {
	return async (input, init) => {
		const response = await fetchImpl(input, init);
		const url = String(input instanceof Request ? input.url : input);
		if (!url.endsWith(`/${target}`)) return response;
		const bytes = new Uint8Array(await response.arrayBuffer());
		const headers = new Headers(response.headers);
		headers.set('content-length', String(replacement(bytes.byteLength)));
		return new Response(bytes, { status: response.status, headers });
	};
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
