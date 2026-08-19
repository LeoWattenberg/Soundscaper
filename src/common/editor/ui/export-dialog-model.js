import {
	statedVideoAudioLayout,
	statedVideoCanvas,
	statedVideoCaptions,
	statedVideoDeliveryTarget,
	statedVideoQuality,
} from './export-preset-model.ts';

export const VIDEO_EXPORT_DIALOG_FORMATS = Object.freeze([
	Object.freeze({
		id: 'video-mp4',
		labelKey: 'videoExportMp4',
	}),
	Object.freeze({
		id: 'video-webm',
		labelKey: 'videoExportWebm',
	}),
]);

const VIDEO_EXPORT_DIALOG_FORMAT_IDS = new Set(VIDEO_EXPORT_DIALOG_FORMATS.map(({ id }) => id));

export function isVideoExportDialogFormat(format) {
	return VIDEO_EXPORT_DIALOG_FORMAT_IDS.has(format);
}

export function projectHasTimelineVideo(project) {
	if (!project?.tracks?.length || !project?.clips?.length) return false;
	const videoClipIds = new Set(
		project.clips
			.filter((clip) => clip?.kind === 'video')
			.map((clip) => clip.id),
	);
	return project.tracks.some((track) => (
		track?.type === 'video'
		&& track.clipIds?.some((clipId) => videoClipIds.has(clipId))
	));
}

/**
 * The export request the dialog's settings mean.
 *
 * Declared as a plain record rather than a union of the audio and video shapes:
 * the two branches share almost nothing, so a union makes every caller narrow
 * before reading a field that is obviously there, and the request is validated
 * by the plan builder rather than by this type.
 *
 * @returns {Record<string, unknown>}
 */
export function createExportDialogRequest(settings, options = {}) {
	const metadata = options.metadata || {};
	if (isVideoExportDialogFormat(settings.format)) {
		const canvas = statedVideoCanvas(settings);
		const quality = statedVideoQuality(settings);
		const audioLayout = statedVideoAudioLayout(settings);
		const captions = statedVideoCaptions(settings);
		const target = statedVideoDeliveryTarget(settings);
		return {
			mode: 'mix',
			range: settings.range,
			format: settings.format,
			metadata,
			// A delivery target supplies the geometry and codec it stands for;
			// anything the dialog states explicitly still wins over it, which is
			// what makes the target a starting point rather than a lock.
			...(target ? { ...target.options, deliveryTarget: target.presetId } : {}),
			...(target?.degradedFrom ? { degradedFrom: target.degradedFrom } : {}),
			// Attached only when the dialog actually states geometry or a tier, so
			// an untouched dialog produces the request it always produced.
			...(Object.keys(canvas).length > 0 ? { canvas } : {}),
			...(quality ? { quality } : {}),
			...(audioLayout ? { audioLayout } : {}),
			...(captions ? { captions } : {}),
		};
	}
	return {
		mode: settings.format === 'bw64' ? 'mix' : settings.mode,
		range: settings.range,
		format: settings.format,
		...(['bwf', 'bw64'].includes(settings.format) ? { bext: options.bext ?? settings.bext } : {}),
		...(settings.format === 'bw64' ? { adm: options.adm ?? settings.adm } : {}),
		sampleFormat: settings.sampleFormat,
		bitDepth: Number(settings.sampleFormat.replace(/\D/g, '')) || undefined,
		floatingPoint: settings.sampleFormat === 'float32',
		bitRate: ['mp3', 'opus', 'mp2', 'aac-m4a'].includes(settings.format) ? Number(settings.bitRate) : undefined,
		quality: settings.format === 'ogg-vorbis' ? Number(settings.quality) : undefined,
		compressionLevel: ['flac', 'wavpack'].includes(settings.format) ? Number(settings.compressionLevel) : undefined,
		sampleRate: Number(settings.sampleRate),
		channelMapping: options.channelMapping,
		dither: settings.sampleFormat === 'float32' ? 'none' : settings.dither,
		metadata,
		extension: settings.customExtension,
		mimeType: settings.customMimeType,
		customArguments: settings.customArguments.split(/\r?\n/).map((argument) => argument.trim()).filter(Boolean),
		includeTail: settings.includeTail,
		// Stated only when a target was chosen: there is no default target, and an
		// untouched dialog must keep producing the request it always produced.
		...(settings.loudnessNormalization ? { loudnessNormalization: settings.loudnessNormalization } : {}),
		...(settings.binaural ? { binaural: true } : {}),
		...(settings.masteringSequenceId ? { masteringSequenceId: settings.masteringSequenceId } : {}),
	};
}
