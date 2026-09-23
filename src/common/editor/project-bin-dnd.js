export const AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE = 'application/x-soundscaper-project-bin-clip';
export const AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE = 'application/x-soundscaper-freesound-result';
export const AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE = 'application/x-soundscaper-timeline-audio-clip';

let activeProjectBinDragPayload = null;
let activeTimelineClipDragPayload = null;

export function createProjectBinDragPayload(projectId, clipId) {
	if (typeof projectId !== 'string' || !projectId) throw new TypeError('A project ID is required.');
	if (typeof clipId !== 'string' || !clipId) throw new TypeError('A project-bin clip ID is required.');
	activeProjectBinDragPayload = Object.freeze({ projectId, clipId });
	return JSON.stringify(activeProjectBinDragPayload);
}

export function parseProjectBinDragPayload(value) {
	if (typeof value !== 'string' || !value) return null;
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed?.projectId !== 'string' || !parsed.projectId) return null;
		if (typeof parsed?.clipId !== 'string' || !parsed.clipId) return null;
		return Object.freeze({ projectId: parsed.projectId, clipId: parsed.clipId });
	} catch {
		return null;
	}
}

export function getActiveProjectBinDragPayload() {
	return activeProjectBinDragPayload;
}

export function clearActiveProjectBinDragPayload() {
	activeProjectBinDragPayload = null;
}

export function createTimelineClipDragPayload(projectId, clipId, mediaKind) {
	if (mediaKind !== 'audio') throw new TypeError('Only audio timeline clips can be uploaded.');
	if (typeof projectId !== 'string' || !projectId) throw new TypeError('A project ID is required.');
	if (typeof clipId !== 'string' || !clipId) throw new TypeError('A timeline clip ID is required.');
	activeTimelineClipDragPayload = Object.freeze({ projectId, clipId });
	return JSON.stringify({ ...activeTimelineClipDragPayload, mediaKind: 'audio' });
}

export function parseTimelineClipDragPayload(value) {
	if (typeof value !== 'string' || !value) return null;
	try {
		const parsed = JSON.parse(value);
		if (parsed?.mediaKind !== 'audio') return null;
		if (typeof parsed.projectId !== 'string' || !parsed.projectId) return null;
		if (typeof parsed.clipId !== 'string' || !parsed.clipId) return null;
		return Object.freeze({ projectId: parsed.projectId, clipId: parsed.clipId });
	} catch {
		return null;
	}
}

export function getActiveTimelineClipDragPayload() {
	return activeTimelineClipDragPayload;
}

export function clearActiveTimelineClipDragPayload() {
	activeTimelineClipDragPayload = null;
}

export function writeTimelineClipDragPayload(dataTransfer, projectId, clip) {
	if (clip?.kind !== 'audio') return false;
	if (!dataTransfer || typeof dataTransfer.setData !== 'function') {
		throw new TypeError('A timeline clip drag requires a DataTransfer target.');
	}
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(
		AUDIO_EDITOR_TIMELINE_CLIP_DRAG_TYPE,
		createTimelineClipDragPayload(projectId, clip.id, clip.kind),
	);
	dataTransfer.setData('text/plain', clip.title || clip.name || 'Audio clip');
	return true;
}

export function createFreesoundResultDragPayload(soundId) {
	if (!Number.isSafeInteger(soundId) || soundId < 1) {
		throw new RangeError('Freesound soundId must be a positive safe integer.');
	}
	return String(soundId);
}

export function parseFreesoundResultDragPayload(value) {
	const soundId = typeof value === 'string' ? Number(value) : 0;
	return Number.isSafeInteger(soundId) && soundId > 0 && String(soundId) === value
		? soundId
		: null;
}
