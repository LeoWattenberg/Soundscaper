/* SPDX-License-Identifier: AGPL-3.0-only */

import { createProjectAdmEditorValue } from './adm-metadata-editor-model.ts';
import { createBextMetadataEditorValue } from './bext-metadata-editor-model.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export function exportDialogProjectIdentity(projectValue: unknown): string | null {
	const id = dataRecord(projectValue).id;
	return typeof id === 'string' ? id : null;
}

export function createExportDialogInitialSettings(projectValue: unknown) {
	const project = dataRecord(projectValue);
	const metadata = dataRecord(project.metadata);
	return {
		mode: 'mix',
		range: 'project',
		format: 'wav',
		sampleFormat: 'int24',
		bitRate: '192',
		averageBitRate: '192',
		bitRateMode: 'preset',
		bitRatePreset: '2',
		vbrQuality: '2',
		compressionLevel: '5',
		sampleRate: String(project.sampleRate || 48_000),
		channelMapping: 'preserve',
		channelMatrix: '',
		dither: 'triangular',
		loudnessNormalization: '',
		quality: '5',
		metadataTitle: String(metadata.title || project.title || ''),
		metadataArtist: String(metadata.artist || ''),
		metadataAlbum: String(metadata.album || ''),
		metadataTrack: String(metadata.trackNumber || ''),
		metadataYear: String(metadata.year || ''),
		metadataGenre: String(metadata.genre || ''),
		metadataComments: String(metadata.comments || ''),
		metadataCopyright: String(metadata.copyright || ''),
		metadataCustom: JSON.stringify(metadata.tags || {}, null, 2) ?? '{}',
		bext: createBextMetadataEditorValue(project),
		adm: createProjectAdmEditorValue(project),
		customExtension: '',
		customMimeType: 'application/octet-stream',
		customArguments: '',
		includeTail: true,
		binaural: false,
		masteringSequenceId: '',
		canvasWidth: '',
		canvasHeight: '',
		canvasFit: 'contain',
		canvasFrameRate: '',
		canvasBackgroundColor: '',
		videoQuality: 'balanced',
		videoAudioLayout: 'preserve',
		captionTrackId: '',
		captionDelivery: 'mux',
		captionBurnIn: false,
		deliveryTarget: '',
	};
}

function dataRecord(value: unknown): DataRecord {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: {};
}
