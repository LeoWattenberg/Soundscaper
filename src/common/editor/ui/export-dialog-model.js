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

export function createExportDialogRequest(settings, options = {}) {
	const metadata = options.metadata || {};
	if (isVideoExportDialogFormat(settings.format)) {
		return {
			mode: 'mix',
			range: settings.range,
			format: settings.format,
			metadata,
		};
	}
	return {
		mode: settings.mode,
		range: settings.range,
		format: settings.format,
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
	};
}
