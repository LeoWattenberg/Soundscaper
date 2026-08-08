/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_PROJECT_LIBRARY_FALLBACK_ROLE_IDS = Object.freeze([
	'project-audio-mix-v1',
	'audio-track-render-v1',
	'project-video-render-v1',
	'video-clip-render-v1',
]);

export const DESKTOP_PROJECT_LIBRARY_FALLBACK_RETURN_WORKFLOW_IDS = Object.freeze([
	'audio-whole-mix-electron-roundtrip',
	'audio-track-render-electron-roundtrip',
	'video-full-project-electron-roundtrip',
	'video-clip-render-electron-roundtrip',
]);

export const DESKTOP_PROJECT_LIBRARY_FALLBACK_DIGEST_PLACEHOLDER = '0'.repeat(64);

const AUDIO_EFFECTS = 'org.soundscaper.capability.audio-effects';
const AUDIO_SPECTRAL = 'org.soundscaper.capability.audio-spectral-editing';
const VIDEO_EFFECTS = 'org.soundscaper.capability.video-effects';
const VIDEO_COMPOSITING = 'org.soundscaper.capability.video-compositing';

export function createDesktopProjectLibraryFallbackRoleWitnesses({
	projectPrefix,
	roles,
	recipientProductId,
}) {
	if (typeof projectPrefix !== 'string' || !projectPrefix
		|| !Array.isArray(roles) || roles.length !== 2
		|| !['soundscaper', 'framescaper'].includes(recipientProductId)) {
		throw new TypeError('Packaged fallback-role witness definition is invalid');
	}
	return Object.freeze(roles.map((role) => createWitness({
		projectPrefix,
		recipientProductId,
		role,
	})));
}

function createWitness({ projectPrefix, recipientProductId, role }) {
	if (!DESKTOP_PROJECT_LIBRARY_FALLBACK_ROLE_IDS.includes(role)) {
		throw new RangeError('Packaged fallback-role witness role is unsupported');
	}
	const kind = role === 'project-audio-mix-v1' || role === 'audio-track-render-v1'
		? 'audio'
		: 'video';
	const slug = role.replace(/-v1$/u, '');
	const projectId = `${projectPrefix}-${slug}-witness`;
	const source = kind === 'audio'
		? audioSource(`${projectId}-source`, `${projectId}-source-pcm`, 'Packaged native audio.wav')
		: videoSource(`${projectId}-source`, `${projectId}-source-video`, 'Packaged native video.webm');
	const fallback = kind === 'audio'
		? audioSource(`${projectId}-fallback`, `${projectId}-fallback-pcm`, 'Packaged audio fallback.wav')
		: videoSource(`${projectId}-fallback`, `${projectId}-fallback-video`, 'Packaged video fallback.webm');
	const featureId = role === 'project-audio-mix-v1' ? AUDIO_SPECTRAL
		: role === 'audio-track-render-v1' ? AUDIO_EFFECTS
			: role === 'project-video-render-v1' ? VIDEO_COMPOSITING : VIDEO_EFFECTS;
	const requirementId = `${projectId}-requirement`;
	const workflowId = DESKTOP_PROJECT_LIBRARY_FALLBACK_RETURN_WORKFLOW_IDS[
		DESKTOP_PROJECT_LIBRARY_FALLBACK_ROLE_IDS.indexOf(role)
	];
	return deepFreeze({
		projectId,
		workflowId,
		title: `Packaged ${role} witness`,
		recipientProductId,
		kind,
		role,
		featureId,
		requirementId,
		source,
		fallback,
		document: createDocument({
			projectId,
			title: `Packaged ${role} witness`,
			kind,
			role,
			featureId,
			requirementId,
			source,
			fallback,
		}),
	});
}

function audioSource(sourceId, storageKey, name) {
	return Object.freeze({
		kind: 'audio', sourceId, storageKey, name,
		frameCount: 4_800, channelCount: 2, sampleRate: 48_000,
	});
}

function videoSource(sourceId, storageKey, name) {
	return Object.freeze({
		kind: 'video', sourceId, storageKey, name,
		frameCount: 48_000, sampleRate: 48_000,
		width: 64, height: 36, frameRate: 30,
	});
}

