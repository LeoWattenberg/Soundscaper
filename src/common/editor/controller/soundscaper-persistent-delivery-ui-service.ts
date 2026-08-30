/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DeliveryBatch, DeliveryBatchMember } from '../delivery-batch.ts';
import {
	createDeliveryBatchReport,
	deliveryBatchRetryMemberIds,
	type DeliveryBatchMemberOutcome,
} from '../delivery-batch-report.ts';
import type { DeliveryReport } from '../delivery-report.ts';
import {
	createSoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryProjectIdentityV1,
	type SoundscaperDeliveryResultV1,
} from '../soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../soundscaper-persistent-delivery-plan-v1.ts';

export type SoundscaperPersistentDeliveryVisibleState =
	| 'queued' | 'running' | 'waiting-for-project' | 'needs-authorization'
	| 'stale' | 'completed' | 'failed' | 'cancelled';

export interface SoundscaperPersistentDeliverySummary {
	readonly jobId: string;
	readonly label: string;
	readonly state: SoundscaperPersistentDeliveryVisibleState;
	readonly attempt: number;
	readonly progress: number | null;
	readonly lastFailureCode: string | null;
	readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
	readonly planFingerprint: string;
	readonly destinationGrantId: string;
	readonly batchId: string | null;
	readonly batchMember: DeliveryBatchMember | null;
	readonly report: DeliveryReport | null;
	readonly result: SoundscaperDeliveryResultV1 | null;
}

export interface SoundscaperPersistentDeliveryRendererBridge {
	selectDestination(): PromiseLike<Readonly<{ grantId: string }> | null>;
	reauthorizeDestination(request: Readonly<{ grantId: string }>):
		PromiseLike<Readonly<{ grantId: string }> | null>;
	currentProjectIdentity(request: Readonly<{ projectId: string | null }> ):
		PromiseLike<SoundscaperDeliveryProjectIdentityV1 | null>;
	enqueueBatch(request: SoundscaperPersistentDeliveryEnqueueRequest):
		PromiseLike<readonly SoundscaperPersistentDeliverySummary[]>;
	list(request: Readonly<{
		limit: number; cursor?: string; currentProjectIdentity?: SoundscaperDeliveryProjectIdentityV1;
	}>): PromiseLike<Readonly<{
		entries: readonly SoundscaperPersistentDeliverySummary[];
		paused: boolean;
		nextCursor: string | null;
	}>>;
	events(request: Readonly<{ afterSequence: number; limit: number }>): PromiseLike<Readonly<{
		events: readonly unknown[]; nextSequence: number; hasMore: boolean;
	}>>;
	pause(): PromiseLike<unknown>;
	resume(): PromiseLike<unknown>;
	reorder(request: Readonly<{ jobId: string; position: number }>): PromiseLike<unknown>;
	cancel(request: Readonly<{ jobId: string }>): PromiseLike<unknown>;
	retry(request: Readonly<{ jobId: string }>): PromiseLike<unknown>;
}

export interface SoundscaperPersistentDeliveryEnqueueRequest {
	readonly items: readonly Readonly<{
		readonly description: SoundscaperDeliveryDescriptionV1;
		readonly batch: Readonly<{
			readonly batchId: string;
			readonly member: DeliveryBatchMember;
		}>;
	}>[];
	readonly admission: Readonly<{
		readonly projectIdentity: SoundscaperDeliveryProjectIdentityV1;
		readonly planFingerprints: readonly string[];
		readonly saved: true;
		readonly clean: true;
		readonly named: true;
	}>;
}

export interface SoundscaperPersistentDeliveryUiRuntime {
	readonly bridge: SoundscaperPersistentDeliveryRendererBridge;
	readonly getProject: () => Readonly<{
		id?: unknown; revision?: unknown; title?: unknown;
	}> | null | undefined;
	readonly getSaveState: () => unknown;
	readonly captureProjectGeneration: () => unknown;
	readonly assertProjectGeneration: (token: unknown) => void;
	readonly describeMember: (member: DeliveryBatchMember) => PromiseLike<Readonly<{
		settings: Readonly<Record<string, unknown>>;
		exportPlan: Readonly<Record<string, unknown>>;
	}>>;
	readonly publishDocumentSnapshot?: () => void;
}

/**
 * Renderer-side mirror for the pathless desktop queue.
 *
 * Main owns paths, grants, durable rows and publication. This surface owns the
 * open document and therefore derives the exact ordinary export plan before it
 * asks main to persist anything. Its synchronous `list` keeps the existing
 * menu-only dialog simple; `refresh` replaces that mirror from paginated main
 * state after restart and after every mutation.
 */
