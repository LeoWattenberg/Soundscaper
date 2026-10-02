/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBrowserExportBlobWithWarning, readBoundedFfmpegOutputFile } from '../src/common/editor/browser-export-output.ts';
import { admitAudioExportBlobWithWarning, registerFileBackedExport } from '../src/common/editor/audio-export-output.ts';
import type { FileSizeWarning } from '../src/common/editor/controller/shared/file-size-warning.ts';

test('whole-file export asks before Blob construction and allows this output after acceptance', async () => {
	const bytes = Uint8Array.of(1, 2, 3);
	const warnings: FileSizeWarning[] = [];
	const output = await prepareBrowserExportBlobWithWarning({ bytes, mimeType: 'video/mp4' }, 'Video export', 2, {
		async confirmFileSizeWarning(warning) { warnings.push(warning); return true; },
	});
	assert.equal(output.size, 3);
	assert.equal(output.type, 'video/mp4');
	assert.deepEqual(warnings, [{ label: 'Video export', byteLength: 3, thresholdBytes: 2 }]);
	await assert.rejects(prepareBrowserExportBlobWithWarning({ bytes }, 'Video export', 2, {
		async confirmFileSizeWarning() { return false; },
	}), { name: 'AbortError' });
});

test('file-backed export can exceed its warning threshold without reading or copying the body', async () => {
	const blob = new Blob();
	Object.defineProperty(blob, 'size', { value: 1_000_000_001 });
	Object.defineProperty(blob, 'arrayBuffer', { value() { throw new Error('Unexpected body read'); } });
	const warnings: FileSizeWarning[] = [];
	registerFileBackedExport(blob);
	assert.equal(await admitAudioExportBlobWithWarning(blob, 'Audio export', undefined, {
		async confirmFileSizeWarning(warning) { warnings.push(warning); return true; },
	}), blob);
	assert.equal(warnings[0]?.thresholdBytes, 1_000_000_000);
});

test('FFmpeg asks after stat and before reading, and canceled output is never materialized', async () => {
	const events: string[] = [];
	const source = {
		async statFile() { events.push('stat'); return { size: 3 }; },
		async readFile() { events.push('read'); return Uint8Array.of(1, 2, 3); },
	};
	assert.deepEqual(await readBoundedFfmpegOutputFile(source, 'out.mp4', {
		maximumBytes: 2,
		async confirmFileSizeWarning() { events.push('confirm'); return true; },
	}), Uint8Array.of(1, 2, 3));
	assert.deepEqual(events, ['stat', 'confirm', 'read']);
	events.length = 0;
	await assert.rejects(readBoundedFfmpegOutputFile(source, 'out.mp4', {
		maximumBytes: 2,
		async confirmFileSizeWarning() { events.push('confirm'); return false; },
	}), { name: 'AbortError' });
	assert.deepEqual(events, ['stat', 'confirm']);
});

test('generation or signal changes during export confirmation prevent materialization', async () => {
	let readCalls = 0;
	const abort = new AbortController();
	await assert.rejects(readBoundedFfmpegOutputFile({
		async statFile() { return { size: 3 }; },
		async readFile() { readCalls += 1; return Uint8Array.of(1, 2, 3); },
	}, 'out.mp4', {
		maximumBytes: 2, signal: abort.signal,
		async confirmFileSizeWarning() { abort.abort(); return true; },
	}), { name: 'AbortError' });
	assert.equal(readCalls, 0);
});
