/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Non-routed V22-V26 composition root. It owns the exact candidate store and
 * binds menu runtimes to one opaque controller; the selected V20 bootstrap
 * deliberately does not import this module.
 */

import type { NativeMediaImageSequenceRateV1 } from '../common/editor/native-media-image-sequence.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import {
	createFramescaperDormantCandidateAuthoringController,
	type FramescaperDormantAuthoringPort,
} from './editor-dormant-candidate-authoring-controller.ts';
import {
	bindFramescaperNativeCandidateProjectActions,
	type FramescaperNativeCandidateActionIntents,
	type FramescaperNativeCandidateActionOptions,
} from './editor-native-candidate-project-actions.ts';
import type { FramescaperImageSequenceImportPortsV25 } from './editor-native-image-sequence-import-v25.ts';
import {
	createFramescaperImageSequenceProductionPortsV25,
	type FramescaperNativeImageSequenceImportRendererPortV25,
} from './editor-native-image-sequence-import-production-ports-v25.ts';
import {
	selectFramescaperDesktopImageSequenceV25,
} from './editor-native-image-sequence-selection-v25.ts';
import type { FramescaperCandidateProjectStoreOptions } from './editor-project-candidate-store.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectStoreV22 } from './editor-project-store-v22.ts';
import { createFramescaperProjectStoreV24 } from './editor-project-store-v24.ts';
import { createFramescaperProjectStoreV25 } from './editor-project-store-v25.ts';
import { createFramescaperProjectStoreV26 } from './editor-project-store-v26.ts';
import type { FramescaperProjectV22 } from './editor-project-v22.ts';
import type { FramescaperProjectV24 } from './editor-project-v24.ts';
import type { FramescaperProjectV25 } from './editor-project-v25.ts';
import type { FramescaperProjectV26 } from './editor-project-v26.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;
type CandidateGeneration = 22 | 24 | 25 | 26;
type CandidateProject = FramescaperProjectV22 | FramescaperProjectV24
	| FramescaperProjectV25 | FramescaperProjectV26;
type NativeActionBase = Pick<FramescaperNativeCandidateActionOptions,
	'nativeServices' | 'proxy' | 'now'> & (
	Readonly<{
		readonly imageSequence: FramescaperImageSequenceImportPortsV25;
		readonly imageSequenceImportBridge?: never;
	}> | Readonly<{
		readonly imageSequence?: never;
		readonly imageSequenceImportBridge: FramescaperNativeImageSequenceImportRendererPortV25
			& Readonly<{ capabilities(): Promise<unknown> }>;
	}>
);
type CommonIntents = Omit<FramescaperNativeCandidateActionIntents,
	'imageSequenceImport' | 'ofFxAdd'>;

export interface FramescaperDormantImageSequenceDescription {
	readonly sourceId: string;
	readonly projectBinClipId: string;
	readonly name: string;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly maximumChunkBytes?: number;
}

type DormantNativeCommon = NativeActionBase & Readonly<{
	readonly imageSequenceSelection: Readonly<{
		readonly bridge: Pick<FramescaperNativeServicesBridge,
			'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'> | unknown;
		describe(project: CandidateProject): Awaitable<FramescaperDormantImageSequenceDescription | null>;
	}>;
}>;

export type FramescaperDormantCandidateControllerOptions =
	| Readonly<{
		readonly generation: 22;
		readonly project: FramescaperProjectV22;
		readonly storeOptions?: FramescaperCandidateProjectStoreOptions;
		readonly authoring: FramescaperDormantAuthoringPort;
	}>
	| Readonly<{
		readonly generation: 24;
		readonly project: FramescaperProjectV24;
		readonly storeOptions?: FramescaperCandidateProjectStoreOptions;
		readonly authoring: FramescaperDormantAuthoringPort;
	}>
	| Readonly<{
		readonly generation: 25;
		readonly project: FramescaperProjectV25;
		readonly storeOptions?: FramescaperCandidateProjectStoreOptions;
		readonly authoring: FramescaperDormantAuthoringPort;
		readonly native: DormantNativeCommon & Readonly<{ readonly intents: CommonIntents }>;
	}>
	| Readonly<{
		readonly generation: 26;
		readonly project: FramescaperProjectV26;
		readonly storeOptions?: FramescaperCandidateProjectStoreOptions;
		readonly authoring: FramescaperDormantAuthoringPort;
		readonly native: DormantNativeCommon & Readonly<{
			readonly intents: CommonIntents & Required<Pick<FramescaperNativeCandidateActionIntents, 'ofFxAdd'>>;
		}>;
	}>;

export interface FramescaperDormantCandidateController {
	readonly status: 'dormant-candidate';
	readonly generation: CandidateGeneration;
	project(): Promise<CandidateProject>;
	undoAuthoring(): Promise<boolean>;
	redoAuthoring(): Promise<boolean>;
	close(): Promise<void>;
}

