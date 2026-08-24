/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryV11Handshake,
	validateSoundscaperDesktopProjectLibraryV11Handshake,
	type SoundscaperDesktopProjectLibraryV11Handshake,
} from './soundscaper-project-library-v11-contract.ts';
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS,
} from './soundscaper-project-library-v11-main-channels.ts';
import {
	validateSoundscaperDesktopProjectLibraryV11CatalogSnapshot,
	validateSoundscaperDesktopProjectLibraryV11DeleteRequest,
	validateSoundscaperDesktopProjectLibraryV11DeleteResult,
	validateSoundscaperDesktopProjectLibraryV11DuplicateRequest,
	type SoundscaperDesktopProjectLibraryV11CatalogSnapshot,
	type SoundscaperDesktopProjectLibraryV11DeleteResult,
} from './soundscaper-project-library-v11-lifecycle-contract.ts';
import {
	validateSoundscaperDesktopProjectLibraryV11PublicationAbortResult,
	validateSoundscaperDesktopProjectLibraryV11PublicationAdmission,
	validateSoundscaperDesktopProjectLibraryV11PublicationBeginRequest,
	validateSoundscaperDesktopProjectLibraryV11PublicationChunkAcknowledgement,
	validateSoundscaperDesktopProjectLibraryV11PublicationChunkRequest,
	validateSoundscaperDesktopProjectLibraryV11PublicationCompletionRequest,
	validateSoundscaperDesktopProjectLibraryV11PublicationResult,
	type SoundscaperDesktopProjectLibraryV11PublicationAdmission,
	type SoundscaperDesktopProjectLibraryV11PublicationChunkAcknowledgement,
} from './soundscaper-project-library-v11-publication-transport.ts';
import {
	validateSoundscaperDesktopProjectLibraryV11BodyChunk,
	validateSoundscaperDesktopProjectLibraryV11BodyReadRequest,
	validateSoundscaperDesktopProjectLibraryV11ProjectId,
	validateSoundscaperDesktopProjectLibraryV11TransferBundle,
	type SoundscaperDesktopProjectLibraryV11TransferBundle,
} from './soundscaper-project-library-v11-transfer-contract.ts';
import {
	validateSoundscaperNativePluginStateBodyIdV1,
	validateSoundscaperNativePluginStateBodyRecordV1,
	validateSoundscaperNativePluginStateBytesV1,
	validateSoundscaperPersistedNativePluginStateBodyV1,
	type SoundscaperDesktopNativePluginStateBodyDescriptorV1,
	type SoundscaperDesktopNativePluginStateBodyRecordV1,
} from '../src/soundscaper/desktop-native-plugin-state-transport-v1.ts';

const OPTION_FIELDS = ['invoke'] as const;

