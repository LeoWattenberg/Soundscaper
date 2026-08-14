/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
	validateSoundscaperDesktopProjectLibraryV10Handshake,
	type SoundscaperDesktopProjectLibraryV10Handshake,
} from './soundscaper-project-library-v10-contract.ts';
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS,
} from './soundscaper-project-library-v10-main-channels.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10CatalogSnapshot,
	validateSoundscaperDesktopProjectLibraryV10DeleteRequest,
	validateSoundscaperDesktopProjectLibraryV10DeleteResult,
	validateSoundscaperDesktopProjectLibraryV10DuplicateRequest,
	type SoundscaperDesktopProjectLibraryV10CatalogSnapshot,
	type SoundscaperDesktopProjectLibraryV10DeleteResult,
} from './soundscaper-project-library-v10-lifecycle-contract.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10PublicationAbortResult,
	validateSoundscaperDesktopProjectLibraryV10PublicationAdmission,
	validateSoundscaperDesktopProjectLibraryV10PublicationBeginRequest,
	validateSoundscaperDesktopProjectLibraryV10PublicationChunkAcknowledgement,
	validateSoundscaperDesktopProjectLibraryV10PublicationChunkRequest,
	validateSoundscaperDesktopProjectLibraryV10PublicationCompletionRequest,
	validateSoundscaperDesktopProjectLibraryV10PublicationResult,
	type SoundscaperDesktopProjectLibraryV10PublicationAdmission,
	type SoundscaperDesktopProjectLibraryV10PublicationChunkAcknowledgement,
} from './soundscaper-project-library-v10-publication-transport.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10BodyChunk,
	validateSoundscaperDesktopProjectLibraryV10BodyReadRequest,
	validateSoundscaperDesktopProjectLibraryV10ProjectId,
	validateSoundscaperDesktopProjectLibraryV10TransferBundle,
	type SoundscaperDesktopProjectLibraryV10TransferBundle,
} from './soundscaper-project-library-v10-transfer-contract.ts';

const OPTION_FIELDS = ['invoke'] as const;