export function createSoundscaperPersistentDeliveryUiService(
	runtime: SoundscaperPersistentDeliveryUiRuntime,
) {
	assertRuntime(runtime);
	let destinationGrantId: string | null = null;
	let view = frozenView(false, []);
	let eventSequence = 0;
	let refreshChain: Promise<void> = Promise.resolve();

	async function refresh(): Promise<void> {
		const load = async (): Promise<void> => {
			const entries: SoundscaperPersistentDeliverySummary[] = [];
			let currentProjectIdentity: SoundscaperDeliveryProjectIdentityV1 | null = null;
			try { currentProjectIdentity = await savedProjectIdentity(runtime); } catch { /* no exact open project */ }
			let cursor: string | undefined;
			let paused = false;
			do {
				const page = await runtime.bridge.list({
					limit: 250, ...(cursor ? { cursor } : {}),
					...(currentProjectIdentity ? { currentProjectIdentity } : {}),
				});
				if (!page || !Array.isArray(page.entries) || typeof page.paused !== 'boolean') {
					throw new TypeError('The persistent delivery queue returned an invalid page.');
				}
				entries.push(...page.entries.map(summary));
				paused = page.paused;
				cursor = page.nextCursor === null ? undefined : cursorValue(page.nextCursor);
			} while (cursor !== undefined);
			view = frozenView(paused, entries);
			runtime.publishDocumentSnapshot?.();
		};
		const operation = refreshChain.then(load, load);
		refreshChain = operation.catch(() => undefined);
		return operation;
	}

	async function mutate(operation: () => PromiseLike<unknown>): Promise<void> {
		await operation();
		await refresh();
	}

	return Object.freeze({
		persistent: true as const,
		list: () => view,
		refresh,
		async events(): Promise<readonly unknown[]> {
			const collected: unknown[] = [];
			for (;;) {
				const page = await runtime.bridge.events({ afterSequence: eventSequence, limit: 250 });
				if (!page || !Array.isArray(page.events) || !Number.isSafeInteger(page.nextSequence)
					|| page.nextSequence < eventSequence || typeof page.hasMore !== 'boolean') {
					throw new TypeError('The persistent delivery event page is invalid.');
				}
				collected.push(...page.events);
				eventSequence = page.nextSequence;
				if (!page.hasMore) return Object.freeze(collected);
			}
		},
		async selectDestination() {
			const selected = await runtime.bridge.selectDestination();
			if (selected === null) return destinationGrantId === null
				? null : Object.freeze({ grantId: destinationGrantId });
			destinationGrantId = grantId(selected?.grantId);
			return Object.freeze({ grantId: destinationGrantId });
		},
		async reauthorizeDestination(value: unknown) {
			const grant = grantId(value);
			const authorized = await runtime.bridge.reauthorizeDestination({ grantId: grant });
			if (authorized === null) return destinationGrantId === null
				? null : Object.freeze({ grantId: destinationGrantId });
			if (grantId(authorized?.grantId) !== grant) {
				throw new Error('The reauthorized delivery destination changed identity.');
			}
			destinationGrantId = grant;
			await refresh();
			return Object.freeze({ grantId: grant });
		},
		async enqueueBatch(batch: DeliveryBatch): Promise<readonly string[]> {
			const grant = destinationGrantId;
			if (grant === null) throw new Error('Choose a persistent delivery destination first.');
			const projectGeneration = runtime.captureProjectGeneration();
			const projectIdentity = await savedProjectIdentity(runtime);
			if (!batch || !Array.isArray(batch.members) || batch.members.length < 1) {
				throw new TypeError('A persistent delivery batch requires at least one member.');
			}
			const items = [];
			for (const memberValue of batch.members) {
				const member = batchMember(memberValue);
				const described = await runtime.describeMember(member);
				const plan = createSoundscaperPersistentAudioDeliveryPlanV1({
					settings: definedRecord(described?.settings, 'normalized delivery settings'),
					exportPlan: definedRecord(described?.exportPlan, 'exact ordinary export plan'),
					batch: {
						batchId: batch.batchId, memberId: member.memberId, presetId: member.presetId,
						target: member.target, mode: member.mode,
					},
				});
				const sealedMember = batchMember({ ...member, settings: plan.settings });
				items.push(Object.freeze({
					description: createSoundscaperDeliveryDescriptionV1({
						label: member.label, projectIdentity, plan, destinationGrantId: grant,
					}),
					batch: Object.freeze({ batchId: batch.batchId, member: sealedMember }),
				}));
			}
			const finalIdentity = await savedProjectIdentity(runtime);
			runtime.assertProjectGeneration(projectGeneration);
			assertExactIdentity(projectIdentity, finalIdentity);
			assertExactLocalProject(runtime, projectIdentity);
			const admission = Object.freeze({
				projectIdentity,
				planFingerprints: Object.freeze(items.map(({ description }) => description.planFingerprint)),
				saved: true as const, clean: true as const, named: true as const,
			});
			const queued = await runtime.bridge.enqueueBatch({ items: Object.freeze(items), admission });
			const jobIds = Object.freeze(queued.map((entry) => summary(entry).jobId));
			await refresh();
			return jobIds;
		},
		batchReport: (batchId: string): DeliveryReport | null => batchDeliveryReport(view.entries, batchId),
		async retryBatchFailures(batchId: string): Promise<readonly string[]> {
			const report = batchDeliveryReport(view.entries, batchId);
			if (report === null) throw new Error(`Persistent delivery batch ${batchId} is not queued.`);
			const memberIds = new Set(deliveryBatchRetryMemberIds(report));
			const retryable = view.entries.filter((entry) => entry.batchId === batchId
				&& entry.batchMember !== null && memberIds.has(entry.batchMember.memberId)
				&& entry.state === 'failed').map(({ jobId }) => jobId);
			for (const jobId of retryable) await runtime.bridge.retry({ jobId });
			await refresh();
			return Object.freeze(retryable);
		},
		report(jobId: string): DeliveryReport | null {
			return view.entries.find((entry) => entry.jobId === jobId)?.report ?? null;
		},
		pause: () => mutate(() => runtime.bridge.pause()),
		resume: () => mutate(() => runtime.bridge.resume()),
		cancel: (jobId: string) => mutate(() => runtime.bridge.cancel({ jobId: queueId(jobId) })),
		retry: (jobId: string) => mutate(() => runtime.bridge.retry({ jobId: queueId(jobId) })),
		reorder: (jobId: string, position: number) => {
			if (!Number.isSafeInteger(position) || position < 0) {
				throw new RangeError('The persistent delivery queue position is invalid.');
			}
			return mutate(() => runtime.bridge.reorder({ jobId: queueId(jobId), position }));
		},
	});
}