/** Build the software-complete candidate without changing either shipped route. */
export async function createFramescaperDormantCandidateController(
	options: FramescaperDormantCandidateControllerOptions,
): Promise<FramescaperDormantCandidateController> {
	assertOptions(options);
	const generation = options.generation;
	const profile = candidateProfile(generation);
	if (Number(options.project.schemaVersion) !== generation) {
		throw new TypeError(`The dormant V${String(generation)} controller requires a V${String(generation)} project.`);
	}
	const store = candidateStore(generation, profile, options.storeOptions);
	await store.ready();
	const repository = store.projectRepository as ProjectRepositoryPort;
	if (typeof repository.createIfAbsent !== 'function') {
		await store.close();
		throw new TypeError('The dormant candidate store has no create-only project boundary.');
	}
	await repository.createIfAbsent(options.project as unknown as ProjectDocument);
	const projectId = String(options.project.id);
	const authoring = createFramescaperDormantCandidateAuthoringController({
		generation, profile, repository, project: options.project, port: options.authoring,
	});
	const controller = Object.freeze({
		status: 'dormant-candidate' as const,
		generation,
		project: () => loadExact(repository, projectId, generation),
		undoAuthoring: () => authoring.undo(),
		redoAuthoring: () => authoring.redo(),
		close: async () => { await store.close(); },
	});
	bindFramescaperCandidateAuthoringActionRuntime(controller, authoring.runtime);
	if (generation === 22 || generation === 24) return controller;
	const intents = candidateNativeIntents(options, options.native);
	try {
		await bindFramescaperNativeCandidateProjectActions({
			owner: controller, profile, store, projectId, intents,
			nativeServices: options.native.nativeServices,
			imageSequence: candidateImageSequencePorts(generation, options.native),
			proxy: options.native.proxy,
			...(options.native.now ? { now: options.native.now } : {}),
		});
	}
	catch (error) {
		await store.close();
		throw error;
	}
	return controller;
}

function candidateNativeIntents(
	options: Extract<FramescaperDormantCandidateControllerOptions, { generation: 25 | 26 }>,
	native: DormantNativeCommon & Readonly<{
		readonly intents: CommonIntents & Partial<Pick<FramescaperNativeCandidateActionIntents, 'ofFxAdd'>>;
	}>,
): FramescaperNativeCandidateActionIntents {
	const fields = options.generation === 25
		? ['renderQueueEnqueue', 'proxyGenerate', 'proxyAttach', 'proxyDetach', 'proxyRelink'] as const
		: ['renderQueueEnqueue', 'proxyGenerate', 'proxyAttach', 'proxyDetach', 'proxyRelink', 'ofFxAdd'] as const;
	exactMethods(native.intents, fields, 'native candidate intents');
	const intentRecord = native.intents as unknown as Readonly<Record<string, unknown>>;
	return Object.freeze({
		imageSequenceImport: async (project: CandidateProject) => {
			const description = await native.imageSequenceSelection.describe(structuredClone(project));
			return description === null ? null : selectFramescaperDesktopImageSequenceV25({
				bridge: native.imageSequenceSelection.bridge,
				...description,
			});
		},
		...Object.fromEntries(fields.map((field) => [field, intentRecord[field]])),
	}) as unknown as FramescaperNativeCandidateActionIntents;
}

async function loadExact(
	repository: ProjectRepositoryPort,
	projectId: string,
	generation: CandidateGeneration,
): Promise<CandidateProject> {
	const project = await repository.load(projectId);
	if (project === null || Number(project.schemaVersion) !== generation) {
		throw new Error(`The dormant V${String(generation)} project is unavailable.`);
	}
	return structuredClone(project) as CandidateProject;
}

function assertOptions(value: unknown): asserts value is FramescaperDormantCandidateControllerOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![22, 24, 25, 26].includes(Number(
			(value as Readonly<{ generation?: unknown }>).generation,
		))) {
		throw new TypeError('Dormant candidate composition requires generation 22, 24, 25, or 26.');
	}
	const options = value as unknown as FramescaperDormantCandidateControllerOptions;
	exactMethods(options.authoring, ['open'], 'authoring port');
	if (options.generation === 22 || options.generation === 24) return;
	if (!options.native.imageSequenceSelection
		|| typeof options.native.imageSequenceSelection.describe !== 'function') {
		throw new TypeError('Dormant candidate composition requires pathless image-sequence selection.');
	}
	if ((options.native.imageSequence === undefined)
		=== (options.native.imageSequenceImportBridge === undefined)) {
		throw new TypeError('Dormant candidate composition requires one image-sequence authority.');
	}
}

function candidateProfile(generation: CandidateGeneration): unknown {
	if (generation === 22) return FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE;
	if (generation === 24) return FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE;
	if (generation === 25) return FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
	return FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
}

function candidateStore(
	generation: CandidateGeneration,
	profile: unknown,
	options: FramescaperCandidateProjectStoreOptions | undefined,
) {
	if (generation === 22) return createFramescaperProjectStoreV22(profile, options);
	if (generation === 24) return createFramescaperProjectStoreV24(profile, options);
	if (generation === 25) return createFramescaperProjectStoreV25(profile, options);
	return createFramescaperProjectStoreV26(profile, options);
}

function candidateImageSequencePorts(
	generation: 25 | 26,
	native: DormantNativeCommon,
): FramescaperNativeCandidateActionOptions['imageSequence'] {
	if (native.imageSequence !== undefined) return native.imageSequence;
	const bridge = native.imageSequenceImportBridge;
	return (project) => createFramescaperImageSequenceProductionPortsV25({
		bridge,
		candidateGeneration: generation,
		projectId: String(project.id),
		projectRevision: Number(project.revision),
	});
}

function exactMethods(value: unknown, fields: readonly string[], label: string): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length) {
		throw new TypeError(`Dormant candidate ${label} must be an exact method record.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'function') {
			throw new TypeError(`Dormant candidate ${label} requires ${field}.`);
		}
	}
}
