/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../../src/common/editor/controller/lifecycle.ts';
import type { NativeProjectServiceRuntime } from '../../src/common/editor/controller/native-project-service.ts';
import type { NativeProjectDocument } from '../../src/common/editor/controller/native-project-types.ts';
import {
	PROJECT_FILE_EXTENSION_BY_PRODUCT,
	withProjectFileExtension,
} from '../../src/common/project-file-extensions.ts';

export function project(id = 'project-a'): NativeProjectDocument {
	return {
		id,
		title: id,
		schemaVersion: 5,
		sources: [],
		clips: [],
	};
}

export function nativeFile(name: string, size = 1): Blob & Readonly<{ name: string }> {
	const file = new Blob([new Uint8Array(size)]);
	Object.defineProperty(file, 'name', { value: name });
	return file as Blob & Readonly<{ name: string }>;
}

export function createFixture(overrides: Partial<NativeProjectServiceRuntime> = {}) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	let activeProject = project();
	projectGeneration.activate(activeProject.id);
	const metadata = new Map<string, Record<string, unknown>>([[activeProject.id, {}]]);
	const statuses: Array<Readonly<{ message: string; state?: string }>> = [];
	const switched: string[] = [];
	const deletedSources: string[] = [];
	let publishes = 0;
	const state = {
		importing: false,
		saveState: 'saved',
		readOnly: false,
		mobile: false,
	};
	const runtime: NativeProjectServiceRuntime = {
		lifetime,
		projectGeneration,
		state,
		copy: {
			projectNotFound: 'Project not found.',
			projectReadOnly: 'Project is read-only.',
			missingSourcesPreventSave: 'Missing sources.',
			projectSaved: 'Project saved.',
			futureProjectReadOnly: 'Future project.',
			chooseAup4File: 'Choose AUP4.',
			aup4Validating: 'Validating.',
			importing: 'Importing',
			oversizedAup4ReadOnly: 'Oversized.',
			newerAup4ReadOnly: 'Newer project.',
			aup4Opened: 'Opened.',
			aup4OnlyV2: 'AUP4 requires V2.',
			aup4Saving: 'Saving',
			sourcePcmUnavailable: 'Missing {source}.',
			aup4Saved: 'AUP4 saved.',
		},
		store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: async () => ({
				write: async () => undefined,
				commit: async () => undefined,
				abort: async () => undefined,
			}),
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
		},
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => ({ browserDownload: true }),
			prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true } }),
			saveFile: async (request) => ({ fileName: request.suggestedName, size: request.blob.size }),
		},
		getProject: () => activeProject,
		switchProject: async (nextProject) => {
			activeProject = nextProject;
			projectGeneration.activate(nextProject.id);
			metadata.set(nextProject.id, {});
			switched.push(nextProject.id);
		},
		editingBlocked: () => false,
		flushProject: async () => undefined,
		hasMissingTimelineSources: () => false,
		estimateStorageForPreflight: async () => ({ usage: 0, quota: 1_000_000 }), preflightStorage: async () => undefined,
		createStableId: (prefix) => `${prefix}-native`,
		ensureAup4FileName: (value) => `${String(value)}.aup4`,
		projectFileExtension: PROJECT_FILE_EXTENSION_BY_PRODUCT.soundscaper,
		ensureProjectFileName: withProjectFileExtension,
		sourcePcmBytes: (source) => source.frameCount * source.channelCount * 4,
		loadStoredSourceChannels: async () => [Float32Array.of(0)],
		requestAup4FileHandle: async () => ({ name: 'project.aup4' }),
		saveAup4Result: async () => ({ fileName: 'project.aup4', size: 4 }),
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false, validation: { issues: [] } }),
			decode: async () => ({ project: activeProject, sources: [] }),
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1), mimeType: 'application/x-audacity-project' }),
			inspect: async () => ({ valid: true }),
			delete: async () => undefined,
			dispose: () => undefined,
		}),
		migrateProject: (value) => ({ project: value as ReturnType<typeof project> }),
		importScapeProject: async () => ({ project: activeProject, readOnly: false, manifest: {} }),
		exportScapeProject: async () => ({ blob: new Blob(['scape']), manifest: {} }),
		copyFutureScapeArchive: async (input, write) => {
			const bytes = new Uint8Array(await input.arrayBuffer());
			await write(bytes);
			return { byteLength: bytes.byteLength, schemaVersion: 15 };
		},
		normalizeCompatibilityReport: (report, direction) => ({
			...((report && typeof report === 'object') ? report : {}),
			direction,
		}),
		reportHasMissingPcm: () => false,
		sessionTab: (projectId) => metadata.has(projectId) ? { metadata: metadata.get(projectId) } : null,
		updateProjectMetadata: (projectId, update) => {
			metadata.set(projectId, { ...metadata.get(projectId), ...update });
		},
		setStatus: (message, nextState) => { statuses.push({ message, state: nextState }); },
		publishDocumentSnapshot: () => { publishes += 1; },
		sourceBuffers: new Map(),
		sourceChunkFrames: 65_536,
		scapeMimeType: 'application/vnd.soundscaper.scape+zip',
		...overrides,
	};
	return {
		deletedSources,
		lifetime,
		metadata,
		projectGeneration,
		publishes: () => publishes,
		replaceProject(id: string) {
			activeProject = project(id);
			state.saveState = 'saved';
			projectGeneration.activate(id);
			metadata.set(id, {});
		},
		runtime,
		state,
		statuses,
		switched,
	};
}
