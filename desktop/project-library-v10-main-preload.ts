/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
	validateFramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Handshake,
} from './project-library-v10-contract.ts';
import {
	FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS,
} from './project-library-v10-main-channels.ts';
import {
	validateFramescaperDesktopProjectLibraryV10CatalogSnapshot,
	validateFramescaperDesktopProjectLibraryV10DeleteRequest,
	validateFramescaperDesktopProjectLibraryV10DeleteResult,
	validateFramescaperDesktopProjectLibraryV10DuplicateRequest,
	type FramescaperDesktopProjectLibraryV10CatalogSnapshot,
	type FramescaperDesktopProjectLibraryV10DeleteResult,
} from './project-library-v10-lifecycle-contract.ts';
import {
	validateFramescaperDesktopProjectLibraryV10PublicationAbortResult,
	validateFramescaperDesktopProjectLibraryV10PublicationAdmission,
	validateFramescaperDesktopProjectLibraryV10PublicationBeginRequest,
	validateFramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement,
	validateFramescaperDesktopProjectLibraryV10PublicationChunkRequest,
	validateFramescaperDesktopProjectLibraryV10PublicationCompletionRequest,
	validateFramescaperDesktopProjectLibraryV10PublicationResult,
	type FramescaperDesktopProjectLibraryV10PublicationAdmission,
	type FramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement,
} from './project-library-v10-publication-transport.ts';
import {
	validateFramescaperDesktopProjectLibraryV10BodyChunk,
	validateFramescaperDesktopProjectLibraryV10BodyReadRequest,
	validateFramescaperDesktopProjectLibraryV10ProjectId,
	validateFramescaperDesktopProjectLibraryV10TransferBundle,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';

const OPTION_FIELDS = ['invoke'] as const;

export type FramescaperDesktopProjectLibraryV10MainPreloadHandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface FramescaperDesktopProjectLibraryV10MainPreloadBridge {
	connect(): Promise<Readonly<FramescaperDesktopProjectLibraryV10Handshake>>;
	handshakeState(): FramescaperDesktopProjectLibraryV10MainPreloadHandshakeState;
	listProjects(): Promise<Readonly<FramescaperDesktopProjectLibraryV10CatalogSnapshot>>;
	readProjectBundle(
		projectId: string,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
	beginPublication(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10PublicationAdmission>>;
	writePublicationChunk(
		value: unknown,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement>>;
	finishPublication(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>>;
	abortPublication(value: unknown): Promise<boolean>;
	deleteProject(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10DeleteResult>>;
	duplicateProject(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>>;
}

/** Frozen pathless API for the Framescaper-only sandbox preload composition. */
export function createFramescaperDesktopProjectLibraryV10MainPreloadBridge(
	value: unknown,
): FramescaperDesktopProjectLibraryV10MainPreloadBridge {
	const options = snapshotClosedRecord(value, OPTION_FIELDS, 'Framescaper V10 main preload options');
	if (typeof options.invoke !== 'function') {
		throw new TypeError('Framescaper V10 main preload requires an IPC invoke seam');
	}
	const invoke = options.invoke as (channel: string, value?: unknown) => Promise<unknown>;
	const local = createFramescaperDesktopProjectLibraryV10Handshake();
	const publications = new Map<string, string>();
	let state: FramescaperDesktopProjectLibraryV10MainPreloadHandshakeState = 'pending';
	let connection: Promise<Readonly<FramescaperDesktopProjectLibraryV10Handshake>> | null = null;
	const assertOperational = (): void => {
		if (state === 'pending') {
			throw new Error('Framescaper V10 preload handshake is required before operational IPC');
		}
		if (state === 'refused') throw new Error('Framescaper V10 preload handshake was refused');
	};
	return Object.freeze({
		async connect() {
			if (state === 'admitted') return local;
			if (state === 'refused') throw new Error('Framescaper V10 preload handshake was refused');
			if (connection) return connection;
			connection = invoke(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.handshake, local)
				.then((remote) => {
					try {
						const admitted = validateFramescaperDesktopProjectLibraryV10Handshake(remote);
						state = 'admitted';
						return admitted;
					} catch (error) {
						state = 'refused';
						throw new TypeError('Framescaper V10 preload handshake was refused', { cause: error });
					}
				}, (error: unknown) => {
					state = 'refused';
					throw new TypeError('Framescaper V10 preload handshake was refused', { cause: error });
				});
			return connection;
		},
		handshakeState: () => state,
		async listProjects() {
			assertOperational();
			return validateFramescaperDesktopProjectLibraryV10CatalogSnapshot(await invoke(
				FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.listProjects,
			));
		},
		async readProjectBundle(projectIdValue: string) {
			assertOperational();
			const projectId = validateFramescaperDesktopProjectLibraryV10ProjectId(projectIdValue);
			const result = await invoke(
				FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.readProjectBundle,
				projectId,
			);
			return result === null
				? null
				: validateFramescaperDesktopProjectLibraryV10TransferBundle(result, projectId);
		},
		async readBodyChunk(value: unknown): Promise<Uint8Array> {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10BodyReadRequest(value);
			const result = await invoke(
				FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.readBodyChunk,
				request,
			);
			return validateFramescaperDesktopProjectLibraryV10BodyChunk(result, request.length);
		},
		async beginPublication(value: unknown) {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10PublicationBeginRequest(value);
			if (publications.has(request.publicationId)) {
				throw new Error('Framescaper V10 preload received a duplicate publication id');
			}
			publications.set(
				request.publicationId,
				String((request.project as { readonly id: unknown }).id),
			);
			const result = validateFramescaperDesktopProjectLibraryV10PublicationAdmission(
				await invoke(
					FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.beginPublication,
					request,
				),
				request.bodies.length,
			);
			if (result.publicationId !== request.publicationId) {
				throw new Error('Framescaper V10 preload admission changed its publication id');
			}
			return result;
		},
		async writePublicationChunk(value: unknown) {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10PublicationChunkRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Framescaper V10 preload publication is not active');
			}
			return validateFramescaperDesktopProjectLibraryV10PublicationChunkAcknowledgement(
				await invoke(
					FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.writePublicationChunk,
					request,
				),
				request,
			);
		},
		async finishPublication(value: unknown) {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10PublicationCompletionRequest(value);
			const projectId = publications.get(request.publicationId);
			if (!projectId) throw new Error('Framescaper V10 preload publication is not active');
			const result = validateFramescaperDesktopProjectLibraryV10PublicationResult(
				await invoke(
					FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.finishPublication,
					request,
				),
				projectId,
			);
			publications.delete(request.publicationId);
			return result;
		},
		async abortPublication(value: unknown): Promise<boolean> {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10PublicationCompletionRequest(value);
			if (!publications.has(request.publicationId)) {
				throw new Error('Framescaper V10 preload publication is not active');
			}
			const result = validateFramescaperDesktopProjectLibraryV10PublicationAbortResult(
				await invoke(
					FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.abortPublication,
					request,
				),
			);
			publications.delete(request.publicationId);
			return result;
		},
		async deleteProject(value: unknown) {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10DeleteRequest(value);
			return validateFramescaperDesktopProjectLibraryV10DeleteResult(
				await invoke(
					FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.deleteProject,
					request,
				),
				request.projectId,
			);
		},
		async duplicateProject(value: unknown) {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10DuplicateRequest(value);
			return validateFramescaperDesktopProjectLibraryV10TransferBundle(
				await invoke(
					FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS.duplicateProject,
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
