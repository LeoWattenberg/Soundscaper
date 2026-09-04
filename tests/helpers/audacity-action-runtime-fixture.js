/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * In-memory ports for an editor controller under an action-parity test.
 *
 * Each answers the narrowest contract the controller needs to boot and nothing more — the
 * PCM writer refuses outright — so a test that accidentally reaches past the action it is
 * exercising fails loudly instead of quietly persisting somewhere.
 */

export function valueAtPath(root, path) {
	return path.split('.').reduce((value, segment) => value?.[segment], root);
}

export const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	storage: 'Storage',
	genericError: 'Error: {message}',
	unknownError: 'Unknown error',
});

export function createMemoryStore() {
	const projects = new Map();
	const settings = new Map();
	return {
		settings,
		async ready() { return this; },
		async cleanupTemporaryAssets() {},
		async requestPersistentStorage() { return false; },
		async loadSetting(key, fallback) { return settings.has(key) ? settings.get(key) : fallback; },
		async saveSetting(key, value) { settings.set(key, structuredClone(value)); },
		async saveProject(project) { projects.set(project.id, structuredClone(project)); },
		async loadProject(projectId) { return projects.has(projectId) ? structuredClone(projects.get(projectId)) : null; },
		async listProjects() { return [...projects.values()].map((project) => structuredClone(project)); },
		async beginSourceWrite() { throw new Error('No PCM writer is needed for this parity test.'); },
		async getSourceMetadata() { return null; },
		async loadAnalysis() { return null; },
		async saveAnalysis() {},
		async pruneUnreferencedSources() { return { deletedSourceIds: [] }; },
		async estimateStorage() { return { usage: 0, quota: 64 * 1024 * 1024 }; },
		async close() {},
	};
}

export function createMemoryEngine() {
	return {
		loadProject() {},
		async applyProject() {},
		setSourceResolver() {},
		getPositionFrames() { return 0; },
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		stop() {},
		seek(frame) { return Math.max(0, Math.round(frame)); },
		async getAudioContext() { return null; },
		async dispose() {},
	};
}

export function createMemoryTimePitchCache() {
	return {
		createEngineSourceResolver() { return null; },
		retainClipIds() {},
		getProtectedSourceIds() { return new Set(); },
		dispose() {},
	};
}
