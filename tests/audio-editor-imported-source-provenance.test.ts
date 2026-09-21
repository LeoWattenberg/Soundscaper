/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	prepareImportedSourceProvenance,
	type ImportedMediaMetadataInspector,
} from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';
import { createImportedSourceProvenance } from '../src/common/editor/source-provenance.ts';

const INSPECT: ImportedMediaMetadataInspector = async () => ({
	metadata: {
		normalized: { artist: 'Ada', title: 'Embedded title' },
		raw: { TITLE: 'Embedded title' },
		namespaces: { vorbis: { organization: 'Soundscaper' } },
	},
	attachments: [{
		path: 'images[0]', mimeType: 'image/png', byteLength: 3,
		sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
	}],
	warnings: ['One tag was truncated.'],
});

test('normal file imports become attributed local-file provenance with embedded metadata', async () => {
	const file = new File([new Uint8Array([1, 2, 3])], 'field.wav', {
		type: 'audio/wav', lastModified: Date.parse('2026-09-20T10:00:00.000Z'),
	});
	const provenance = await prepareImportedSourceProvenance(file, {
		createContributionId: () => 'contribution-local', inspectMetadata: INSPECT,
	});

	assert.equal(provenance.classification, 'imported');
	assert.deepEqual(provenance.contributions[0], {
		id: 'contribution-local',
		origin: {
			kind: 'local-file', originalFileName: 'field.wav', mimeType: 'audio/wav',
			byteLength: 3, lastModified: '2026-09-20T10:00:00.000Z',
		},
		metadata: {
			normalized: { artist: 'Ada', title: 'Embedded title' },
			raw: { TITLE: 'Embedded title' },
			namespaces: { vorbis: { organization: 'Soundscaper' } },
		},
		attachments: [{
			path: 'images[0]', mimeType: 'image/png', byteLength: 3,
			sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
		}],
		warnings: ['One tag was truncated.'],
	});
});

test('Freesound imports retain their remote origin while enriching it with embedded file tags', async () => {
	const existing = createImportedSourceProvenance({
		id: 'contribution-freesound',
		origin: {
			kind: 'freesound', soundId: 42, soundUrl: 'https://freesound.org/s/42/',
			creator: 'Sound Maker', creatorUrl: 'https://freesound.org/people/Sound_Maker/',
			license: {
				family: 'cc-by', name: 'Attribution 4.0',
				url: 'https://creativecommons.org/licenses/by/4.0/',
			},
			importedVariant: 'preview-hq-ogg', originalFileName: 'forest.ogg', mimeType: 'audio/ogg',
		},
		metadata: {
			normalized: { title: 'API title', tags: ['forest'] },
			namespaces: {
				freesound: { id: 42 },
				vorbis: { organization: 'API organization', remoteOnly: true },
			},
		},
	});
	const provenance = await prepareImportedSourceProvenance(
		new File([new Uint8Array([1])], 'forest.ogg', { type: 'audio/ogg' }),
		{ existing, createContributionId: () => 'unused', inspectMetadata: INSPECT },
	);

	assert.equal(provenance.contributions.length, 1);
	assert.equal(provenance.contributions[0]?.origin.kind, 'freesound');
	assert.deepEqual(provenance.contributions[0]?.metadata.normalized, {
		artist: 'Ada', tags: ['forest'], title: ['Embedded title', 'API title'],
	});
	assert.deepEqual(provenance.contributions[0]?.metadata.namespaces, {
		freesound: { id: 42 },
		vorbis: {
			organization: ['Soundscaper', 'API organization'],
			remoteOnly: true,
		},
	});
	assert.equal(provenance.contributions[0]?.attachments.length, 1);
	assert.deepEqual(provenance.contributions[0]?.warnings, ['One tag was truncated.']);
});
