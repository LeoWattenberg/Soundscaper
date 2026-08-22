/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Non-routed V25/V26 composition root. It owns the exact candidate store and
 * binds menu runtimes to one opaque controller; the selected V20 bootstrap
 * deliberately does not import this module.
 */

import type { NativeMediaImageSequenceRateV1 } from '../common/editor/native-media-image-sequence.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES,
	type FramescaperCandidateAuthoringSurface,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import {
	bindFramescaperNativeCandidateProjectActions,
	type FramescaperNativeCandidateActionIntents,
	type FramescaperNativeCandidateActionOptions,
} from './editor-native-candidate-project-actions.ts';
import {
	selectFramescaperDesktopImageSequenceV25,
} from './editor-native-image-sequence-selection-v25.ts';
import type { FramescaperCandidateProjectStoreOptions } from './editor-project-candidate-store.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectStoreV25 } from './editor-project-store-v25.ts';
import { createFramescaperProjectStoreV26 } from './editor-project-store-v26.ts';
import type { FramescaperProjectV25 } from './editor-project-v25.ts';
import type { FramescaperProjectV26 } from './editor-project-v26.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;
type CandidateProject = FramescaperProjectV25 | FramescaperProjectV26;
type NativeActionBase = Pick<FramescaperNativeCandidateActionOptions,
	'nativeServices' | 'imageSequence' | 'proxy' | 'now'>;
type CommonIntents = Omit<FramescaperNativeCandidateActionIntents,
	'imageSequenceImport' | 'ofFxAdd'>;

export interface FramescaperDormantImageSequenceDescription {
	readonly sourceId: string;
	readonly projectBinClipId: string;
	readonly name: string;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly maximumChunkBytes?: number;
}

interface DormantNativeCommon extends NativeActionBase {
	readonly imageSequenceSelection: Readonly<{
		readonly bridge: Pick<FramescaperNativeServicesBridge,
			'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'> | unknown;
		describe(project: CandidateProject): Awaitable<FramescaperDormantImageSequenceDescription | null>;
	}>;
}

export type FramescaperDormantCandidateControllerOptions =
	| Readonly<{
		readonly generation: 25;
		readonly project: FramescaperProjectV25;
		readonly storeOptions?: FramescaperCandidateProjectStoreOptions;
		readonly authoring: DormantAuthoringPort;
		readonly native: DormantNativeCommon & Readonly<{ readonly intents: CommonIntents }>;
	}>
	| Readonly<{
		readonly generation: 26;
		readonly project: FramescaperProjectV26;
		readonly storeOptions?: FramescaperCandidateProjectStoreOptions;
		readonly authoring: DormantAuthoringPort;
		readonly native: DormantNativeCommon & Readonly<{
			readonly intents: CommonIntents & Required<Pick<FramescaperNativeCandidateActionIntents, 'ofFxAdd'>>;
		}>;
	}>;

export interface DormantAuthoringPort {
	open(surface: FramescaperCandidateAuthoringSurface, project: CandidateProject): Awaitable<void>;
}

export interface FramescaperDormantCandidateController {
	readonly status: 'dormant-candidate';
	readonly generation: 25 | 26;
	project(): Promise<CandidateProject>;
	close(): Promise<void>;
}

/** Build the software-complete candidate without changing either shipped route. */
export async function createFramescaperDormantCandidateController(
	options: FramescaperDormantCandidateControllerOptions,
): Promise<FramescaperDormantCandidateController> {
	assertOptions(options);
	const generation = options.generation;
	const profile = generation === 25
		? FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE : FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
	if (Number(options.project.schemaVersion) !== generation) {
		throw new TypeError(`The dormant V${String(generation)} controller requires a V${String(generation)} project.`);
	}
	const store = generation === 25
		? createFramescaperProjectStoreV25(profile, options.storeOptions)
		: createFramescaperProjectStoreV26(profile, options.storeOptions);
	await store.ready();
	const repository = store.projectRepository as ProjectRepositoryPort;
	if (typeof repository.createIfAbsent !== 'function') {
		await store.close();
		throw new TypeError('The dormant candidate store has no create-only project boundary.');
	}
	await repository.createIfAbsent(options.project as unknown as ProjectDocument);
	const projectId = String(options.project.id);
	const controller = Object.freeze({
		status: 'dormant-candidate' as const,
		generation,
		project: () => loadExact(repository, projectId, generation),
		close: async () => { await store.close(); },
	});
	const authoringRuntime = createFramescaperCandidateAuthoringActionSubsetRuntime(
		FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES,
		Object.fromEntries(FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES.map((surface) => [
			surface,
			async () => options.authoring.open(
				surface, await loadExact(repository, projectId, generation),
			),
		])),
	);
	bindFramescaperCandidateAuthoringActionRuntime(controller, authoringRuntime);
	const intents = candidateNativeIntents(options, options.native);
	try {
		await bindFramescaperNativeCandidateProjectActions({
			owner: controller, profile, store, projectId, intents,
			nativeServices: options.native.nativeServices,
			imageSequence: options.native.imageSequence,
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
	options: FramescaperDormantCandidateControllerOptions,
	native: FramescaperDormantCandidateControllerOptions['native'],
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
	generation: 25 | 26,
): Promise<CandidateProject> {
	const project = await repository.load(projectId);
	if (project === null || Number(project.schemaVersion) !== generation) {
		throw new Error(`The dormant V${String(generation)} project is unavailable.`);
	}
	return structuredClone(project) as CandidateProject;
}

function assertOptions(value: unknown): asserts value is FramescaperDormantCandidateControllerOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value as Readonly<{ generation?: unknown }>).generation !== 25
			&& (value as Readonly<{ generation?: unknown }>).generation !== 26) {
		throw new TypeError('Dormant candidate composition requires generation 25 or 26.');
	}
	const options = value as unknown as FramescaperDormantCandidateControllerOptions;
	exactMethods(options.authoring, ['open'], 'authoring port');
	if (!options.native?.imageSequenceSelection
		|| typeof options.native.imageSequenceSelection.describe !== 'function') {
		throw new TypeError('Dormant candidate composition requires pathless image-sequence selection.');
	}
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
