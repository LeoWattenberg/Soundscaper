import { videoExportRequestFormat } from '../video-export-request-format.ts';
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
	const visualClipIds = new Set(
		project.clips
			.filter((clip) => ['video', 'still', 'generator'].includes(clip?.kind))
			.map((clip) => clip.id),
	);
	return project.tracks.some((track) => (
		track?.type === 'video'
		&& track.clipIds?.some((clipId) => visualClipIds.has(clipId))
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
		const targetOptions = target ? { ...target.options } : null;
		// A target states its format the way a plan does; the request states it the
		// way the dialog does, because that prefix is what the export router reads
		// to send a delivery down the video path at all. Passing the plan spelling
		// through sent every targeted delivery to the audio path, where an
		// unrecognized format quietly becomes WAV.
		if (targetOptions && targetOptions.format !== undefined) {
			targetOptions.format = videoExportRequestFormat(targetOptions.format);
		}
		// The target's canvas is the starting point and the dialog refines it field
		// by field. Replacing it wholesale meant that stating any one field — a
		// background colour, a rate — dropped the target's geometry entirely, and
		// the delivery went out at the automatic canvas while the request still
		// named the target it was no longer delivering.
		const targetCanvas = targetOptions?.canvas;
		const mergedCanvas = targetCanvas && typeof targetCanvas === 'object'
			? { ...targetCanvas, ...canvas }
			: canvas;
		return {
			mode: 'mix',
			range: settings.range,
			format: settings.format,
			metadata,
			// A delivery target supplies the geometry and codec it stands for;
			// anything the dialog states explicitly still wins over it, which is
			// what makes the target a starting point rather than a lock.
			...(targetOptions ? { ...targetOptions, deliveryTarget: target.presetId } : {}),
			...(target?.degradedFrom ? { degradedFrom: target.degradedFrom } : {}),
			// Attached only when the dialog actually states geometry or a tier, so
			// an untouched dialog produces the request it always produced.
			...(Object.keys(mergedCanvas).length > 0 ? { canvas: mergedCanvas } : {}),
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
