export const AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE = 'application/x-soundscaper-project-bin-clip';
export const AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE = 'application/x-soundscaper-freesound-result';

let activeProjectBinDragPayload = null;

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
