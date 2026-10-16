/* SPDX-License-Identifier: AGPL-3.0-only */

import { createProjectAdmEditorValue } from './adm-metadata-editor-model.ts';
import { createBextMetadataEditorValue } from './bext-metadata-editor-model.ts';
import { projectAudioMetadata } from '../id3-descriptive-fields.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export function exportDialogProjectIdentity(projectValue: unknown): string | null {
	const id = dataRecord(projectValue).id;
	return typeof id === 'string' ? id : null;
}

export function createExportDialogInitialSettings(projectValue: unknown) {
	const project = dataRecord(projectValue);
	const projectMetadata = dataRecord(project.metadata);
	const tags = projectAudioMetadata(projectMetadata);
	const metadata: DataRecord = { ...projectMetadata, ...tags, genre: tags.genre, copyright: tags.copyright };
	const adm = dataRecord(metadata.adm);
	const inheritedTitle = adm.mode === 'passthrough' && adm.pristineRevision === project.revision
		&& metadata.title === project.title;
	return {
		mode: 'mix',
		chapterSource: 'labels',
		range: 'project',
		format: 'wav',
		sampleFormat: 'int24',
		bitRate: '192',
		averageBitRate: '192',
		bitRateMode: 'preset',
		bitRatePreset: '2',
		vbrQuality: '2',
		vbrMode: 'on',
		compressionLevel: '5',
		sampleRate: String(project.sampleRate || 48_000),
		channelMapping: 'preserve',
		channelMatrix: '',
		dither: 'triangular',
		loudnessNormalization: '',
		quality: '5',
		metadataTitle: String(inheritedTitle ? '' : metadata.title ?? project.title ?? ''),
		metadataArtist: String(metadata.artist || ''),
		metadataAlbum: String(metadata.album || ''),
		metadataTrack: String(metadata.trackNumber || ''),
		metadataYear: String(metadata.year || ''),
		metadataGenre: String(metadata.genre || ''),
		metadataComments: String(metadata.comments || ''),
		metadataCopyright: String(metadata.copyright || ''),
		metadataCustom: JSON.stringify(Object.fromEntries(Object.entries(projectAudioMetadata(projectMetadata))
			.filter(([key]) => !['title', 'artist', 'album', 'trackNumber', 'year', 'genre', 'comments', 'copyright', 'id3Artwork'].includes(key))), null, 2),
		metadataArtwork: String(tags.id3Artwork || ''),
		bext: createBextMetadataEditorValue(project),
		adm: createProjectAdmEditorValue(project),
		customExtension: '',
		customMimeType: 'application/octet-stream',
		customArguments: '',
		includeTail: true,
		embedLabelChapters: false,
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
