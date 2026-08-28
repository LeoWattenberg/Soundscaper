/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryHandshake,
	validateSoundscaperDesktopProjectLibraryHandshake,
	type SoundscaperDesktopProjectLibraryHandshake,
} from './soundscaper-project-library-contract.ts';
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS,
} from './soundscaper-project-library-main-channels.ts';
import {
	validateSoundscaperDesktopProjectLibraryCatalogSnapshot,
	validateSoundscaperDesktopProjectLibraryDeleteRequest,
	validateSoundscaperDesktopProjectLibraryDeleteResult,
	validateSoundscaperDesktopProjectLibraryDuplicateRequest,
	type SoundscaperDesktopProjectLibraryCatalogSnapshot,
	type SoundscaperDesktopProjectLibraryDeleteResult,
} from './soundscaper-project-library-lifecycle-contract.ts';
import {
	validateSoundscaperDesktopProjectLibraryPublicationAbortResult,
	validateSoundscaperDesktopProjectLibraryPublicationAdmission,
	validateSoundscaperDesktopProjectLibraryPublicationBeginRequest,
	validateSoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement,
	validateSoundscaperDesktopProjectLibraryPublicationChunkRequest,
	validateSoundscaperDesktopProjectLibraryPublicationCompletionRequest,
	validateSoundscaperDesktopProjectLibraryPublicationResult,
	type SoundscaperDesktopProjectLibraryPublicationAdmission,
	type SoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement,
} from './soundscaper-project-library-publication-transport.ts';
import {
	validateSoundscaperDesktopProjectLibraryBodyChunk,
	validateSoundscaperDesktopProjectLibraryBodyReadRequest,
	validateSoundscaperDesktopProjectLibraryProjectId,
	validateSoundscaperDesktopProjectLibraryTransferBundle,
	type SoundscaperDesktopProjectLibraryTransferBundle,
} from './soundscaper-project-library-transfer-contract.ts';
import {
	validateSoundscaperNativePluginStateBodyIdV1,
	validateSoundscaperNativePluginStateBodyRecordV1,
	validateSoundscaperNativePluginStateBytesV1,
	validateSoundscaperPersistedNativePluginStateBodyV1,
	type SoundscaperDesktopNativePluginStateBodyDescriptorV1,
	type SoundscaperDesktopNativePluginStateBodyRecordV1,
} from '../src/soundscaper/desktop-native-plugin-state-transport-v1.ts';

const OPTION_FIELDS = ['invoke'] as const;

