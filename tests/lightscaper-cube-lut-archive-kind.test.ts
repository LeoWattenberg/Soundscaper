/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readScapeArchiveEnvelope, type ScapeArchiveEntry, type ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { PHOTO_CUBE_LUT_ASSET_KIND, PHOTO_CUBE_LUT_ENCODING } from '../src/common/editor/scape-photo-cube-lut.ts';

function fixture(family: 'lightscaper' | 'framescaper' | 'soundscaper') {
	const entryName = `assets/luts/${'4'.repeat(64)}.cube`, projectText = JSON.stringify({ id: 'catalog', schemaFamily: family, schemaVersion: 5 });
	const bytes = new TextEncoder().encode(projectText); let bodyReads = 0;
	const manifest: ScapeManifest = { format: 'scape-project', formatVersion: 1,
		project: { entry: 'project.json', schemaFamily: family, schemaVersion: 5, size: bytes.byteLength, sha256: '0'.repeat(64) },
		assets: [{ entry: entryName, sourceId: `lut-sha256:${'4'.repeat(64)}`, kind: PHOTO_CUBE_LUT_ASSET_KIND,
			encoding: PHOTO_CUBE_LUT_ENCODING, size: 4, sha256: '4'.repeat(64) }] };
	function entry(filename: string, text: string): ScapeArchiveEntry {
		const value = new TextEncoder().encode(text);
		return { filename, directory: false, encrypted: false, compressionMethod: 0, compressedSize: value.length, uncompressedSize: value.length,
			async getData(writable, options) { if (options?.checkOverlappingEntryOnly) return;
				if (filename === entryName) bodyReads++; const writer = writable.getWriter();
				try { await writer.write(value); await writer.close(); } finally { writer.releaseLock(); } } };
	}
	return { entries: [entry('manifest.json', JSON.stringify(manifest)), entry('project.json', projectText), entry(entryName, 'cube')], bodyReads: () => bodyReads };
}

test('registered Photo LUT custody is recognized without reading or decoding its body', async () => {
	const f = fixture('lightscaper'), envelope = await readScapeArchiveEnvelope(f.entries);
	assert.equal(envelope.manifest.assets[0]?.kind, PHOTO_CUBE_LUT_ASSET_KIND); assert.equal(f.bodyReads(), 0);
});

test('an additional kind cannot smuggle Photo LUT custody into either foreign family', async () => {
	for (const family of ['framescaper', 'soundscaper'] as const) {
		const f = fixture(family); await assert.rejects(readScapeArchiveEnvelope(f.entries, {}, undefined, [PHOTO_CUBE_LUT_ASSET_KIND]));
		assert.equal(f.bodyReads(), 0);
	}
});

test('registered Photo LUT kind cannot be registered twice or duplicated in ZIP entries', async () => {
	const f = fixture('lightscaper'); await assert.rejects(readScapeArchiveEnvelope(f.entries, {}, undefined, [PHOTO_CUBE_LUT_ASSET_KIND]), /duplicate/iu);
	await assert.rejects(readScapeArchiveEnvelope([...f.entries, f.entries[2]!]), /duplicate/iu); assert.equal(f.bodyReads(), 0);
});
