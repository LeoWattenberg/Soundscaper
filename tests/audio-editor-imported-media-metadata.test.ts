/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	inspectImportedMediaMetadata,
	type ImportedMediaMetadataReader,
} from '../src/common/editor/imported-media-metadata.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';

test('import metadata retains normalized and raw text while describing binary values', async () => {
	const cover = new Uint8Array([1, 2, 3, 4]);
	const attachment = new Uint8Array([9, 8, 7]);
	const readTags: ImportedMediaMetadataReader = async () => ({
		title: 'Night train',
		artist: 'Field recordist',
		date: new Date('2025-04-03T12:30:00.000Z'),
		images: [{
			data: cover,
			mimeType: 'image/png',
			kind: 'coverFront',
			name: 'cover.png',
		}],
		raw: {
			TXXX: { place: 'Platform 4', weather: 'Rain' },
			PRIV: attachment,
		},
	});

	const inspected = await inspectImportedMediaMetadata(
		new File([new Uint8Array([0])], 'train.mp3', { type: 'audio/mpeg' }),
		{ readTags },
	);

	assert.deepEqual(inspected.metadata.normalized, {
		artist: 'Field recordist',
		date: '2025-04-03T12:30:00.000Z',
		title: 'Night train',
	});
	assert.deepEqual(inspected.metadata.raw, {
		PRIV: { attachmentPath: 'raw.PRIV' },
		TXXX: { place: 'Platform 4', weather: 'Rain' },
	});
	assert.equal(inspected.attachments.length, 2);
	assert.deepEqual(inspected.attachments.map(({ path, mimeType, name, byteLength }) => ({
		path, mimeType, name, byteLength,
	})), [{
		path: 'images[0]', mimeType: 'image/png', name: 'cover.png', byteLength: 4,
	}, {
		path: 'raw.PRIV', mimeType: 'application/octet-stream', name: undefined, byteLength: 3,
	}]);
	assert.match(inspected.attachments[0]?.sha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.match(inspected.attachments[1]?.sha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.deepEqual(inspected.warnings, []);
	assert.doesNotMatch(JSON.stringify(inspected), /"data"/u);
});

test('metadata inspection is non-fatal when a container reader refuses the file', async () => {
	const inspected = await inspectImportedMediaMetadata(
		new File([new Uint8Array([0])], 'mystery.wv', { type: 'audio/x-wavpack' }),
		{ readTags: async () => { throw new Error('unsupported container'); } },
	);

	assert.deepEqual(inspected.metadata, {});
	assert.deepEqual(inspected.attachments, []);
	assert.deepEqual(inspected.warnings, ['Metadata inspection failed: unsupported container']);
});

test('metadata preserves reserved JSON keys without changing record prototypes', async () => {
	const inspected = await inspectImportedMediaMetadata(new Blob(), {
		readTags: async () => JSON.parse('{"raw":{"__proto__":{"credit":"Ada"}}}') as unknown,
	});
	const raw = inspected.metadata.raw;
	assert.ok(raw && Object.hasOwn(raw, '__proto__'));
	assert.deepEqual(raw.__proto__, { credit: 'Ada' });
	assert.equal(Object.getPrototypeOf(raw), Object.prototype);
});

test('metadata bounds binary attachment descriptors without failing the import', async () => {
	const inspected = await inspectImportedMediaMetadata(new Blob(), {
		readTags: async () => ({
			images: Array.from({ length: 260 }, () => new Uint8Array([1])),
		}),
	});
	assert.equal(inspected.attachments.length, 256);
	assert.equal(inspected.warnings.some((warning) => warning.includes('256 attachments')), true);
});

test('AIFF text and comments are inspected before audio decoding', async () => {
	const file = aiffFile([
		chunk('NAME', new TextEncoder().encode('Harbour ambience')),
		chunk('AUTH', new TextEncoder().encode('Ada Recordist')),
		chunk('(c) ', new TextEncoder().encode('CC BY 4.0')),
		chunk('ANNO', new TextEncoder().encode('Recorded at dawn')),
		chunk('COMT', aiffComments([{ timestamp: 3_818_534_400, markerId: 7, text: 'Wind picked up' }])),
	]);

	const inspected = await inspectImportedMediaMetadata(file);

	assert.deepEqual(inspected.metadata.normalized, {
		artist: 'Ada Recordist',
		comment: 'Recorded at dawn',
		title: 'Harbour ambience',
	});
	assert.deepEqual(inspected.metadata.namespaces, {
		aiff: {
			annotations: ['Recorded at dawn'],
			comments: [{ markerId: 7, text: 'Wind picked up', timestamp: '2025-01-01T00:00:00.000Z' }],
			copyright: 'CC BY 4.0',
		},
	});
	assert.deepEqual(inspected.warnings, []);
});

test('AIFF embedded ID3 fields remain searchable metadata instead of only a binary attachment', async () => {
	const file = aiffFile([
		chunk('ID3 ', createAudioMetadataId3Tag({
			title: 'ID3 harbour',
			artist: 'ID3 recordist',
			comment: 'Inside the AIFF tag',
			location: 'North pier',
		})),
	]);

	const inspected = await inspectImportedMediaMetadata(file);

	assert.deepEqual(inspected.metadata.normalized, {
		artist: 'ID3 recordist',
		comment: 'Inside the AIFF tag',
		title: 'ID3 harbour',
	});
	assert.deepEqual(inspected.metadata.namespaces?.aiff, {
		id3: {
			artist: 'ID3 recordist',
			comment: 'Inside the AIFF tag',
			raw: {
				TIT2: 'ID3 harbour',
				TPE1: 'ID3 recordist',
				TXXX: { location: 'North pier' },
			},
			title: 'ID3 harbour',
		},
	});
	assert.equal(inspected.attachments.some(({ path }) => path === 'raw.ID3 '), true);
	assert.equal(inspected.attachments.some(({ path }) => path === 'raw.ID3.COMM'), true);
});

test('an oversized AIFF metadata chunk does not erase earlier safe metadata', async () => {
	const file = aiffFile([
		chunk('NAME', new TextEncoder().encode('Harbour ambience')),
		declaredChunk('ID3 ', 4 * 1024 * 1024 + 1),
	]);

	const inspected = await inspectImportedMediaMetadata(file);

	assert.deepEqual(inspected.metadata.normalized, { title: 'Harbour ambience' });
	assert.deepEqual(inspected.attachments, []);
	assert.deepEqual(inspected.warnings, [
		'AIFF ID3 metadata chunk exceeded 4194304 bytes and was omitted.',
	]);
});

test('metadata inspection preserves cancellation', async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		inspectImportedMediaMetadata(new Blob(), { signal: controller.signal, readTags: async () => ({}) }),
		{ name: 'AbortError' },
	);
});