function createDocument({
	projectId, title, kind, role, featureId, requirementId, source, fallback,
}) {
	const audio = kind === 'audio';
	const trackId = `${projectId}-track`;
	const clipId = `${projectId}-clip`;
	const trackRelationship = role === 'audio-track-render-v1';
	const clipRelationship = role === 'video-clip-render-v1';
	const requirementFallback = {
		role,
		kind,
		sourceId: fallback.sourceId,
		sha256: DESKTOP_PROJECT_LIBRARY_FALLBACK_DIGEST_PLACEHOLDER,
		...(trackRelationship ? { targetTrackId: trackId } : {}),
		...(clipRelationship ? { targetClipId: clipId } : {}),
	};
	return JSON.stringify({
		schemaVersion: 9,
		id: projectId,
		title,
		revision: 1,
		createdAt: '2026-08-08T12:00:00.000Z',
		updatedAt: '2026-08-08T12:00:00.000Z',
		sampleRate: 48_000,
		masterChannels: 2,
		tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, detected: false },
		snap: { enabled: false, unit: 'seconds', mode: 'nearest', triplets: false, division: 'seconds', opaqueType: 0 },
		timeDisplay: { format: 'hh:mm:ss+milliseconds' },
		metadata: {
			title, artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {}, bext: null, adm: null,
		},
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		view: {
			scrollFrame: 0, pixelsPerSecond: 100, playheadFrame: 0, zoom: 100,
			horizontalPosition: 0, verticalPosition: 0, selectedTrackIds: [], panelState: {},
		},
		sources: [sourceDocument(source), sourceDocument(fallback)],
		clips: [audio ? audioClip(clipId, source) : videoClip(clipId, source, clipRelationship)],
		tracks: [audio
			? audioTrack(trackId, clipId, trackRelationship)
			: videoTrack(trackId, clipId)],
		master: {
			gain: 1, pan: 0, mute: false, solo: false, envelope: [],
			collapsed: true, effectsActive: true, effects: [],
		},
		mixer: { groups: [], sends: [], routes: {} },
		opaqueExtensions: { packagedFallbackRole: role },
		projectBin: { clips: audio ? [] : [videoClip(`${projectId}-bin-clip`, source, false, `${projectId}-bin-item`)] },
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: requirementId,
			featureId,
			displayName: `Packaged ${role}`,
			disposition: 'rendered-fallback',
			fallback: requirementFallback,
		}] },
	});
}

function sourceDocument(source) {
	if (source.kind === 'audio') {
		return {
			id: source.sourceId, name: source.name, mimeType: 'audio/wav', storageKey: source.storageKey,
			frameCount: source.frameCount, channelCount: source.channelCount, sampleRate: source.sampleRate,
			originalSampleRate: source.sampleRate, sampleFormat: 'float32', chunkFrames: source.frameCount,
			opaqueExtensions: {}, kind: 'audio',
		};
	}
	return {
		kind: 'video', id: source.sourceId, name: source.name, mimeType: 'video/webm', storageKey: source.storageKey,
		frameCount: source.frameCount, sampleRate: source.sampleRate, width: source.width, height: source.height,
		frameRate: source.frameRate, videoCodec: 'vp8', audioCodec: null, hasAudio: false,
		posterStorageKey: null, thumbnailStorageKey: null, opaqueExtensions: {},
	};
}

function audioClip(id, source) {
	return {
		id, sourceId: source.sourceId, title: 'Packaged native audio', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount,
		trimStartFrames: 0, trimEndFrames: 0, gain: 1, fadeInFrames: 0, fadeOutFrames: 0,
		reversed: false, envelope: [], groupId: null, color: 'auto', pitchCents: 0, speedRatio: 1,
		preserveFormants: false, stretchToTempo: false, renderCacheRevision: 0,
		opaqueExtensions: {}, kind: 'audio', avLinkId: null, binItemId: null,
	};
}

function videoClip(id, source, effect, binItemId = null) {
	return {
		kind: 'video', id, sourceId: source.sourceId, title: 'Packaged native video', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount,
		trimStartFrames: 0, trimEndFrames: 0, groupId: null, color: 'auto', speedRatio: 1,
		avLinkId: null, binItemId, opaqueExtensions: {}, videoEffects: effect ? [{
			id: `${id}-pixelate`, type: 'pixelate', enabled: true, params: { blockSize: 16 },
		}] : [],
	};
}

function audioTrack(id, clipId, effect) {
	return {
		type: 'audio', id, name: 'Packaged fallback witness', gain: 1, pan: 0, mute: false, solo: false,
		armed: false, displayMode: 'waveform', color: 'blue', spectrogram: {
			scale: 'mel', minimumFrequency: 0, maximumFrequency: 20_000,
			windowSize: 2_048, windowType: 'hann', gain: 20, range: 80,
		},
		envelope: [], effectsActive: true, effects: effect ? [{
			id: `${id}-compressor`, type: 'compressor', enabled: true,
			params: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25, makeupGain: 0 },
		}] : [], clipIds: [clipId], collapsed: false, height: 160, opaqueExtensions: {}, laneGroupId: null,
	};
}

function videoTrack(id, clipId) {
	return {
		type: 'video', id, name: 'Packaged fallback witness', clipIds: [clipId], mute: false,
		hidden: false, collapsed: false, height: 120, laneGroupId: null, opaqueExtensions: {},
	};
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
