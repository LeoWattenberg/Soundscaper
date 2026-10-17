/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { createMotionAeBridgeArchive } from '../src/common/editor/motion-ae-bridge-archive.ts';
test('AE bridge download retains a closed readable script/include package', async () => {
	const files = { 'Motionscaper-Export.jsx': '#target aftereffects\n#include "runtime.jsxinc"\nrun();', 'runtime.jsxinc': 'function run() {}', 'README.txt': 'No installed-AE version is qualified.' };
	const blob = await createMotionAeBridgeArchive(files), reader = new ZipReader(new BlobReader(blob));
	try {
		const entries = await reader.getEntries(); assert.deepEqual(entries.map((entry) => entry.filename).sort(), Object.keys(files).sort());
		for (const entry of entries) { assert.ok(!entry.directory); assert.equal(await entry.getData(new TextWriter()), files[entry.filename as keyof typeof files]); }
	} finally { await reader.close(); }
});
test('AE bridge download refuses incomplete include closure, traversal, oversized sources and cancellation', async () => {
	await assert.rejects(createMotionAeBridgeArchive({ 'Motionscaper-Export.jsx': '#include "missing.jsxinc"' }), /include/u);
	await assert.rejects(createMotionAeBridgeArchive({ '../escape.jsx': 'run();' }), /filename/u);
	await assert.rejects(createMotionAeBridgeArchive({ 'Motionscaper-Export.jsx': 'x'.repeat(1_048_577) }), /budget/u);
	const signal = AbortSignal.abort(new Error('cancelled')); await assert.rejects(createMotionAeBridgeArchive({ 'Motionscaper-Export.jsx': 'run();' }, signal), /cancelled/u);
});