export type SoundscaperDesktopProjectLibraryV11MainPreloadHandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface SoundscaperDesktopProjectLibraryV11MainPreloadBridge {
	connect(): Promise<Readonly<SoundscaperDesktopProjectLibraryV11Handshake>>;
	handshakeState(): SoundscaperDesktopProjectLibraryV11MainPreloadHandshakeState;
	listProjects(): Promise<Readonly<SoundscaperDesktopProjectLibraryV11CatalogSnapshot>>;
	readProjectBundle(
		projectId: string,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
	beginPublication(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV11PublicationAdmission>>;
	writePublicationChunk(
		value: unknown,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV11PublicationChunkAcknowledgement>>;
	finishPublication(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle>>;
	abortPublication(value: unknown): Promise<boolean>;
	deleteProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV11DeleteResult>>;
	duplicateProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle>>;
	persistNativePluginState(value: unknown): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyDescriptorV1>>;
	readNativePluginState(bodyId: unknown): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyRecordV1> | null>;
}

/** Frozen pathless API for the Soundscaper-only sandbox preload composition. */
export function createSoundscaperDesktopProjectLibraryV11MainPreloadBridge(
	value: unknown,
): SoundscaperDesktopProjectLibraryV11MainPreloadBridge {
	const options = snapshotClosedRecord(value, OPTION_FIELDS, 'Soundscaper V11 main preload options');
	if (typeof options.invoke !== 'function') {
		throw new TypeError('Soundscaper V11 main preload requires an IPC invoke seam');
	}
	const invoke = options.invoke as (channel: string, value?: unknown) => Promise<unknown>;
	const local = createSoundscaperDesktopProjectLibraryV11Handshake();
	const publications = new Map<string, string>();
	let state: SoundscaperDesktopProjectLibraryV11MainPreloadHandshakeState = 'pending';
	let connection: Promise<Readonly<SoundscaperDesktopProjectLibraryV11Handshake>> | null = null;
	const assertOperational = (): void => {
		if (state === 'pending') {
			throw new Error('Soundscaper V11 preload handshake is required before operational IPC');
		}
		if (state === 'refused') throw new Error('Soundscaper V11 preload handshake was refused');
	};
	return Object.freeze({
		async connect() {
			if (state === 'admitted') return local;
			if (state === 'refused') throw new Error('Soundscaper V11 preload handshake was refused');
			if (connection) return connection;
			connection = invoke(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.handshake, local)
				.then((remote) => {
					try {
						const admitted = validateSoundscaperDesktopProjectLibraryV11Handshake(remote);
						state = 'admitted';
						return admitted;
					} catch (error) {
						state = 'refused';
						throw new TypeError('Soundscaper V11 preload handshake was refused', { cause: error });
					}
				}, (error: unknown) => {
					state = 'refused';
					throw new TypeError('Soundscaper V11 preload handshake was refused', { cause: error });
				});
			return connection;
		},
		handshakeState: () => state,
		async listProjects() {
			assertOperational();
			return validateSoundscaperDesktopProjectLibraryV11CatalogSnapshot(await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.listProjects,
			));
		},
		async readProjectBundle(projectIdValue: string) {
			assertOperational();
			const projectId = validateSoundscaperDesktopProjectLibraryV11ProjectId(projectIdValue);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.readProjectBundle,
				projectId,
			);
			return result === null
				? null
				: validateSoundscaperDesktopProjectLibraryV11TransferBundle(result, projectId);
		},
		async readBodyChunk(value: unknown): Promise<Uint8Array> {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11BodyReadRequest(value);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.readBodyChunk,
				request,
			);
			return validateSoundscaperDesktopProjectLibraryV11BodyChunk(result, request.length);
		},
		async beginPublication(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11PublicationBeginRequest(value);
			if (publications.has(request.publicationId)) {
				throw new Error('Soundscaper V11 preload received a duplicate publication id');
			}
			publications.set(
				request.publicationId,
				String((request.project as { readonly id: unknown }).id),
			);
			const result = validateSoundscaperDesktopProjectLibraryV11PublicationAdmission(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.beginPublication,
					request,
				),
				request.bodies.length,
			);
			if (result.publicationId !== request.publicationId) {
				throw new Error('Soundscaper V11 preload admission changed its publication id');
			}
			return result;
		},
		async writePublicationChunk(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11PublicationChunkRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Soundscaper V11 preload publication is not active');
			}
			return validateSoundscaperDesktopProjectLibraryV11PublicationChunkAcknowledgement(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.writePublicationChunk,
					request,
				),
				request,
			);
		},
		async finishPublication(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11PublicationCompletionRequest(value);
			const projectId = publications.get(request.publicationId);
			if (!projectId) throw new Error('Soundscaper V11 preload publication is not active');
			const result = validateSoundscaperDesktopProjectLibraryV11PublicationResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.finishPublication,
					request,
				),
				projectId,
			);
			publications.delete(request.publicationId);
			return result;
		},
		async abortPublication(value: unknown): Promise<boolean> {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11PublicationCompletionRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Soundscaper V11 preload publication is not active');
			}
			const result = validateSoundscaperDesktopProjectLibraryV11PublicationAbortResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.abortPublication,
					request,
				),
			);
			publications.delete(request.publicationId);
			return result;
		},
		async deleteProject(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11DeleteRequest(value);
			return validateSoundscaperDesktopProjectLibraryV11DeleteResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.deleteProject,
					request,
				),
				request.projectId,
			);
		},
		async duplicateProject(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV11DuplicateRequest(value);
			return validateSoundscaperDesktopProjectLibraryV11TransferBundle(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.duplicateProject,
					request,
				),
				request.copyProjectId,
			);
		},
		async persistNativePluginState(value: unknown) {
			assertOperational();
			const bytes = validateSoundscaperNativePluginStateBytesV1(value);
			return validateSoundscaperPersistedNativePluginStateBodyV1(await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.persistNativePluginState,
				bytes,
			), bytes);
		},
		async readNativePluginState(bodyIdValue: unknown) {
			assertOperational();
			const bodyId = validateSoundscaperNativePluginStateBodyIdV1(bodyIdValue);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS.readNativePluginState,
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
