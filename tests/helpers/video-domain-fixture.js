/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Minimal video source, clip, and track records shared by the video-domain
 * suites. They exist as one fixture rather than one per suite so a shape change
 * cannot leave half the video tests asserting against a project the product no
 * longer produces.
 */

export function layeredProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [
			videoSource({
				id: 'top-source',
				name: 'Top',
				storageKey: 'media/top',
				frameCount: 20_000,
				width: 1_920,
				height: 1_080,
				frameRate: 24,
			}),
			videoSource({
				id: 'lower-source',
				name: 'Lower',
				storageKey: 'media/lower',
				frameCount: 10_000,
				width: 3_840,
				height: 2_160,
				frameRate: 60,
			}),
			videoSource({
				id: 'hidden-source',
				name: 'Hidden',
				storageKey: 'media/hidden',
				frameCount: 20_000,
				width: 640,
				height: 480,
				frameRate: 25,
			}),
		],
		clips: [
			videoClip({
				id: 'top-clip',
				sourceId: 'top-source',
				timelineStartFrame: 5_000,
				durationFrames: 10_000,
				sourceStartFrame: 2_000,
				sourceDurationFrames: 10_000,
			}),
			videoClip({
				id: 'lower-clip',
				sourceId: 'lower-source',
				timelineStartFrame: 0,
				durationFrames: 20_000,
				sourceStartFrame: 0,
				sourceDurationFrames: 10_000,
				speedRatio: 0.5,
			}),
			videoClip({
				id: 'hidden-clip',
				sourceId: 'hidden-source',
				timelineStartFrame: 0,
				durationFrames: 20_000,
				sourceStartFrame: 0,
				sourceDurationFrames: 20_000,
			}),
		],
		tracks: [
			videoTrack({ id: 'top-track', clipIds: ['top-clip'] }),
			videoTrack({ id: 'lower-track', clipIds: ['lower-clip'] }),
			videoTrack({ id: 'hidden-track', clipIds: ['hidden-clip'], hidden: true }),
		],
	};
}

export function videoSource(options = {}) {
	return {
		kind: 'video',
		id: options.id || 'video-source',
		name: options.name || 'Video',
		mimeType: options.mimeType || 'video/mp4',
		storageKey: options.storageKey || `media/${options.id || 'video-source'}`,
		frameCount: options.frameCount ?? 30_000,
		sampleRate: options.sampleRate ?? 1_000,
		width: options.width ?? 1_280,
		height: options.height ?? 720,
		frameRate: options.frameRate ?? 30,
		videoCodec: options.videoCodec || 'h264',
		audioCodec: options.audioCodec || 'aac',
		hasAudio: options.hasAudio !== false,
		posterStorageKey: null,
		thumbnailStorageKey: null,
	};
}

export function videoClip(options = {}) {
	return {
		kind: 'video',
		id: options.id || 'video-clip',
		sourceId: options.sourceId || 'video-source',
		title: options.title || 'Video',
		timelineStartFrame: options.timelineStartFrame ?? 0,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		sourceDurationFrames: options.sourceDurationFrames ?? options.durationFrames ?? 1_000,
		durationFrames: options.durationFrames ?? 1_000,
		trimStartFrames: options.trimStartFrames ?? 0,
		trimEndFrames: options.trimEndFrames ?? 0,
		speedRatio: options.speedRatio ?? 1,
		groupId: null,
		avLinkId: null,
		binItemId: null,
		color: 'blue',
	};
}

export function videoTrack(options = {}) {
	return {
		type: 'video',
		id: options.id || 'video-track',
		name: options.name || 'Video',
		clipIds: options.clipIds || [],
		mute: Boolean(options.mute),
		hidden: Boolean(options.hidden),
		collapsed: false,
		height: 120,
		laneGroupId: null,
	};
}
