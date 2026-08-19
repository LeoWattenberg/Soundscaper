/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	recordScapeArchiveManifest,
	saveCurrentScapeArchiveManifest,
	verifyScapeArchiveAgainstManifest,
} from '../src/common/editor/controller/scape-archive-manifest-action.ts';
import { serializeArchiveManifest } from '../src/common/editor/archive-manifest.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

const PROJECT = new TextEncoder().encode('{"schemaVersion":9}');
const MEDIA = Uint8Array.from({ length: 2_048 }, (_value, index) => index % 251);

test('a saved archive records a manifest of the bytes it actually contains', async () => {
	const runtime = createRuntime();
	const record = await recordScapeArchiveManifest(runtime, {
		archive: archive(),
		fileName: 'Cafe Film.scape',
		projectTitle: 'Cafe Film',
		generatedAt: '2026-08-19T00:00:00.000Z',
	});

	assert.equal(record.unavailable, null);
	assert.deepEqual(record.manifest?.members.map(({ id }) => id), ['media/a.wav', 'project.json']);
	// Digested from the archive rather than copied from the export manifest the
	// writer produced, which would agree with the writer by construction.
	assert.equal(
		record.manifest?.members.find(({ id }) => id === 'media/a.wav')?.sha256,
		digestScapeBytes(MEDIA),
	);
	assert.equal(runtime.state.archiveManifest, record);
	assert.equal(runtime.published, 1);
});

test('a streamed save says the archive was never held rather than inventing one', async () => {
	const runtime = createRuntime();
	const record = await recordScapeArchiveManifest(runtime, {
		archive: null, fileName: 'Cafe Film.scape',
	});

	assert.equal(record.manifest, null);
	assert.match(String(record.unavailable), /streamed straight to its destination/u);
	// "We did not check" and "we checked and it passed" stay different answers.
	const saved = await saveCurrentScapeArchiveManifest(runtime);
	assert.equal(saved.saved, false);
	assert.match(String(saved.reason), /streamed straight to its destination/u);
	assert.equal(runtime.saved.length, 0);
});

test('the recorded manifest saves as a report document', async () => {
	const runtime = createRuntime();
	await recordScapeArchiveManifest(runtime, {
		archive: archive(), fileName: 'Cafe Film.scape', projectTitle: 'Cafe Film',
	});
	const saved = await saveCurrentScapeArchiveManifest(runtime);

	assert.equal(saved.saved, true);
	assert.equal(runtime.saved.length, 1);
	assert.equal(runtime.saved[0]?.purpose, 'report');
	assert.match(String(runtime.saved[0]?.suggestedName), /archive-manifest.*\.json$/u);
});

test('verification against the saved manifest names what drifted', async () => {
	const runtime = createRuntime();
	const record = await recordScapeArchiveManifest(runtime, {
		archive: archive(), fileName: 'Cafe Film.scape',
	});
	const text = serializeArchiveManifest(record.manifest!).text;

	const clean = await verifyScapeArchiveAgainstManifest(archive(), text);
	assert.equal(clean.ok, true);

	const tampered = await verifyScapeArchiveAgainstManifest(
		archive(Uint8Array.from(MEDIA, (value) => value ^ 1)), text,
	);
	assert.equal(tampered.ok, false);
	assert.deepEqual(tampered.mismatches.map(({ kind, member }) => `${kind}:${member}`), ['digest:media/a.wav']);
});

test('a manifest document that cannot be parsed is refused rather than passing', async () => {
	// Verifying against a manifest nobody can read would report a clean archive
	// for the wrong reason.
	await assert.rejects(verifyScapeArchiveAgainstManifest(archive(), '{"kind":"nonsense"}'), /manifest/iu);
	await assert.rejects(verifyScapeArchiveAgainstManifest(archive(), 'not json'), /./u);
});

function archive(media: Uint8Array = MEDIA): Blob {
	// A zip-shaped Blob is unnecessary: the reader is injected in the module's
	// own tests, and here the real reader is exercised through a real archive.
	return zip([
		{ name: 'media/a.wav', bytes: media },
		{ name: 'project.json', bytes: PROJECT },
	]);
}

/** A minimal STORE-only zip, which is what a `.scape` is. */
function zip(entries: readonly Readonly<{ name: string; bytes: Uint8Array }>[]): Blob {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.bytes);
		const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true);
		localView.setUint16(8, 0, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, entry.bytes.byteLength, true);
		localView.setUint32(22, entry.bytes.byteLength, true);
		localView.setUint16(26, name.byteLength, true);
		local.set(name, 30);
		local.set(entry.bytes, 30 + name.byteLength);
		locals.push(local);

		const central = new Uint8Array(46 + name.byteLength);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, 0x02014b50, true);
		centralView.setUint16(4, 20, true);
		centralView.setUint16(6, 20, true);
		centralView.setUint16(10, 0, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, entry.bytes.byteLength, true);
		centralView.setUint32(24, entry.bytes.byteLength, true);
		centralView.setUint16(28, name.byteLength, true);
		centralView.setUint32(42, offset, true);
		central.set(name, 46);
		centrals.push(central);
		offset += local.byteLength;
	}
	const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);
	return new Blob([...locals, ...centrals, end].map((part) => part.slice().buffer));
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function createRuntime() {
	const saved: Record<string, unknown>[] = [];
	const state: Record<string, unknown> = {};
	const runtime = {
		state,
		published: 0,
		saved,
		fileService: {
			saveFile(request: Record<string, unknown>) { saved.push(request); return { cancelled: false }; },
		},
		publishDocumentSnapshot() { runtime.published += 1; },
	};
	return runtime;
}
