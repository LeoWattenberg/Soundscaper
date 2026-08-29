/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The blob URL behind an anchor download, and when it may be released.
 *
 * `anchor.click()` starts a save the browser completes on a later turn, so
 * revoking the URL inside the click's own turn can cancel it outright. The file
 * service has always deferred that release; the label export - the fallback
 * reached exactly when the file service cannot save - revoked immediately and
 * could lose the file it had just handed over.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { saveLabelExport } from '../src/common/editor/controller/app-helpers.ts';
import {
	OBJECT_URL_REVOKE_DELAY_MS,
	releaseDownloadObjectUrl,
} from '../src/common/editor/object-url-revoke.ts';

interface BrowserDownloadStub {
	readonly created: string[];
	readonly revoked: string[];
	readonly clicks: string[];
	readonly timers: { callback: () => void; delay: number }[];
	runTimers(): void;
	restore(): void;
}

function installBrowserDownloadStub(): BrowserDownloadStub {
	const created: string[] = [];
	const revoked: string[] = [];
	const clicks: string[] = [];
	const timers: { callback: () => void; delay: number }[] = [];
	const body = { append: () => undefined };
	const documentStub = {
		body,
		createElement: () => {
			const anchor = {
				href: '', download: '', hidden: false,
				click: () => clicks.push(anchor.href),
				remove: () => undefined,
			};
			return anchor;
		},
	};
	const urlStub = {
		createObjectURL: (blob: Blob) => {
			const url = `blob:label-${String(created.length)}-${String(blob.size)}`;
			created.push(url);
			return url;
		},
		revokeObjectURL: (url: string) => revoked.push(url),
	};
	const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const priorUrl = Object.getOwnPropertyDescriptor(globalThis, 'URL');
	const priorTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
	Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: documentStub });
	Object.defineProperty(globalThis, 'URL', { configurable: true, writable: true, value: urlStub });
	Object.defineProperty(globalThis, 'setTimeout', {
		configurable: true,
		writable: true,
		value: (callback: () => void, delay: number) => {
			timers.push({ callback, delay });
			return timers.length;
		},
	});
	return {
		created, revoked, clicks, timers,
		runTimers() {
			for (const { callback } of timers.splice(0)) callback();
		},
		restore() {
			for (const [key, descriptor] of [
				['document', priorDocument], ['URL', priorUrl], ['setTimeout', priorTimeout],
			] as const) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}

function labelExport() {
	return {
		format: 'srt',
		fileName: 'cues.srt',
		mimeType: 'application/x-subrip',
		text: '1\n00:00:00,000 --> 00:00:01,000\nOne\n',
		labelCount: 1,
		trackIds: Object.freeze(['t1']),
	};
}

test('a label download keeps its blob URL alive past the click that started it', async () => {
	const stub = installBrowserDownloadStub();
	try {
		await saveLabelExport(labelExport() as never, null, null);

		assert.deepEqual(stub.clicks, stub.created, 'the anchor must be handed the URL it downloads');
		assert.deepEqual(stub.revoked, [], 'revoking inside the click turn can cancel the save');
		assert.deepEqual(stub.timers.map(({ delay }) => delay), [OBJECT_URL_REVOKE_DELAY_MS]);

		stub.runTimers();
		assert.deepEqual(stub.revoked, stub.created, 'the URL is still released, only later');
	} finally {
		stub.restore();
	}
});

test('a custom saver or file service is used instead of an anchor download', async () => {
	const stub = installBrowserDownloadStub();
	try {
		const saved: unknown[] = [];
		await saveLabelExport(labelExport() as never, (value) => saved.push(value), null);
		const fileService = { saveFile: (request: unknown) => { saved.push(request); return 'saved'; } };
		await saveLabelExport(labelExport() as never, null, fileService as never);

		assert.equal(saved.length, 2);
		assert.deepEqual(stub.created, [], 'neither path may reach for a blob URL');
		assert.deepEqual(stub.timers, []);
	} finally {
		stub.restore();
	}
});

test('a host without a timer releases the URL rather than leaking it', () => {
	const revoked: string[] = [];
	releaseDownloadObjectUrl('blob:immediate', { revoke: (url) => revoked.push(url) });
	assert.deepEqual(revoked, ['blob:immediate']);

	const deferred: string[] = [];
	const timers: (() => void)[] = [];
	releaseDownloadObjectUrl('blob:deferred', {
		revoke: (url) => deferred.push(url),
		setTimer: (callback) => timers.push(callback),
	});
	assert.deepEqual(deferred, []);
	for (const callback of timers) callback();
	assert.deepEqual(deferred, ['blob:deferred']);

	assert.doesNotThrow(() => releaseDownloadObjectUrl('blob:none', {}));
});
