/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	fingerprintSoundscaperDeliveryPlanV1,
	parseSoundscaperDeliveryPlanV1,
	SoundscaperDeliveryContractError,
	validateSoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryCurrentAuthorityV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryProjectIdentityV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	validateSoundscaperPersistentAudioDeliveryPlanV1,
	validateSoundscaperPersistentDeliveryBatchMemberV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { SOUNDSCAPER_DELIVERY_MAIN_CHANNELS as CHANNELS } from './soundscaper-delivery-main-channels.ts';
import {
	sameSoundscaperDeliveryProject,
	type SoundscaperDeliverySavedAdmission,
} from './soundscaper-delivery-service-contract.ts';
import { SoundscaperDeliveryService } from './soundscaper-delivery-service.ts';
import { registerSoundscaperDeliveryWorkerPort } from './soundscaper-delivery-worker-port.ts';

type Owner = object;
type Handler = (event: unknown, value?: unknown) => unknown;

export interface SoundscaperDeliveryProjectAuthority {
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly projectName: string;
}

export interface SoundscaperDeliveryMainIpcOptions {
	readonly handle: (channel: string, listener: Handler) => void;
	readonly removeHandler: (channel: string) => void;
	readonly on: (channel: string, listener: Handler) => void;
	readonly removeListener: (channel: string, listener: Handler) => void;
	readonly ownerFor: (event: unknown) => Owner;
	readonly service: SoundscaperDeliveryService;
	readonly readProjectAuthority: (
		projectId: string,
	) => PromiseLike<SoundscaperDeliveryProjectAuthority | null> | SoundscaperDeliveryProjectAuthority | null;
	readonly dialog: {
		showOpenDialog: (window: unknown, options: unknown) => PromiseLike<{
			readonly canceled: boolean; readonly filePaths: readonly string[];
		}>;
	};
	readonly windowFor: () => unknown;
}

export function registerSoundscaperDeliveryMainIpc(options: SoundscaperDeliveryMainIpcOptions) {
	if (!options || typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.on !== 'function' || typeof options.removeListener !== 'function'
		|| typeof options.ownerFor !== 'function' || typeof options.readProjectAuthority !== 'function'
		|| typeof options.dialog?.showOpenDialog !== 'function' || typeof options.windowFor !== 'function') {
		throw new TypeError('Persistent delivery main IPC requires closed Electron composition seams.');
	}
	const installed: string[] = [];
	const openProjects = new WeakMap<Owner, SoundscaperDeliveryProjectIdentityV1>();
	let disposed = false;
	const worker = registerSoundscaperDeliveryWorkerPort({
		on: options.on,
		removeListener: options.removeListener,
		ownerFor: options.ownerFor,
		service: options.service,
		admitCurrentAuthority: (owner, value) => admittedCurrentAuthority(
			options, worker, openProjects, owner, value,
		),
		completionAuthority: async (owner, description, plan) => {
			const projectIdentity = await admittedOwnerProject(
				options, worker, openProjects, owner, description.projectIdentity,
			);
			return Object.freeze({
				projectIdentity,
				planFingerprint: fingerprintSoundscaperDeliveryPlanV1(plan).sha256,
			});
		},
	});
	const register = (channel: string, operation: (owner: Owner, value: unknown) => unknown) => {
		options.handle(channel, async (event, value) => {
			if (disposed) throw new Error('Persistent delivery IPC is disposed.');
			assertPathless(value, 'request');
			const result = await operation(options.ownerFor(event), value);
			assertPathless(result, 'response');
			return result;
		});
		installed.push(channel);
	};

	register(CHANNELS.selectRoot, async (_owner, value) => {
		empty(value, 'destination selection');
		const path = await selectDirectory(options);
		return path === null ? null : options.service.authorizeRoot(path);
	});
	register(CHANNELS.reauthorizeRoot, async (_owner, value) => {
		const request = record(value, ['grantId'], 'destination reauthorization');
		const path = await selectDirectory(options);
		return path === null ? null : options.service.reauthorizeRoot(opaque(request.grantId, 'grant'), path);
	});
	register(CHANNELS.projectIdentity, async (owner, value) => {
		const request = record(value, ['projectId'], 'current project identity');
		if (request.projectId === null) {
			openProjects.delete(owner);
			await worker.bindOwnerProject(owner, null);
			return null;
		}
		const project = (await projectAuthority(options, projectId(request.projectId))).projectIdentity;
		openProjects.set(owner, project);
		await worker.bindOwnerProject(owner, project);
		return project;
	});
	register(CHANNELS.enqueueBatch, async (owner, value) => {
		const request = record(value, ['items', 'admission'], 'queue admission');
		const items = denseArray(request.items, 1_000, 'delivery items').map((item) => {
			const row = record(item, ['description', 'batch'], 'delivery item');
			const description = validateSoundscaperDeliveryDescriptionV1(row.description);
			const plan = validateSoundscaperPersistentAudioDeliveryPlanV1(
				parseSoundscaperDeliveryPlanV1(description),
			);
			if (fingerprintSoundscaperDeliveryPlanV1(plan).sha256 !== description.planFingerprint) {
				throw new Error('Persistent delivery plan fingerprint changed during admission.');
			}
			const admittedBatch = batch(row.batch);
			return Object.freeze({ description, batch: admittedBatch });
		});
		const admission = savedAdmission(request.admission, items);
		await admittedOwnerProject(options, worker, openProjects, owner, admission.projectIdentity);
		return options.service.enqueueBatch({ items, admission });
	});
	register(CHANNELS.list, async (owner, value) => {
		const request = optionalRecord(value, ['currentProjectIdentity', 'limit', 'cursor'], 'queue list');
		const requested = request.currentProjectIdentity == null
			? null : identity(request.currentProjectIdentity);
		const bound = openProjects.get(owner) ?? null;
		if (requested !== null && (bound === null
			|| !sameSoundscaperDeliveryProject(requested, bound))) {
			throw new Error('The queue view is not bound to this renderer owner open project.');
		}
		const currentProjectIdentity = bound === null ? null
			: await admittedOwnerProject(options, worker, openProjects, owner, bound);
		return options.service.list({
			currentProjectIdentity,
			...(request.limit === undefined ? {} : { limit: nonNegative(request.limit, 'list limit') }),
			...(request.cursor === undefined ? {} : { cursor: text(request.cursor, 'cursor') }),
		});
	});
	register(CHANNELS.events, (_owner, value) => {
		const request = optionalRecord(value, ['afterSequence', 'limit'], 'event list');
		return options.service.events({
			...(request.afterSequence === undefined ? {} : { afterSequence: nonNegative(request.afterSequence, 'event cursor') }),
			...(request.limit === undefined ? {} : { limit: nonNegative(request.limit, 'event limit') }),
		});
	});
	register(CHANNELS.pause, (_owner, value) => { empty(value, 'pause'); options.service.pause(); return true; });
	register(CHANNELS.resume, (_owner, value) => { empty(value, 'resume'); options.service.resume(); return true; });
	register(CHANNELS.reorder, (_owner, value) => {
		const request = record(value, ['jobId', 'position'], 'queue reorder');
		options.service.reorder(id(request.jobId, 'job'), nonNegative(request.position, 'queue position'));
		return true;
	});
	register(CHANNELS.cancel, async (_owner, value) => {
		const request = record(value, ['jobId'], 'queue cancellation');
		await options.service.cancel(id(request.jobId, 'job'));
		return true;
	});
	register(CHANNELS.retry, (_owner, value) => {
		const request = record(value, ['jobId'], 'queue retry');
		options.service.retry(id(request.jobId, 'job'));
		return true;
	});

	return Object.freeze({
		revokeOwner: (owner: Owner) => {
			openProjects.delete(owner);
			return worker.revokeOwner(owner);
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			for (const channel of installed) options.removeHandler(channel);
			await worker.dispose();
		},
	});
}

