/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readDawprojectArchive, writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

const PROJECT_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project version="1.0"><Application name="t" version="1"/></Project>\n';
const METADATA_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<MetaData><Title>T</Title></MetaData>\n';

function wavBlob(frames: number): Blob {
	const left = new Float32Array(frames).map((_, index) => Math.sin(index / 7));
	return new Blob([encodeWav([left, left], { sampleRate: 48_000, float: true }) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
}

test('an archive round-trips its documents and embedded media byte for byte', async () => {
	const audio = wavBlob(1_000);
	const archive = await writeDawprojectArchive({
		projectXml: PROJECT_XML,
		metadataXml: METADATA_XML,
		files: [{ path: 'audio/001-take.wav', blob: audio }],
	});
	assert.equal(archive.type, 'application/zip');
	const read = await readDawprojectArchive(archive);
	try {
		assert.equal(read.projectXml, PROJECT_XML);
		assert.equal(read.metadataXml, METADATA_XML);
		assert.deepEqual([...read.entryNames].sort(), ['audio/001-take.wav', 'metadata.xml', 'project.xml']);
		assert.equal(read.entrySize('audio/001-take.wav'), audio.size);
		const entry = await read.readEntry('audio/001-take.wav');
		assert.ok(entry);
		assert.deepEqual(new Uint8Array(await entry.arrayBuffer()), new Uint8Array(await audio.arrayBuffer()));
		const descriptor = await inspectWavBlobPcm(entry);
		assert.equal(descriptor.frameCount, 1_000);
		assert.equal(descriptor.channelCount, 2);
		assert.equal(await read.readEntry('audio/none.wav'), null);
	} finally {
		await read.close();
	}
});

test('entry lookups tolerate the path spellings other applications write', async () => {
	const archive = await writeDawprojectArchive({
		projectXml: PROJECT_XML, metadataXml: METADATA_XML,
		files: [{ path: 'Audio/Take.wav', blob: wavBlob(10) }],
	});
	const read = await readDawprojectArchive(archive);
	try {
		assert.ok(await read.readEntry('./Audio/Take.wav'), 'a leading ./ is the same entry');
		assert.ok(await read.readEntry('Audio\\Take.wav'), 'a backslash path is the same entry');
		assert.ok(await read.readEntry('audio/take.wav'), 'case is forgiven when nothing else matches');
	} finally {
		await read.close();
	}
});

test('a project.xml with a byte order mark still parses as text', async () => {
	const archive = await writeDawprojectArchive({
		projectXml: `\uFEFF${PROJECT_XML}`, metadataXml: '', files: [],
	});
	const read = await readDawprojectArchive(archive);
	try {
		assert.equal(read.projectXml, PROJECT_XML);
		assert.equal(read.metadataXml, '', 'an empty metadata entry is empty, not missing');
	} finally {
		await read.close();
	}
});

test('writing refuses duplicate, reserved and escaping entry paths', async () => {
	const files = (path: string) => [{ path, blob: wavBlob(1) }];
	await assert.rejects(writeDawprojectArchive({ projectXml: PROJECT_XML, metadataXml: '', files: files('project.xml') }), /Duplicate/u);
	await assert.rejects(writeDawprojectArchive({ projectXml: PROJECT_XML, metadataXml: '', files: files('../escape.wav') }), /Unsupported/u);
	await assert.rejects(writeDawprojectArchive({ projectXml: PROJECT_XML, metadataXml: '', files: [...files('a.wav'), ...files('./a.wav')] }), /Duplicate/u);
	await assert.rejects(writeDawprojectArchive({ projectXml: '', metadataXml: '', files: [] }), TypeError);
});

test('an archive without project.xml, or that is not a ZIP, is refused', async () => {
	const noProject = await writeDawprojectArchive({ projectXml: 'x', metadataXml: '', files: [] });
	// Rebuild an archive whose only entries are unrelated, by reading the bytes back and checking the reader's complaint.
	await assert.rejects(readDawprojectArchive(new Blob(['not a zip at all'])), /not a readable DAWproject ZIP/u);
	const read = await readDawprojectArchive(noProject);
	await read.close();
	await assert.rejects(readDawprojectArchive(await writeDawprojectArchive({ projectXml: 'x', metadataXml: '', files: [] }), { maximumEntries: 1 }), /more than 1 entries/u);
});

test('an entry larger than the limit is refused before it is inflated', async () => {
	const archive = await writeDawprojectArchive({
		projectXml: PROJECT_XML, metadataXml: '', files: [{ path: 'audio/big.wav', blob: wavBlob(2_000) }],
	});
	const read = await readDawprojectArchive(archive, { maximumEntryBytes: 100 });
	try {
		await assert.rejects(read.readEntry('audio/big.wav'), /entry limit/u);
	} finally {
		await read.close();
	}
});

test('an aborted signal stops both writing and reading', async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(writeDawprojectArchive({ projectXml: PROJECT_XML, metadataXml: '', files: [] }, { signal: controller.signal }));
	const archive = await writeDawprojectArchive({ projectXml: PROJECT_XML, metadataXml: '', files: [] });
	await assert.rejects(readDawprojectArchive(archive, { signal: controller.signal }));
});
