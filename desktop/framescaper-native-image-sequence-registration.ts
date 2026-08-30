/* SPDX-License-Identifier: AGPL-3.0-only */

/** Production main-process ownership for baseline image-sequence import. */

import { resolve } from 'node:path';

import {
	FramescaperNativeImageSequenceImportAuthority,
} from './native-image-sequence-import-authority.ts';
import {
	FramescaperNativeImageSequenceDecodeAuthority,
	type FramescaperNativeImageSequenceDecodeAuthorityOptions,
} from './native-image-sequence-decode-authority.ts';
import {
	registerFramescaperNativeImageSequenceDecodeMainIpc,
} from './native-image-sequence-decode-main-ipc.ts';
import {
	registerFramescaperNativeImageSequenceImportMainIpc,
} from './native-image-sequence-import-main-ipc.ts';
import type { FramescaperNativeMediaRuntime } from './native-media-runtime.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

interface ProjectAuthority {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	projectState(projectId: string): Readonly<{ schemaFamily: 'framescaper'; schemaVersion: 1;
		open: boolean; writable: boolean }>;
	projectRecord(projectId: string): Readonly<{
		schemaFamily: 'framescaper';
		schemaVersion: 1;
		projectId: string;
		projectRevision: number;
		projectSha256: string;
		bodies: readonly Readonly<Record<string, unknown>>[];
	}> | null;
	readProjectBundle(projectId: string): Promise<unknown>;
}

interface RendererBridge {
	handle(channel: string, handler: (event: unknown, request?: unknown) => unknown): void;
	removeHandler(channel: string): void;
	on(channel: string, listener: (event: unknown, request?: unknown) => void): void;
	removeListener(channel: string, listener: (event: unknown, request?: unknown) => void): void;
	ownerFor(event: unknown): object | null;
}

export interface FramescaperNativeImageSequenceRegistrationOptions {
	readonly userDataPath: string;
	readonly route: Readonly<{
		readonly schemaFamily: 'framescaper';
		readonly schemaVersion: 1;
		readonly projectMutationSurface: 'image-sequence-import';
		readonly professionalCharacteristicsContract: 'video-source-characteristics-v25';
		isRouted(): boolean;
	}>;
	readonly project: ProjectAuthority;
	readonly controller: Readonly<{ capabilities(): unknown }>;
	readonly mediaRuntime: Pick<FramescaperNativeMediaRuntime, 'available' | 'runJob'>;
	readonly executable: FramescaperNativeImageSequenceDecodeAuthorityOptions['executable'];
	readonly createMessageChannel: FramescaperNativeImageSequenceDecodeAuthorityOptions['createMessageChannel'];
	readonly mintOpaqueId: () => string;
	readonly runtimeAvailable: () => boolean;
}

export interface FramescaperNativeImageSequenceRegistration {
	registerRendererBridge(bridge: RendererBridge): void;
	revokeOwner(owner: object): Promise<void>;
	dispose(): Promise<void>;
}

export async function createFramescaperNativeImageSequenceRegistration(
	options: FramescaperNativeImageSequenceRegistrationOptions,
): Promise<FramescaperNativeImageSequenceRegistration> {
	assertOptions(options);
	const root = resolve(options.userDataPath, 'framescaper-native-image-sequence-import-v1');
	const authority = new FramescaperNativeImageSequenceImportAuthority({
		root,
		mintOpaqueId: options.mintOpaqueId,
		capabilities: () => options.controller.capabilities(),
		runtimeAvailable: options.runtimeAvailable,
		projectState: (projectId) => projectState(options.project, projectId),
		projectContainsImageSequence: (request) => projectContains(options.project, request),
		assetReferenced: (storageKey, projectId) => assetReferenced(
			options.project, storageKey, projectId,
		),
		mediaRuntime: options.mediaRuntime,
	});
	const decodeAuthority = new FramescaperNativeImageSequenceDecodeAuthority({
		root,
		scratchRoot: resolve(options.userDataPath, 'framescaper-native-image-sequence-decode-helper'),
		project: options.project,
		executable: options.executable,
		createMessageChannel: options.createMessageChannel,
		mediaRuntime: options.mediaRuntime,
		mintOpaqueId: options.mintOpaqueId,
		runtimeAvailable: options.runtimeAvailable,
	});
	await Promise.all([authority.recover(), decodeAuthority.recover()]);
	let importIpc: ReturnType<typeof registerFramescaperNativeImageSequenceImportMainIpc> | null = null;
	let decodeIpc: ReturnType<typeof registerFramescaperNativeImageSequenceDecodeMainIpc> | null = null;
	return Object.freeze({
		registerRendererBridge(bridge: RendererBridge) {
			if (importIpc || decodeIpc) throw new Error('Framescaper image-sequence IPC is already registered.');
			importIpc = registerFramescaperNativeImageSequenceImportMainIpc({
				handle: bridge.handle, removeHandler: bridge.removeHandler,
				on: bridge.on, removeListener: bridge.removeListener,
				authorizeOwner: (event) => bridge.ownerFor(event), authority,
			});
			try {
				decodeIpc = registerFramescaperNativeImageSequenceDecodeMainIpc({
					handle: bridge.handle, removeHandler: bridge.removeHandler,
					authorizeOwner: (event) => bridge.ownerFor(event), authority: decodeAuthority,
				});
			} catch (error) {
				const registered = importIpc;
				importIpc = null;
				void registered.dispose();
				throw error;
			}
		},
		async revokeOwner(owner: object) {
			await Promise.all([authority.revokeOwner(owner), decodeAuthority.revokeOwner(owner)]);
		},
		async dispose() {
			const registered = [importIpc, decodeIpc];
			importIpc = null;
			decodeIpc = null;
			const results = await Promise.allSettled([
				...registered.map((value) => value?.dispose()), decodeAuthority.dispose(),
			]);
			const failures = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected')
				.map(({ reason }) => reason);
			if (failures.length) throw new AggregateError(failures, 'Framescaper image-sequence disposal failed.');
		},
	});
}

