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
		return byteResponse(bytes, name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
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

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
