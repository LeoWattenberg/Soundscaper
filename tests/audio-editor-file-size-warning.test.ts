/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmFileSizeWarning, FileSizeWarningRequiredError } from '../src/common/editor/controller/shared/file-size-warning.ts';

test('files below the warning threshold proceed without asking', async () => {
	let asked = false;
	assert.equal(await confirmFileSizeWarning(12, 12, 'clip.wav', {
		confirmFileSizeWarning: async () => { asked = true; return false; },
	}), 12);
	assert.equal(asked, false);
});

test('a larger file can continue after explicit approval and supplies its admitted bound', async () => {
	const warnings: unknown[] = [];
	assert.equal(await confirmFileSizeWarning(13, 12, 'clip.wav', {
		confirmFileSizeWarning: async (warning) => { warnings.push(warning); return true; },
	}), 13);
	assert.deepEqual(warnings, [{ label: 'clip.wav', byteLength: 13, thresholdBytes: 12 }]);
});

test('approval is requested separately for each operation', async () => {
	let asked = 0;
	const options = { confirmFileSizeWarning: async () => { asked += 1; return true; } };
	await confirmFileSizeWarning(13, 12, 'clip.wav', options);
	await confirmFileSizeWarning(13, 12, 'clip.wav', options);
	assert.equal(asked, 2);
});

test('cancel and missing confirmation cannot admit a larger file', async () => {
	await assert.rejects(confirmFileSizeWarning(13, 12, 'clip.wav'), FileSizeWarningRequiredError);
	await assert.rejects(confirmFileSizeWarning(13, 12, 'clip.wav', {
		confirmFileSizeWarning: async () => false,
	}), { name: 'AbortError', code: 'ABORTED' });
});

test('aborted or stale operations cannot use a delayed approval', async () => {
	const abort = new AbortController();
	const reason = new Error('Canceled while warning was open');
	await assert.rejects(confirmFileSizeWarning(13, 12, 'clip.wav', {
		signal: abort.signal,
		confirmFileSizeWarning: async () => { abort.abort(reason); return true; },
	}), (error) => error === reason);
	let current = true;
	await assert.rejects(confirmFileSizeWarning(13, 12, 'clip.wav', {
		assertCurrent: () => { if (!current) throw new Error('Project changed'); },
		confirmFileSizeWarning: async () => { current = false; return true; },
	}), /Project changed/u);
});

test('approval never bypasses safe byte-count validation', async () => {
	let asked = false;
	const options = { confirmFileSizeWarning: async () => { asked = true; return true; } };
	for (const bytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
		await assert.rejects(confirmFileSizeWarning(bytes, 12, 'clip.wav', options), RangeError);
	}
	for (const threshold of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		await assert.rejects(confirmFileSizeWarning(13, threshold, 'clip.wav', options), RangeError);
	}
	assert.equal(asked, false);
});