async function selectDirectory(options: SoundscaperDeliveryMainIpcOptions): Promise<string | null> {
	const result = await options.dialog.showOpenDialog(options.windowFor(), {
		title: 'Select delivery destination', properties: ['openDirectory', 'createDirectory'],
	});
	return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0]!;
}

async function projectAuthority(
	options: SoundscaperDeliveryMainIpcOptions,
	project: string,
): Promise<SoundscaperDeliveryProjectAuthority> {
	const authority = await options.readProjectAuthority(project);
	if (!authority || typeof authority.projectName !== 'string' || !authority.projectName.trim()) {
		throw new Error('Persistent delivery requires one named committed project.');
	}
	const projectIdentity = identity(authority.projectIdentity);
	if (projectIdentity.projectId !== project) throw new Error('Persistent delivery project authority changed identity.');
	return Object.freeze({ projectIdentity, projectName: authority.projectName });
}

async function admittedCurrentAuthority(
	options: SoundscaperDeliveryMainIpcOptions,
	worker: ReturnType<typeof registerSoundscaperDeliveryWorkerPort>,
	openProjects: WeakMap<Owner, SoundscaperDeliveryProjectIdentityV1>,
	owner: Owner,
	value: unknown,
): Promise<SoundscaperDeliveryCurrentAuthorityV1> {
	const row = record(value, ['projectIdentity', 'planFingerprint'], 'current delivery authority');
	const project = identity(row.projectIdentity);
	const admitted = await admittedOwnerProject(options, worker, openProjects, owner, project);
	return Object.freeze({ projectIdentity: admitted, planFingerprint: digest(row.planFingerprint) });
}

async function admittedOwnerProject(
	options: SoundscaperDeliveryMainIpcOptions,
	worker: ReturnType<typeof registerSoundscaperDeliveryWorkerPort>,
	openProjects: WeakMap<Owner, SoundscaperDeliveryProjectIdentityV1>,
	owner: Owner,
	project: SoundscaperDeliveryProjectIdentityV1,
): Promise<SoundscaperDeliveryProjectIdentityV1> {
	const bound = openProjects.get(owner);
	if (!bound || !sameSoundscaperDeliveryProject(bound, project)) {
		throw new SoundscaperDeliveryContractError('stale-project',
			'Persistent delivery requires this renderer owner to have the exact project generation open.');
	}
	const persisted = await projectAuthority(options, project.projectId);
	const reopened = openProjects.get(owner);
	if (!reopened || !sameSoundscaperDeliveryProject(reopened, project)) {
		throw new SoundscaperDeliveryContractError('stale-project',
			'The renderer open project changed while delivery authority was admitted.');
	}
	if (!sameSoundscaperDeliveryProject(project, persisted.projectIdentity)) {
		openProjects.delete(owner);
		await worker.bindOwnerProject(owner, null);
		throw new SoundscaperDeliveryContractError('stale-project',
			'The renderer project is not the exact committed project revision.');
	}
	return persisted.projectIdentity;
}