export type SoundscaperDesktopProjectLibraryMainPreloadHandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface SoundscaperDesktopProjectLibraryMainPreloadBridge {
	connect(): Promise<Readonly<SoundscaperDesktopProjectLibraryHandshake>>;
	handshakeState(): SoundscaperDesktopProjectLibraryMainPreloadHandshakeState;
	listProjects(): Promise<Readonly<SoundscaperDesktopProjectLibraryCatalogSnapshot>>;
	readProjectBundle(
		projectId: string,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryTransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
	beginPublication(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryPublicationAdmission>>;
	writePublicationChunk(
		value: unknown,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement>>;
	finishPublication(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryTransferBundle>>;
	abortPublication(value: unknown): Promise<boolean>;
	deleteProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryDeleteResult>>;
	duplicateProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryTransferBundle>>;
	persistNativePluginState(value: unknown): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyDescriptorV1>>;
	readNativePluginState(bodyId: unknown): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyRecordV1> | null>;
}

/** Frozen pathless API for the Soundscaper-only sandbox preload composition. */
export function createSoundscaperDesktopProjectLibraryMainPreloadBridge(
	value: unknown,
): SoundscaperDesktopProjectLibraryMainPreloadBridge {
	const options = snapshotClosedRecord(value, OPTION_FIELDS, 'Soundscaper desktop baseline main preload options');
	if (typeof options.invoke !== 'function') {
		throw new TypeError('Soundscaper desktop baseline main preload requires an IPC invoke seam');
	}
	const invoke = options.invoke as (channel: string, value?: unknown) => Promise<unknown>;
	const local = createSoundscaperDesktopProjectLibraryHandshake();
	const publications = new Map<string, string>();
	let state: SoundscaperDesktopProjectLibraryMainPreloadHandshakeState = 'pending';
	let connection: Promise<Readonly<SoundscaperDesktopProjectLibraryHandshake>> | null = null;
	const assertOperational = (): void => {
		if (state === 'pending') {
			throw new Error('Soundscaper desktop baseline preload handshake is required before operational IPC');
		}
		if (state === 'refused') throw new Error('Soundscaper desktop baseline preload handshake was refused');
	};
	return Object.freeze({
		async connect() {
			if (state === 'admitted') return local;
			if (state === 'refused') throw new Error('Soundscaper desktop baseline preload handshake was refused');
			if (connection) return connection;
			connection = invoke(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake, local)
				.then((remote) => {
					try {
						const admitted = validateSoundscaperDesktopProjectLibraryHandshake(remote);
						state = 'admitted';
						return admitted;
					} catch (error) {
						state = 'refused';
						throw new TypeError('Soundscaper desktop baseline preload handshake was refused', { cause: error });
					}
				}, (error: unknown) => {
					state = 'refused';
					throw new TypeError('Soundscaper desktop baseline preload handshake was refused', { cause: error });
				});
			return connection;
		},
		handshakeState: () => state,
		async listProjects() {
			assertOperational();
			return validateSoundscaperDesktopProjectLibraryCatalogSnapshot(await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.listProjects,
			));
		},
		async readProjectBundle(projectIdValue: string) {
			assertOperational();
			const projectId = validateSoundscaperDesktopProjectLibraryProjectId(projectIdValue);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readProjectBundle,
				projectId,
			);
			return result === null
				? null
				: validateSoundscaperDesktopProjectLibraryTransferBundle(result, projectId);
		},
		async readBodyChunk(value: unknown): Promise<Uint8Array> {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryBodyReadRequest(value);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readBodyChunk,
				request,
			);
			return validateSoundscaperDesktopProjectLibraryBodyChunk(result, request.length);
		},
		async beginPublication(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryPublicationBeginRequest(value);
			if (publications.has(request.publicationId)) {
				throw new Error('Soundscaper desktop baseline preload received a duplicate publication id');
			}
			publications.set(
				request.publicationId,
				String((request.project as { readonly id: unknown }).id),
			);
			const result = validateSoundscaperDesktopProjectLibraryPublicationAdmission(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.beginPublication,
					request,
				),
				request.bodies.length,
			);
			if (result.publicationId !== request.publicationId) {
				throw new Error('Soundscaper desktop baseline preload admission changed its publication id');
			}
			return result;
		},
		async writePublicationChunk(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryPublicationChunkRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Soundscaper desktop baseline preload publication is not active');
			}
			return validateSoundscaperDesktopProjectLibraryPublicationChunkAcknowledgement(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.writePublicationChunk,
					request,
				),
				request,
			);
		},
		async finishPublication(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryPublicationCompletionRequest(value);
			const projectId = publications.get(request.publicationId);
			if (!projectId) throw new Error('Soundscaper desktop baseline preload publication is not active');
			const result = validateSoundscaperDesktopProjectLibraryPublicationResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.finishPublication,
					request,
				),
				projectId,
			);
			publications.delete(request.publicationId);
			return result;
		},
		async abortPublication(value: unknown): Promise<boolean> {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryPublicationCompletionRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Soundscaper desktop baseline preload publication is not active');
			}
			const result = validateSoundscaperDesktopProjectLibraryPublicationAbortResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.abortPublication,
					request,
				),
			);
			publications.delete(request.publicationId);
			return result;
		},
		async deleteProject(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryDeleteRequest(value);
			return validateSoundscaperDesktopProjectLibraryDeleteResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.deleteProject,
					request,
				),
				request.projectId,
			);
		},
		async duplicateProject(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryDuplicateRequest(value);
			return validateSoundscaperDesktopProjectLibraryTransferBundle(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.duplicateProject,
					request,
				),
				request.copyProjectId,
			);
		},
		async persistNativePluginState(value: unknown) {
			assertOperational();
			const bytes = validateSoundscaperNativePluginStateBytesV1(value);
			return validateSoundscaperPersistedNativePluginStateBodyV1(await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.persistNativePluginState,
				bytes,
			), bytes);
		},
		async readNativePluginState(bodyIdValue: unknown) {
			assertOperational();
			const bodyId = validateSoundscaperNativePluginStateBodyIdV1(bodyIdValue);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readNativePluginState,
				bodyId,
			);
			return result === null ? null : validateSoundscaperNativePluginStateBodyRecordV1(result);
		},
	});
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}