export type SoundscaperDesktopProjectLibraryV10MainPreloadHandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface SoundscaperDesktopProjectLibraryV10MainPreloadBridge {
	connect(): Promise<Readonly<SoundscaperDesktopProjectLibraryV10Handshake>>;
	handshakeState(): SoundscaperDesktopProjectLibraryV10MainPreloadHandshakeState;
	listProjects(): Promise<Readonly<SoundscaperDesktopProjectLibraryV10CatalogSnapshot>>;
	readProjectBundle(
		projectId: string,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV10TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
	beginPublication(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV10PublicationAdmission>>;
	writePublicationChunk(
		value: unknown,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV10PublicationChunkAcknowledgement>>;
	finishPublication(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV10TransferBundle>>;
	abortPublication(value: unknown): Promise<boolean>;
	deleteProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV10DeleteResult>>;
	duplicateProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV10TransferBundle>>;
}

/** Frozen pathless API for the Soundscaper-only sandbox preload composition. */
export function createSoundscaperDesktopProjectLibraryV10MainPreloadBridge(
	value: unknown,
): SoundscaperDesktopProjectLibraryV10MainPreloadBridge {
	const options = snapshotClosedRecord(value, OPTION_FIELDS, 'Soundscaper V10 main preload options');
	if (typeof options.invoke !== 'function') {
		throw new TypeError('Soundscaper V10 main preload requires an IPC invoke seam');
	}
	const invoke = options.invoke as (channel: string, value?: unknown) => Promise<unknown>;
	const local = createSoundscaperDesktopProjectLibraryV10Handshake();
	const publications = new Map<string, string>();
	let state: SoundscaperDesktopProjectLibraryV10MainPreloadHandshakeState = 'pending';
	let connection: Promise<Readonly<SoundscaperDesktopProjectLibraryV10Handshake>> | null = null;
	const assertOperational = (): void => {
		if (state === 'pending') {
			throw new Error('Soundscaper V10 preload handshake is required before operational IPC');
		}
		if (state === 'refused') throw new Error('Soundscaper V10 preload handshake was refused');
	};
	return Object.freeze({
		async connect() {
			if (state === 'admitted') return local;
			if (state === 'refused') throw new Error('Soundscaper V10 preload handshake was refused');
			if (connection) return connection;
			connection = invoke(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.handshake, local)
				.then((remote) => {
					try {
						const admitted = validateSoundscaperDesktopProjectLibraryV10Handshake(remote);
						state = 'admitted';
						return admitted;
					} catch (error) {
						state = 'refused';
						throw new TypeError('Soundscaper V10 preload handshake was refused', { cause: error });
					}
				}, (error: unknown) => {
					state = 'refused';
					throw new TypeError('Soundscaper V10 preload handshake was refused', { cause: error });
				});
			return connection;
		},
		handshakeState: () => state,
		async listProjects() {
			assertOperational();
			return validateSoundscaperDesktopProjectLibraryV10CatalogSnapshot(await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.listProjects,
			));
		},
		async readProjectBundle(projectIdValue: string) {
			assertOperational();
			const projectId = validateSoundscaperDesktopProjectLibraryV10ProjectId(projectIdValue);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.readProjectBundle,
				projectId,
			);
			return result === null
				? null
				: validateSoundscaperDesktopProjectLibraryV10TransferBundle(result, projectId);
		},
		async readBodyChunk(value: unknown): Promise<Uint8Array> {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10BodyReadRequest(value);
			const result = await invoke(
				SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.readBodyChunk,
				request,
			);
			return validateSoundscaperDesktopProjectLibraryV10BodyChunk(result, request.length);
		},
		async beginPublication(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10PublicationBeginRequest(value);
			if (publications.has(request.publicationId)) {
				throw new Error('Soundscaper V10 preload received a duplicate publication id');
			}
			publications.set(
				request.publicationId,
				String((request.project as { readonly id: unknown }).id),
			);
			const result = validateSoundscaperDesktopProjectLibraryV10PublicationAdmission(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.beginPublication,
					request,
				),
				request.bodies.length,
			);
			if (result.publicationId !== request.publicationId) {
				throw new Error('Soundscaper V10 preload admission changed its publication id');
			}
			return result;
		},
		async writePublicationChunk(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10PublicationChunkRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Soundscaper V10 preload publication is not active');
			}
			return validateSoundscaperDesktopProjectLibraryV10PublicationChunkAcknowledgement(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.writePublicationChunk,
					request,
				),
				request,
			);
		},
		async finishPublication(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10PublicationCompletionRequest(value);
			const projectId = publications.get(request.publicationId);
			if (!projectId) throw new Error('Soundscaper V10 preload publication is not active');
			const result = validateSoundscaperDesktopProjectLibraryV10PublicationResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.finishPublication,
					request,
				),
				projectId,
			);
			publications.delete(request.publicationId);
			return result;
		},
		async abortPublication(value: unknown): Promise<boolean> {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10PublicationCompletionRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Soundscaper V10 preload publication is not active');
			}
			const result = validateSoundscaperDesktopProjectLibraryV10PublicationAbortResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.abortPublication,
					request,
				),
			);
			publications.delete(request.publicationId);
			return result;
		},
		async deleteProject(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10DeleteRequest(value);
			return validateSoundscaperDesktopProjectLibraryV10DeleteResult(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.deleteProject,
					request,
				),
				request.projectId,
			);
		},
		async duplicateProject(value: unknown) {
			assertOperational();
			const request = validateSoundscaperDesktopProjectLibraryV10DuplicateRequest(value);
			return validateSoundscaperDesktopProjectLibraryV10TransferBundle(
				await invoke(
					SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.duplicateProject,
					request,
				),
				request.copyProjectId,
			);
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