function aiffFile(chunks: Uint8Array[]): File {
	const bodyLength = 4 + chunks.reduce((sum, value) => sum + value.byteLength, 0);
	const header = new Uint8Array(12);
	header.set(new TextEncoder().encode('FORM'), 0);
	new DataView(header.buffer).setUint32(4, bodyLength, false);
	header.set(new TextEncoder().encode('AIFF'), 8);
	return new File([header, ...chunks.map((value) => new Uint8Array(value))], 'ambience.aiff', {
		type: 'audio/aiff',
	});
}

function chunk(id: string, payload: Uint8Array): Uint8Array {
	const output = new Uint8Array(8 + payload.byteLength + payload.byteLength % 2);
	output.set(new TextEncoder().encode(id), 0);
	new DataView(output.buffer).setUint32(4, payload.byteLength, false);
	output.set(payload, 8);
	return output;
}

function declaredChunk(id: string, declaredByteLength: number): Uint8Array {
	const output = new Uint8Array(8);
	output.set(new TextEncoder().encode(id), 0);
	new DataView(output.buffer).setUint32(4, declaredByteLength, false);
	return output;
}

function aiffComments(comments: ReadonlyArray<Readonly<{
	timestamp: number;
	markerId: number;
	text: string;
}>>): Uint8Array {
	const encoder = new TextEncoder();
	const encoded = comments.map((comment) => ({ ...comment, bytes: encoder.encode(comment.text) }));
	const output = new Uint8Array(2 + encoded.reduce((sum, comment) => (
		sum + 8 + comment.bytes.byteLength + comment.bytes.byteLength % 2
	), 0));
	const view = new DataView(output.buffer);
	view.setUint16(0, encoded.length, false);
	let offset = 2;
	for (const comment of encoded) {
		view.setUint32(offset, comment.timestamp, false);
		view.setUint16(offset + 4, comment.markerId, false);
		view.setUint16(offset + 6, comment.bytes.byteLength, false);
		output.set(comment.bytes, offset + 8);
		offset += 8 + comment.bytes.byteLength + comment.bytes.byteLength % 2;
	}
	return output;
}