async function projectState(
	project: ProjectAuthority,
	projectId: string,
): Promise<Readonly<{ schemaFamily: 'framescaper'; schemaVersion: 1;
	open: boolean; writable: boolean; revision: number }> | null> {
	const state = project.projectState(projectId);
	const record = project.projectRecord(projectId);
	if (!record || !currentFramescaper(record) || !currentFramescaper(state)
		|| record.projectId !== projectId) return null;
	return Object.freeze({
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		open: state.open === true,
		writable: state.writable === true,
		revision: nonNegative(record.projectRevision, 'project revision'),
	});
}

async function projectContains(
	project: ProjectAuthority,
	request: Readonly<{
		schemaFamily: 'framescaper';
		schemaVersion: 1;
		projectId: string;
		sourceId: string;
		inventoryStorageKey: string;
		sourcePackStorageKey: string;
	}>,
): Promise<boolean> {
	if (!currentFramescaper(request)) return false;
	const raw = await project.readProjectBundle(request.projectId);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
	const bundle = raw as Readonly<Record<string, unknown>>;
	if (typeof bundle.document !== 'string' || !Array.isArray(bundle.bodies)) return false;
	let document: unknown;
	try { document = JSON.parse(bundle.document); }
	catch { return false; }
	if (!currentFramescaper(document)) return false;
	const value = document as Readonly<Record<string, unknown>>;
	if (value.id !== request.projectId || !Array.isArray(value.sources)) {
		return false;
	}
	const source = value.sources.find((candidate) => candidate && typeof candidate === 'object'
		&& !Array.isArray(candidate) && (candidate as Readonly<Record<string, unknown>>).id === request.sourceId) as
		Readonly<Record<string, unknown>> | undefined;
	if (!source || !source.imageSequence || typeof source.imageSequence !== 'object') return false;
	const sequence = source.imageSequence as Readonly<Record<string, unknown>>;
	const inventory = sequence.inventory as Readonly<Record<string, unknown>> | null;
	const pack = sequence.sourcePack as Readonly<Record<string, unknown>> | null;
	if (inventory?.storageKey !== request.inventoryStorageKey
		|| pack?.storageKey !== request.sourcePackStorageKey) return false;
	const bodies = bundle.bodies as readonly unknown[];
	return [
		['image-sequence-inventory', request.inventoryStorageKey],
		['image-sequence-source-pack', request.sourcePackStorageKey],
	].every(([kind, storageKey]) => bodies.some((body) => body && typeof body === 'object'
		&& !Array.isArray(body) && (body as Readonly<Record<string, unknown>>).kind === kind
		&& (body as Readonly<Record<string, unknown>>).storageKey === storageKey));
}

function assetReferenced(
	project: ProjectAuthority,
	storageKey: string,
	projectId: string | undefined,
): boolean {
	if (projectId === undefined) return false;
	const record = project.projectRecord(projectId);
	if (!record || !currentFramescaper(record)) return false;
	return record.bodies.some((body) => body.storageKey === storageKey
		&& (body.kind === 'image-sequence-inventory'
			|| body.kind === 'image-sequence-source-pack')) === true;
}

function assertOptions(options: FramescaperNativeImageSequenceRegistrationOptions): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('Framescaper baseline image-sequence registration is invalid.');
	}
	assertCurrentFramescaper(options.route, 'image-sequence route');
	assertCurrentFramescaper(options.project, 'image-sequence project authority');
	if (options.route.projectMutationSurface !== 'image-sequence-import'
		|| options.route.professionalCharacteristicsContract !== 'video-source-characteristics-v25'
		|| options.route.isRouted() !== true
		|| !options.project || ['projectState', 'projectRecord', 'readProjectBundle']
			.some((method) => typeof options.project[method as keyof ProjectAuthority] !== 'function')
		|| typeof options.controller?.capabilities !== 'function'
		|| typeof options.mediaRuntime?.available !== 'function'
		|| typeof options.mediaRuntime?.runJob !== 'function'
		|| typeof options.executable !== 'function'
		|| typeof options.createMessageChannel !== 'function'
		|| typeof options.mintOpaqueId !== 'function'
		|| typeof options.runtimeAvailable !== 'function') {
		throw new TypeError('Framescaper baseline image-sequence registration is invalid.');
	}
}

function currentFramescaper(value: unknown): boolean {
	try {
		const identity = readProjectSchemaIdentity(value);
		return identity.schemaFamily === FRAMESCAPER_PROJECT_SCHEMA_FAMILY
			&& identity.schemaVersion === PROJECT_SCHEMA_VERSION;
	} catch { return false; }
}

function assertCurrentFramescaper(value: unknown, label: string): void {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(`The ${label} requires the current Framescaper schema.`);
	}
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${label} is invalid.`);
	return Number(value);
}
