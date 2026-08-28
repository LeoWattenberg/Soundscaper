/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDeepStrictEqual } from 'node:util';

export function createMemoryStore() {
	const projects = new Map();
	const settings = new Map();
	const analysis = new Map();
	const mediaAssets = new Map();
	const videoDerivatives = new Map();
	const audioSources = new Map();
	return {
		projects,
		settings,
		analysis,
		mediaAssets,
		videoDerivatives,
		audioSources,
		projectRepository: createMemoryProjectRepository(projects),
		pruneCalls: [],
		closeCalls: 0,
		async ready() { return this; },
		async cleanupTemporaryAssets() {},
		async requestPersistentStorage() { return false; },
		async loadSetting(key, fallback) { return settings.has(key) ? settings.get(key) : fallback; },
		async saveSetting(key, value) { settings.set(key, structuredClone(value)); },
		async saveProject(project) {
			projects.set(project.id, structuredClone(project));
			return structuredClone(project);
		},
		async loadProject(projectId) {
			const project = projects.get(projectId);
			return project ? structuredClone(project) : null;
		},
		async listProjects() { return [...projects.values()].map((project) => structuredClone(project)); },
		async duplicateProject(projectId, options = {}) {
			const source = projects.get(projectId);
			const copy = { ...structuredClone(source), id: options.id || `${projectId}-copy`, title: options.title || `${source.title} copy` };
			projects.set(copy.id, structuredClone(copy));
			return copy;
		},
		async deleteProject(projectId) { projects.delete(projectId); },
		async clear() { projects.clear(); settings.clear(); analysis.clear(); },
		async loadAnalysis(key) { return analysis.has(key) ? structuredClone(analysis.get(key)) : null; },
		async saveAnalysis(key, value) { analysis.set(key, structuredClone(value)); },
		async beginSourceWrite() { throw new Error('The controller test store has no fixture PCM writer.'); },
		async getSourceMetadata() { return null; },
		async loadSourceAudioBuffer(sourceId, context) {
			const channels = audioSources.get(sourceId);
			if (!channels) throw new Error(`Missing test PCM source ${sourceId}.`);
			const buffer = context.createBuffer(channels.length, channels[0].length, 48_000);
			for (let channel = 0; channel < channels.length; channel += 1) {
				buffer.copyToChannel(channels[channel], channel);
			}
			return buffer;
		},
		async loadMediaAsset(sourceId) { return mediaAssets.get(sourceId) || null; },
		async saveVideoDerivative(sourceId, options) {
			return saveMemoryVideoDerivative(videoDerivatives, sourceId, options);
		},
		async listVideoDerivatives(sourceId) {
			return (videoDerivatives.get(sourceId) || []).map(({ blob, ...descriptor }) => structuredClone(descriptor));
		},
		async loadVideoDerivative(sourceId, descriptor) {
			const derivative = (videoDerivatives.get(sourceId) || []).find((candidate) => (
				candidate.type === descriptor.type && candidate.timestamp === descriptor.timestamp
			));
			return derivative?.blob || null;
		},
		async pruneUnreferencedSources(options = {}) { this.pruneCalls.push(options); return { deletedSourceIds: [] }; },
		async estimateStorage() { return { usage: 0, quota: 64 * 1024 * 1024 }; },
		async close() { this.closeCalls += 1; },
	};
}

function createMemoryProjectRepository(projects) {
	return Object.freeze({
		async load(projectId, options = {}) {
			const project = projects.get(projectId);
			if (!project || (options.revision !== undefined && options.revision !== project.revision)) return null;
			return structuredClone(project);
		},
		async saveIfCurrent(expected, project) {
			if (expected.id !== project.id) throw new Error('Test project CAS cannot change project identity.');
			const current = projects.get(expected.id);
			if (!current || !isDeepStrictEqual(current, expected)) return null;
			projects.set(project.id, structuredClone(project));
			return structuredClone(project);
		},
	});
}

function saveMemoryVideoDerivative(videoDerivatives, sourceId, options = {}) {
	const {
		timestamp = 0,
		type,
		recipe = null,
		blob,
		metadata = {},
	} = options;
	const derivatives = videoDerivatives.get(sourceId) || [];
	const retained = derivatives.filter((candidate) => !(
		candidate.type === type
		&& candidate.timestamp === timestamp
		&& candidate.recipe === recipe
	));
	const saved = { timestamp, type, recipe, blob, metadata: structuredClone(metadata) };
	videoDerivatives.set(sourceId, [...retained, saved]);
	return structuredClone({ ...saved, blob: undefined });
}