async function savedProjectIdentity(
	runtime: SoundscaperPersistentDeliveryUiRuntime,
): Promise<SoundscaperDeliveryProjectIdentityV1> {
	const project = runtime.getProject();
	if (!project || runtime.getSaveState() !== 'saved') {
		throw new Error('Persistent delivery requires a saved, clean project.');
	}
	const projectId = text(project.id, 'project id');
	const projectRevision = integer(project.revision, 'project revision');
	if (typeof project.title !== 'string' || !project.title.trim()) {
		throw new Error('Persistent delivery requires a named project.');
	}
	const persisted = await runtime.bridge.currentProjectIdentity({ projectId });
	if (!persisted || persisted.projectId !== projectId || persisted.projectRevision !== projectRevision) {
		throw new Error('The open project is not the exact saved project generation.');
	}
	return Object.freeze({
		projectId, projectRevision,
		projectSha256: digest(persisted.projectSha256, 'project SHA-256'),
	});
}

function batchDeliveryReport(
	entries: readonly SoundscaperPersistentDeliverySummary[],
	batchIdValue: string,
): DeliveryReport | null {
	const batchId = text(batchIdValue, 'batch id');
	const rows = entries.filter((entry) => entry.batchId === batchId && entry.batchMember !== null);
	if (rows.length === 0) return null;
	const members = rows.map((entry) => batchMember(entry.batchMember));
	const outcomes: DeliveryBatchMemberOutcome[] = rows.map((entry) => Object.freeze({
		memberId: entry.batchMember!.memberId,
		state: entry.state === 'completed' ? 'delivered'
			: entry.state === 'failed' || entry.state === 'stale' ? 'failed'
				: entry.state === 'cancelled' ? 'cancelled' : 'not-started',
		...(entry.result?.publication.fileName ? { fileName: entry.result.publication.fileName } : {}),
		...(entry.lastFailureCode ? { failureMessage: entry.lastFailureCode } : {}),
		...(entry.report ? { report: entry.report } : {}),
	}));
	return createDeliveryBatchReport(Object.freeze({ batchId, members: Object.freeze(members) }), outcomes);
}

