/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmScapeProxyImportSizes } from '../src/common/editor/scape-proxy-import-size-warning.ts';

const bytes = 512 * 1024 * 1024 + 1;
const manifest = { assets: [{ kind: 'video-proxy', size: bytes }, { kind: 'video', size: bytes }] };

test('Scape proxy body admission warns before extraction and preserves other media policies', async () => {
	const warnings: number[] = [];
	await confirmScapeProxyImportSizes(manifest, { confirmFileSizeWarning: async (warning) => {
		warnings.push(warning.byteLength); return true;
	} });
	assert.deepEqual(warnings, [bytes]);
});

test('Scape proxy warning cancellation or stale approval prevents body admission', async () => {
	await assert.rejects(confirmScapeProxyImportSizes(manifest, { confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
	const abort = new AbortController();
	await assert.rejects(confirmScapeProxyImportSizes(manifest, { signal: abort.signal,
		confirmFileSizeWarning: async () => { abort.abort(); return true; } }), { name: 'AbortError' });
});
