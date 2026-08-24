/* SPDX-License-Identifier: AGPL-3.0-only */

/** Production main-process ownership for selected-V28 image-sequence import. */

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

const POLICY_ROWS = Object.freeze([
	'codec-native-ffmpeg-current-set',
	'codec-decode-png-image-sequence',
	'codec-decode-tiff-image-sequence',
	'codec-decode-openexr-image-sequence',
]);

interface ProjectAuthority {
	projectState(projectId: string): Readonly<{ open: boolean; writable: boolean }>;
	projectRecord(projectId: string): Readonly<{
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
		readonly candidateGeneration: 28;
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
	readonly policyCleared: boolean;
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
	const root = resolve(options.userDataPath, 'framescaper-native-image-sequence-import');
	const authority = new FramescaperNativeImageSequenceImportAuthority({
		root,
		mintOpaqueId: options.mintOpaqueId,
		capabilities: () => options.controller.capabilities(),
		runtimeAvailable: options.runtimeAvailable,
		clearedPolicyRowIds: () => options.policyCleared ? POLICY_ROWS : [],
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
		policyCleared: options.policyCleared,
	});
	await authority.recover();
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
): Promise<Readonly<{ open: boolean; writable: boolean; schemaVersion: 28; revision: number }> | null> {
	const state = project.projectState(projectId);
	const record = project.projectRecord(projectId);
	if (!record || record.projectId !== projectId) return null;
	return Object.freeze({
		open: state.open === true,
		writable: state.writable === true,
		schemaVersion: 28,
		revision: nonNegative(record.projectRevision, 'project revision'),
	});
}

async function projectContains(
	project: ProjectAuthority,
	request: Readonly<{
		projectId: string;
		sourceId: string;
		inventoryStorageKey: string;
		sourcePackStorageKey: string;
	}>,
): Promise<boolean> {
	const raw = await project.readProjectBundle(request.projectId);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
	const bundle = raw as Readonly<Record<string, unknown>>;
	if (typeof bundle.document !== 'string' || !Array.isArray(bundle.bodies)) return false;
	let document: unknown;
	try { document = JSON.parse(bundle.document); }
	catch { return false; }
	if (!document || typeof document !== 'object' || Array.isArray(document)) return false;
	const value = document as Readonly<Record<string, unknown>>;
	if (value.id !== request.projectId || value.schemaVersion !== 28 || !Array.isArray(value.sources)) {
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
	return record?.bodies.some((body) => body.storageKey === storageKey
		&& (body.kind === 'image-sequence-inventory'
			|| body.kind === 'image-sequence-source-pack')) === true;
}

function assertOptions(options: FramescaperNativeImageSequenceRegistrationOptions): void {
	if (!options || typeof options !== 'object' || options.route.candidateGeneration !== 28
		|| options.route.projectMutationSurface !== 'image-sequence-import'
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
		|| typeof options.runtimeAvailable !== 'function'
		|| typeof options.policyCleared !== 'boolean') {
		throw new TypeError('Framescaper selected-V28 image-sequence registration is invalid.');
	}
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${label} is invalid.`);
	return Number(value);
}