function summary(value: unknown): SoundscaperPersistentDeliverySummary {
	const row = record(value, 'persistent delivery summary') as unknown as SoundscaperPersistentDeliverySummary;
	queueId(row.jobId);
	text(row.label, 'delivery label');
	if (![
		'queued', 'running', 'waiting-for-project', 'needs-authorization',
		'stale', 'completed', 'failed', 'cancelled',
	].includes(row.state)) throw new TypeError('The persistent delivery state is invalid.');
	grantId(row.destinationGrantId);
	return Object.freeze({ ...row });
}

function batchMember(value: unknown): DeliveryBatchMember {
	const row = record(value, 'persistent delivery batch member') as unknown as DeliveryBatchMember;
	text(row.memberId, 'batch member id');
	text(row.label, 'batch member label');
	text(row.presetId, 'batch preset id');
	if (row.mode !== 'mix' && row.mode !== 'stems') throw new TypeError('The delivery batch mode is invalid.');
	record(row.target, 'delivery batch target');
	record(row.settings, 'delivery batch settings');
	return row;
}

function frozenView(paused: boolean, entries: readonly SoundscaperPersistentDeliverySummary[]) {
	return Object.freeze({ paused, entries: Object.freeze([...entries]) });
}

function assertRuntime(runtime: SoundscaperPersistentDeliveryUiRuntime): void {
	if (!runtime?.bridge || typeof runtime.getProject !== 'function'
		|| typeof runtime.getSaveState !== 'function' || typeof runtime.describeMember !== 'function'
		|| typeof runtime.captureProjectGeneration !== 'function'
		|| typeof runtime.assertProjectGeneration !== 'function') {
		throw new TypeError('Persistent delivery requires its bridge and current-project runtime.');
	}
	for (const method of [
		'selectDestination', 'reauthorizeDestination', 'currentProjectIdentity', 'enqueueBatch',
		'list', 'events', 'pause', 'resume', 'reorder', 'cancel', 'retry',
	] as const) {
		if (typeof runtime.bridge[method] !== 'function') {
			throw new TypeError(`The persistent delivery bridge requires ${method}.`);
		}
	}
}

function assertExactIdentity(
	expected: SoundscaperDeliveryProjectIdentityV1,
	actual: SoundscaperDeliveryProjectIdentityV1,
): void {
	if (expected.projectId !== actual.projectId
		|| expected.projectRevision !== actual.projectRevision
		|| expected.projectSha256 !== actual.projectSha256) {
		throw new Error('The saved project identity changed while the delivery plans were derived.');
	}
}

function assertExactLocalProject(
	runtime: Pick<SoundscaperPersistentDeliveryUiRuntime, 'getProject' | 'getSaveState'>,
	expected: SoundscaperDeliveryProjectIdentityV1,
): void {
	const project = runtime.getProject();
	if (!project || runtime.getSaveState() !== 'saved' || project.id !== expected.projectId
		|| project.revision !== expected.projectRevision
		|| typeof project.title !== 'string' || !project.title.trim()) {
		throw new Error('The project changed after its exact delivery plans were derived.');
	}
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function definedRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	const source = record(value, label);
	const snapshot: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(source)) {
		if (child !== undefined) snapshot[key] = definedValue(child, label);
	}
	return Object.freeze(snapshot);
}

function definedValue(value: unknown, label: string): unknown {
	if (Array.isArray(value)) {
		if (value.some((child) => child === undefined)) {
			throw new TypeError(`The ${label} contains an undefined array member.`);
		}
		return Object.freeze(value.map((child) => definedValue(child, label)));
	}
	if (value && typeof value === 'object') return definedRecord(value, label);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || new TextEncoder().encode(value).byteLength > 1_024) {
		throw new TypeError(`The persistent delivery ${label} is invalid.`);
	}
	return value;
}

function queueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError('The persistent delivery job id is invalid.');
	}
	return value;
}

function grantId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError('The persistent delivery destination grant is invalid.');
	}
	return value;
}

function cursorValue(value: unknown): string {
	if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
		throw new TypeError('The persistent delivery cursor is invalid.');
	}
	return value;
}

function integer(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new TypeError(`The persistent delivery ${label} is invalid.`);
	}
	return Number(value);
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`The persistent delivery ${label} is invalid.`);
	}
	return value;
}