function savedAdmission(value: unknown, items: readonly Readonly<{ description: SoundscaperDeliveryDescriptionV1 }>[]): SoundscaperDeliverySavedAdmission {
	const row = record(value, ['projectIdentity', 'planFingerprints', 'saved', 'clean', 'named'], 'saved admission');
	if (row.saved !== true || row.clean !== true || row.named !== true) {
		throw new Error('Persistent delivery requires a saved, clean, named project.');
	}
	const projectIdentity = identity(row.projectIdentity);
	const fingerprints = denseArray(row.planFingerprints, 1_000, 'plan fingerprints').map(digest);
	if (fingerprints.length !== items.length || items.some(({ description }, index) => (
		!sameSoundscaperDeliveryProject(description.projectIdentity, projectIdentity)
		|| description.planFingerprint !== fingerprints[index]
	))) throw new Error('Persistent delivery admission does not match every exact member plan.');
	return Object.freeze({ projectIdentity, planFingerprints: Object.freeze(fingerprints), saved: true, clean: true, named: true });
}

function batch(value: unknown): Readonly<{ batchId: string; member: Readonly<Record<string, unknown>> }> | null {
	if (value === null) return null;
	const row = record(value, ['batchId', 'member'], 'batch authority');
	const member = validateSoundscaperPersistentDeliveryBatchMemberV1(row.member);
	return Object.freeze({
		batchId: text(row.batchId, 'batch id'),
		member: member as unknown as Readonly<Record<string, unknown>>,
	});
}

function identity(value: unknown): SoundscaperDeliveryProjectIdentityV1 {
	const row = record(value, ['projectId', 'projectRevision', 'projectSha256'], 'project identity');
	return Object.freeze({
		projectId: projectId(row.projectId),
		projectRevision: nonNegative(row.projectRevision, 'project revision'),
		projectSha256: digest(row.projectSha256),
	});
}

function optionalRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	return value === undefined ? {} : record(value, fields, label, true);
}

function record(
	value: unknown, fields: readonly string[], label: string, optional = false,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Persistent delivery ${label} must be a record.`);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| (!optional && fields.some((field) => !keys.includes(field)))) {
		throw new TypeError(`Persistent delivery ${label} has unsupported or missing fields.`);
	}
	return value as Record<string, unknown>;
}

function denseArray(value: unknown, maximum: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`Persistent delivery ${label} must be a bounded dense array.`);
	}
	return value;
}

function empty(value: unknown, label: string): void {
	if (value !== undefined) throw new TypeError(`Persistent delivery ${label} takes no request body.`);
}

function id(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) throw new TypeError(`Persistent delivery ${label} id is invalid.`);
	return value;
}

function opaque(value: unknown, label: string): string { return id(value, label); }
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Persistent delivery digest is invalid.');
	return value;
}
function projectId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) throw new TypeError('Persistent delivery project id is invalid.');
	return value;
}
function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || /[\0-\x1f]/u.test(value) || new TextEncoder().encode(value).byteLength > 1_024) {
		throw new TypeError(`Persistent delivery ${label} is invalid.`);
	}
	return value;
}
function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Persistent delivery ${label} is invalid.`);
	return Number(value);
}

function assertPathless(value: unknown, label: string, seen = new Set<object>()): void {
	if (typeof value === 'string' && isPathValue(value)) {
		throw new TypeError(`Persistent delivery ${label} must be pathless.`);
	}
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
	if (seen.has(value)) throw new TypeError(`Persistent delivery ${label} must be acyclic.`);
	seen.add(value);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || /paths?$/iu.test(key)) {
			throw new TypeError(`Persistent delivery ${label} must not carry a path field.`);
		}
		const nested = (value as Record<string, unknown>)[key];
		if (key === 'planPayload') {
			if (typeof nested !== 'string') throw new TypeError(`Persistent delivery ${label} plan must be pathless.`);
			try { assertPathless(JSON.parse(nested) as unknown, `${label} plan`, seen); }
			catch (error) {
				if (error instanceof SyntaxError) throw new TypeError(`Persistent delivery ${label} plan is invalid.`, { cause: error });
				throw error;
			}
		}
		assertPathless(nested, label, seen);
	}
	seen.delete(value);
}

function isPathValue(value: string): boolean {
	return /^(?:\/|[A-Za-z]:[\\/]|\\\\|~[\\/]|file:)/iu.test(value)
		|| /(?:^|[\\/])\.\.?($|[\\/])/u.test(value);
}
