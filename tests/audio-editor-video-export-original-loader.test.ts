/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	loadVideoExportOriginal,
} from '../src/common/editor/controller/video-export-original-loader.ts';

const PROJECT = Object.freeze({
	id: 'project-1',
	sources: Object.freeze([Object.freeze({
		id: 'video-1', kind: 'video', storageKey: 'owned-video-1',
		contentSha256: '12'.repeat(32), linkedVideo: Object.freeze({ bindingToken: 'binding-1' }),
	})]),
});

test('video delivery prefers the owned media store and never consults a linked binding', async () => {
	const owned = new Blob([Uint8Array.of(1, 2, 3)]);
	const events: string[] = [];
	const store = {
		async loadMediaAsset(storageKey: string) {
			events.push(`owned:${storageKey}`);
			return owned;
		},
		async resolveLinkedVideoOriginal() {
			throw new Error('linked resolution must not run when owned media exists');
		},
	};
	const result = await loadVideoExportOriginal({
		store, project: PROJECT, sourceId: 'video-1', storageKey: 'owned-video-1',
		signal: new AbortController().signal,
		assertCurrent: () => { events.push('current'); },
	});
	assert.strictEqual(result, owned);
	assert.deepEqual(events, ['current', 'owned:owned-video-1', 'current']);
});

test('video delivery resolves one pathless linked original after an owned-store miss', async () => {
	const linked = new Blob([Uint8Array.of(4, 5, 6)], { type: 'video/webm' });
	const events: string[] = [];
	const signal = new AbortController().signal;
	const store = {
		async loadMediaAsset(storageKey: string, options: Readonly<{ signal?: AbortSignal }>) {
			assert.strictEqual(options.signal, signal);
			events.push(`owned:${storageKey}`);
			return null;
		},
		async resolveLinkedVideoOriginal(
			this: unknown,
			projectId: string,
			source: Readonly<Record<string, unknown>>,
			options: Readonly<{ signal?: AbortSignal }>,
		) {
			assert.strictEqual(this, store);
			assert.equal(projectId, 'project-1');
			assert.strictEqual(source, PROJECT.sources[0]);
			assert.strictEqual(options.signal, signal);
			events.push('linked');
			return Object.freeze({ blob: linked, binding: Object.freeze({ bindingToken: 'binding-1' }) });
		},
	};
	const result = await loadVideoExportOriginal({
		store, project: PROJECT, sourceId: 'video-1', storageKey: 'owned-video-1', signal,
		assertCurrent: () => { events.push('current'); },
	});
	assert.strictEqual(result, linked);
	assert.deepEqual(events, ['current', 'owned:owned-video-1', 'current', 'linked', 'current']);
});

test('video delivery returns missing only after both authorities and rejects non-Blob bodies', async () => {
	const base = {
		project: PROJECT, sourceId: 'video-1', storageKey: 'owned-video-1',
		signal: new AbortController().signal, assertCurrent: () => undefined,
	};
	assert.equal(await loadVideoExportOriginal({
		...base,
		store: {
			async loadMediaAsset() { return null; },
			async resolveLinkedVideoOriginal() { return null; },
		},
	}), null);
	await assert.rejects(loadVideoExportOriginal({
		...base,
		store: {
			async loadMediaAsset() { return null; },
			async resolveLinkedVideoOriginal() {
				return { blob: new Uint8Array(1) as unknown as Blob, binding: null };
			},
		},
	}), /linked .*original.*Blob/iu);
});
