export const AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE = 'application/x-soundscaper-project-bin-clip';

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
