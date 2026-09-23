/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FREESOUND_BROAD_SOUND_TAXONOMY,
	analyzeFreesoundUploadLicenses,
	composeFreesoundUploadDescription,
	createFreesoundUploadMetadataDefaults,
	validateFreesoundUploadMetadata,
} from '../src/common/editor/freesound-upload-metadata.ts';
import {
	createImportedSourceProvenance,
	createNonImportedSourceProvenance,
} from '../src/common/editor/source-provenance.ts';

test('Freesound upload defaults use clip title, useful source metadata, and recorded device labels', () => {
	const defaults = createFreesoundUploadMetadataDefaults({
		fileName: 'fallback.wav',
		clip: {
			title: 'Window Rain', durationFrames: 96_000, gain: 0.5,
			fadeInFrames: 240, fadeOutFrames: 480, reversed: true, inverted: false,
			pitchCents: 100, speedRatio: 0.75, warpMap: null,
		},
		source: {
			name: 'capture.wav', mimeType: 'audio/wav', sampleRate: 48_000,
			channelCount: 2, frameCount: 96_000,
			provenance: {
				...createNonImportedSourceProvenance('recorded', {
					recordingDeviceLabel: 'Studio Microphone',
				}),
			},
		},
	});

	assert.equal(defaults.title, 'Window Rain');
	assert.equal(defaults.license, 'cc-by');
	assert.match(defaults.description, /Studio Microphone/u);
	assert.match(defaults.description, /48,000 Hz/u);
	assert.match(defaults.description, /2 channels/u);
	assert.match(defaults.description, /Gain: 0\.5/u);
	assert.match(defaults.description, /Reversed/u);
	assert.match(defaults.description, /Pitch: 100 cents/u);
	assert.doesNotMatch(defaults.description, /deviceId/iu);
});

test('Freesound upload defaults fall back to a filename stem and render bounded imported metadata', () => {
	const defaults = createFreesoundUploadMetadataDefaults({
		fileName: 'Forest ambience.flac',
		source: {
			name: 'source.flac', mimeType: 'audio/flac', sampleRate: 44_100,
			channelCount: 1, frameCount: 44_100,
			provenance: createImportedSourceProvenance({
				id: 'private-internal-id',
				origin: {
					kind: 'local-file', originalFileName: 'Forest ambience.flac', mimeType: 'audio/flac',
				},
				metadata: {
					normalized: {
						artist: 'Ada', title: 'Forest take',
						tags: ['forest', 'birds', ' field recording! ', 'rain/room'],
						deviceId: 'hardware-device-id', filePath: '/private/capture.wav',
						accessToken: 'oauth-secret', homepage: 'https://example.test/private',
					},
					raw: { IART: 'Ada', privateHash: 'do-not-copy-internal-ids' },
				},
			}),
		},
	});

	assert.equal(defaults.title, 'Forest ambience');
	assert.match(defaults.description, /Artist: Ada/u);
	assert.match(defaults.description, /Title: Forest take/u);
	assert.deepEqual(defaults.tags, ['forest', 'birds', 'field-recording', 'rain-room']);
	assert.equal(defaults.requiresRightsConfirmation, true);
	assert.doesNotMatch(
		defaults.description,
		/private-internal-id|privateHash|do-not-copy|hardware-device-id|private\/capture|oauth-secret|example\.test/iu,
	);
});

test('Freesound upload license analysis enforces inherited Creative Commons restrictions', () => {
	const by = importedFreesoundProvenance('cc-by', 'Ada', 42);
	const nc = importedFreesoundProvenance('cc-by-nc', 'Bea', 43);
	const sampling = importedFreesoundProvenance('sampling-plus', 'Cy', 44);
	const cc0 = importedFreesoundProvenance('cc0', 'Dee', 45);

	assert.deepEqual(analyzeFreesoundUploadLicenses([by]).allowedLicenses, ['cc-by']);
	assert.deepEqual(analyzeFreesoundUploadLicenses([by]).defaultLicense, 'cc-by');
	assert.deepEqual(analyzeFreesoundUploadLicenses([by, nc]).allowedLicenses, ['cc-by-nc']);
	assert.equal(analyzeFreesoundUploadLicenses([by, nc]).defaultLicense, 'cc-by-nc');
	assert.deepEqual(analyzeFreesoundUploadLicenses([cc0]).allowedLicenses, ['cc0', 'cc-by', 'cc-by-nc']);
	assert.match(analyzeFreesoundUploadLicenses([sampling]).blockedReason ?? '', /Sampling\+/u);
	assert.match(analyzeFreesoundUploadLicenses([by]).attributionText, /Ada.*42.*CC BY/isu);
});

test('Freesound upload description composition keeps mandatory attribution intact', () => {
	const analysis = analyzeFreesoundUploadLicenses([importedFreesoundProvenance('cc-by', 'Ada', 42)]);
	const description = composeFreesoundUploadDescription('Editable notes.', analysis);

	assert.match(description, /^Editable notes\./u);
	assert.match(description, /Required attribution/u);
	assert.match(description, /https:\/\/freesound\.org\/s\/42\//u);
});

test('Freesound upload metadata validation requires the closed publish contract', () => {
	assert.equal(FREESOUND_BROAD_SOUND_TAXONOMY.length, 28);
	assert.equal(new Set(FREESOUND_BROAD_SOUND_TAXONOMY.map(({ id }) => id)).size, 28);
	const valid = validateFreesoundUploadMetadata({
		title: 'Window rain',
		description: 'A field recording.',
		tags: ['rain', 'window', 'field-recording'],
		categoryId: 'ss-i',
		license: 'cc-by',
		rightsConfirmed: true,
	}, {
		licenseAnalysis: analyzeFreesoundUploadLicenses([]),
		requiresRightsConfirmation: true,
	});
	assert.deepEqual(valid.tags, ['rain', 'window', 'field-recording']);
	assert.equal(valid.categoryId, 'ss-i');

	assert.throws(() => validateFreesoundUploadMetadata({
		...valid, tags: ['rain', 'window'],
	}), /at least 3 tags/iu);
	assert.throws(() => validateFreesoundUploadMetadata({
		...valid, tags: ['rain', 'window ambience', 'field-recording'],
	}), /letters, numbers/iu);
	assert.throws(() => validateFreesoundUploadMetadata({
		...valid, categoryId: 'not-a-category',
	}), /category/iu);
	assert.throws(() => validateFreesoundUploadMetadata({
		...valid, rightsConfirmed: false,
	}, { requiresRightsConfirmation: true }), /rights/iu);
});

function importedFreesoundProvenance(
	family: 'cc0' | 'cc-by' | 'cc-by-nc' | 'sampling-plus',
	creator: string,
	soundId: number,
) {
	const licenseName = family === 'cc0' ? 'CC0'
		: family === 'cc-by' ? 'CC BY'
			: family === 'cc-by-nc' ? 'CC BY-NC'
				: 'Sampling+';
	return createImportedSourceProvenance({
		id: `sound-${String(soundId)}`,
		origin: {
			kind: 'freesound', soundId, title: `Sound ${String(soundId)}`,
			soundUrl: `https://freesound.org/s/${String(soundId)}/`,
			creator,
			creatorUrl: `https://freesound.org/people/${creator}/`,
			license: {
				family, name: licenseName, url: 'https://creativecommons.org/licenses/by/4.0/',
			},
			importedVariant: 'original', originalFileName: `${String(soundId)}.wav`, mimeType: 'audio/wav',
		},
	});
}
