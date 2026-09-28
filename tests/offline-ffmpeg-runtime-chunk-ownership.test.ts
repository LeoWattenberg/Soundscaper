/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	installLatestFfmpegRuntime,
	type VerifiedRuntimeStore,
} from '../src/common/offline/ffmpeg-runtime-cache.ts';
import {
	FFMPEG_RUNTIME_FILES,
	FFMPEG_RUNTIME_POINTER_URL,
	FFMPEG_RUNTIME_PUBLIC_ORIGIN,
	FFMPEG_RUNTIME_PUBLIC_PREFIX,
	FFMPEG_RUNTIME_RELEASE_SEGMENT,
} from '../src/common/offline/ffmpeg-runtime-public-policy.ts';

const encoder = new TextEncoder();
const version = FFMPEG_RUNTIME_PUBLIC_PREFIX.split('/').at(-1)!;

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function mutatingResponse(bytes: Uint8Array, index: number, contentType: string): Response {
	const shared = bytes.slice();
	let emitted = false;
	return new Response(new ReadableStream<Uint8Array>({
		pull(controller) {
			if (!emitted) {
				emitted = true;
				controller.enqueue(shared);
				return;
			}
			shared[index] = shared[index]! ^ 1;
			controller.close();
		},
	}, { highWaterMark: 0 }), {
		status: 200,
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': contentType,
		},
	});
}

function fixture(mutate: 'manifest' | 'runtime'): typeof fetch {
	const files = FFMPEG_RUNTIME_FILES.map(({ name, contentType }) => {
		const body = encoder.encode(`${name}:verified bytes`);
		return { name, contentType, body, byteLength: body.byteLength, sha256: digest(body) };
	});
	const manifest = {
		schemaVersion: 1,
		id: `ffmpeg-core-${version}`,
		package: { name: '@ffmpeg/core', version },
		runtime: {
			publicPrefix: FFMPEG_RUNTIME_PUBLIC_PREFIX,
			files: files.map(({ name, contentType, byteLength, sha256 }) =>
				({ name, contentType, byteLength, sha256 })),
		},
		publication: { manifestName: 'manifest.json' },
	};
	const manifestText = JSON.stringify(manifest);
	const manifestBytes = encoder.encode(manifestText);
	const releaseId = digest(manifestBytes);
	const releasePath = `${FFMPEG_RUNTIME_PUBLIC_PREFIX}/${FFMPEG_RUNTIME_RELEASE_SEGMENT}/${releaseId}`;
	const pointer = {
		schemaVersion: 1,
		releaseId,
		manifest: { path: `${releasePath}/manifest.json`, byteLength: manifestBytes.byteLength,
			sha256: releaseId },
		files: Object.fromEntries(files.map(({ name, byteLength, sha256 }) => [name,
			{ path: `${releasePath}/${name}`, byteLength, sha256 }])),
	};
	return async (input) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url === FFMPEG_RUNTIME_POINTER_URL) {
			return new Response(encoder.encode(JSON.stringify(pointer)), { status: 200 });
		}
		if (url === `${FFMPEG_RUNTIME_PUBLIC_ORIGIN}/${releasePath}/manifest.json`) {
			const versionField = `"version":"${version}"`;
			const versionIndex = manifestText.indexOf(versionField) + versionField.length - 2;
			return mutate === 'manifest'
				? mutatingResponse(manifestBytes, versionIndex, 'application/json')
				: new Response(manifestBytes, { status: 200 });
		}
		const file = files.find(({ name }) => url === `${FFMPEG_RUNTIME_PUBLIC_ORIGIN}/${releasePath}/${name}`);
		if (!file) throw new Error(`Unexpected runtime URL: ${url}`);
		return mutate === 'runtime' && file.name === files[0]?.name
			? mutatingResponse(file.body, 0, file.contentType)
			: new Response(file.body, {
				status: 200,
				headers: { 'content-length': String(file.byteLength), 'content-type': file.contentType },
			});
	};
}

function recordingStore() {
	const events: string[] = [];
	const staged = new Map<string, Uint8Array>();
	const store: VerifiedRuntimeStore = {
		readActive: async () => null,
		begin: async () => {
			events.push('begin');
			return {
				put: async (file, response) => {
					const reader = response.body?.getReader();
					assert.ok(reader);
					const chunks: Uint8Array[] = [];
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						chunks.push(value);
					}
					const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
					let offset = 0;
					for (const chunk of chunks) {
						bytes.set(chunk, offset);
						offset += chunk.byteLength;
					}
					staged.set(file.name, bytes);
				},
				commit: async () => { events.push('commit'); },
				rollback: async () => { events.push('rollback'); },
			};
		},
	};
	return { store, events, staged };
}

test('a reused manifest chunk cannot change the bytes parsed after verification', async () => {
	const { store, events } = recordingStore();
	const result = await installLatestFfmpegRuntime({ pointerUrl: FFMPEG_RUNTIME_POINTER_URL,
		fetchImpl: fixture('manifest'), store });
	assert.equal(result.status, 'installed');
	assert.deepEqual(events, ['begin', 'commit']);
});

test('a reused runtime chunk cannot change the bytes staged after verification', async () => {
	const { store, events, staged } = recordingStore();
	const result = await installLatestFfmpegRuntime({ pointerUrl: FFMPEG_RUNTIME_POINTER_URL,
		fetchImpl: fixture('runtime'), store });
	assert.equal(result.status, 'installed');
	assert.deepEqual(events, ['begin', 'commit']);
	const stored = staged.get(FFMPEG_RUNTIME_FILES[0]!.name);
	assert.ok(stored);
	assert.equal(digest(stored), result.release.files[0]!.sha256);
});
