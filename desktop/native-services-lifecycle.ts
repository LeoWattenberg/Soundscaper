/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeScratchOutcome } from '../src/common/editor/native-scratch-policy.ts';
import {
	createNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import type {
	FramescaperExternalDisplay,
	FramescaperExternalDisplayFrame,
} from './external-display-controller.ts';
import {
	publishVerifiedNativeMediaOutput,
	type FramescaperNativePublicationPort,
	type FramescaperNativePublicationFence,
	type FramescaperNativePublicationResult,
	type NativeImageSequenceCheckpointFrameV1,
	type NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';
import {
	verifyAndStoreNativeImageSequenceCheckpoint,
	type FramescaperNativeCheckpointStore,
} from './native-services-checkpoint-recovery.ts';
import type { FramescaperNativeQueueRepository } from './native-services-queue-repository.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootProbe,
	FramescaperNativeRootRepository,
	FramescaperNativeRootSelection,
} from './native-services-root-repository.ts';
import type {
	FramescaperNativeScratchCleanupPort,
	FramescaperNativeScratchRepository,
	FramescaperNativeScratchState,
} from './native-services-scratch-repository.ts';
import type { FramescaperNativeServicesLease } from './native-services-database.ts';
import type { FramescaperNativeWatchRepository } from './native-services-watch-repository.ts';
import {
	boundedLifecycleText,
	framescaperNativeCheckpointLifecycleRequest,
	framescaperNativeExternalDisplayRequest,
	framescaperNativeLifecycleIdRequest,
	framescaperNativePublicationLifecycleRequest,
	framescaperNativeQueueEnqueueRequest,
	framescaperNativeWatchCreateRequest,
	framescaperNativeWatchEnabledRequest,
	nativeLifecycleJobId,
	nativeLifecycleOpaqueId,
	nonNegativeLifecycleInteger,
} from './native-services-lifecycle-contracts.ts';

export {
	framescaperNativeCheckpointLifecycleRequest,
	framescaperNativeExternalDisplayRequest,
	framescaperNativeLifecycleIdRequest,
	framescaperNativePublicationLifecycleRequest,
	framescaperNativeQueueEnqueueRequest,
	framescaperNativeWatchCreateRequest,
	framescaperNativeWatchEnabledRequest,
} from './native-services-lifecycle-contracts.ts';
export type {
	FramescaperNativeCheckpointLifecycleRequest,
	FramescaperNativePublicationLifecycleRequest,
	FramescaperNativeQueueEnqueueRequest,
	FramescaperNativeWatchCreateRequest,
	FramescaperNativeWatchEnabledRequest,
} from './native-services-lifecycle-contracts.ts';

export interface FramescaperNativeWatchCoordinatorPort {
	readonly refreshHints: () => void;
	readonly reconcileNow: () => Promise<void>;
}

export interface FramescaperNativeExternalDisplayPort {
	readonly list: () => readonly FramescaperExternalDisplay[];
	readonly activeDisplayId: () => string | null;
	readonly open: (display: FramescaperExternalDisplay) => Promise<void>;
	readonly stop: () => void;
	readonly present: (frame: FramescaperExternalDisplayFrame) => void;
	readonly dispose?: () => void;
}

export interface FramescaperNativeServicesLifecycleOptions {
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly watch: FramescaperNativeWatchRepository;
	readonly scratch: FramescaperNativeScratchRepository;
	readonly lease: () => FramescaperNativeServicesLease;
	readonly now: () => number;
	readonly mintOpaqueId?: () => string;
	readonly mintJobId?: () => string;
	readonly selectRoot?: () => Promise<FramescaperNativeRootSelection | null>;
	readonly probeRoot?: FramescaperNativeRootProbe;
	readonly watchCoordinator: FramescaperNativeWatchCoordinatorPort;
	readonly scratchCleanup?: FramescaperNativeScratchCleanupPort;
	readonly publicationPortFor?: (
		grant: FramescaperNativeRootGrant,
	) => FramescaperNativePublicationPort;
	readonly publicationFenceFor?: (
		record: NativeQueueRecordV2,
		grant: FramescaperNativeRootGrant,
	) => FramescaperNativePublicationFence;
	readonly removeRenderInputs?: (record: NativeQueueRecordV2) => Promise<void>;
	readonly checkpointInspectFor?: (
		grant: FramescaperNativeRootGrant,
	) => (frame: NativeImageSequenceCheckpointFrameV1) => Promise<Readonly<{
		byteLength: number;
		sha256: string;
		symbolicLink: boolean;
	}> | null>;
	readonly checkpointStore?: FramescaperNativeCheckpointStore;
	readonly externalDisplay?: FramescaperNativeExternalDisplayPort;
	readonly onQueueEnqueued?: (record: NativeQueueRecordV2) => void;
}

export interface FramescaperNativeExternalDisplayProjection {
	readonly displays: readonly Readonly<{
		displayId: string;
		label: string;
		primary: boolean;
		width: number;
		height: number;
		hdrCapable: boolean;
		colorManaged: boolean;
	}>[];
	readonly activeDisplayId: string | null;
}

/**
 * Main-owned operations layered over the durable repositories. The renderer
 * sends only opaque ids, bounded relative names, and authenticated digests;
 * absolute roots and filesystem handles remain inside the injected ports.
 */
export class FramescaperNativeServicesLifecycle {
	readonly #queue: FramescaperNativeQueueRepository;
	readonly #roots: FramescaperNativeRootRepository;
	readonly #watch: FramescaperNativeWatchRepository;
	readonly #scratch: FramescaperNativeScratchRepository;
	readonly #lease: () => FramescaperNativeServicesLease;
	readonly #now: () => number;
	readonly #mintOpaqueId: () => string;
	readonly #mintJobId: () => string;
	readonly #selectRoot: FramescaperNativeServicesLifecycleOptions['selectRoot'];
	readonly #probeRoot: FramescaperNativeServicesLifecycleOptions['probeRoot'];
	readonly #watchCoordinator: FramescaperNativeWatchCoordinatorPort;
	readonly #scratchCleanup: FramescaperNativeServicesLifecycleOptions['scratchCleanup'];
	readonly #publicationPortFor: FramescaperNativeServicesLifecycleOptions['publicationPortFor'];
	readonly #publicationFenceFor: FramescaperNativeServicesLifecycleOptions['publicationFenceFor'];
	readonly #removeRenderInputs: FramescaperNativeServicesLifecycleOptions['removeRenderInputs'];
	readonly #checkpointInspectFor: FramescaperNativeServicesLifecycleOptions['checkpointInspectFor'];
	readonly #checkpointStore: FramescaperNativeServicesLifecycleOptions['checkpointStore'];
	readonly #externalDisplay: FramescaperNativeServicesLifecycleOptions['externalDisplay'];
	readonly #onQueueEnqueued: FramescaperNativeServicesLifecycleOptions['onQueueEnqueued'];

	constructor(options: FramescaperNativeServicesLifecycleOptions) {
		this.#queue = options.queue;
		this.#roots = options.roots;
		this.#watch = options.watch;
		this.#scratch = options.scratch;
		this.#lease = options.lease;
		this.#now = options.now;
		this.#mintOpaqueId = options.mintOpaqueId ?? unavailableOpaqueId;
		this.#mintJobId = options.mintJobId ?? unavailableJobId;
		this.#selectRoot = options.selectRoot;
		this.#probeRoot = options.probeRoot;
		this.#watchCoordinator = options.watchCoordinator;
		this.#scratchCleanup = options.scratchCleanup;
		this.#publicationPortFor = options.publicationPortFor;
		this.#publicationFenceFor = options.publicationFenceFor;
		this.#removeRenderInputs = options.removeRenderInputs;
		this.#checkpointInspectFor = options.checkpointInspectFor;
		this.#checkpointStore = options.checkpointStore;
		this.#externalDisplay = options.externalDisplay;
		this.#onQueueEnqueued = options.onQueueEnqueued;
	}

	enqueue(value: unknown): NativeQueueRecordV2 {
		const request = framescaperNativeQueueEnqueueRequest(value);
		this.#roots.requireActive(request.rootGrantId);
		let plan: unknown;
		try {
			plan = JSON.parse(request.planPayload) as unknown;
		} catch {
			throw new TypeError('A native-services enqueue plan payload must be JSON.');
		}
		const records = this.#queue.list();
		const position = records.reduce((maximum, record) => Math.max(maximum, record.position), -1) + 1;
		const record = createNativeQueueRecordV2({
			jobId: request.derivedInputStageId ?? nativeLifecycleJobId(this.#mintJobId()),
			taskKind: request.taskKind,
			plan,
			projectId: request.projectId,
			projectRevision: request.projectRevision,
			inputFingerprints: request.inputFingerprints,
			rootGrantId: request.rootGrantId,
			relativeDestination: request.relativeDestination,
			reservations: request.reservations,
			recoveryClass: request.recoveryClass,
			position,
			createdAtMs: this.#now(),
		});
		if (record.planVersion !== request.planVersion
			|| record.planFingerprint !== request.planFingerprint
			|| record.planPayload !== request.planPayload) {
			throw new Error('The native-services enqueue plan identity does not match its canonical payload.');
		}
		const enqueued = this.#queue.enqueue(record, this.#lease(), this.#now());
		this.#onQueueEnqueued?.(enqueued);
		return enqueued;
	}

	async selectRoot(): Promise<FramescaperNativeRootGrant | null> {
		if (!this.#selectRoot) throw unavailable('select a durable root');
		const selection = await this.#selectRoot();
		if (selection === null) return null;
		const grant = this.#roots.authorize(selection, this.#lease(), this.#now());
		this.#watchCoordinator.refreshHints();
		return grant;
	}

	async revalidateRoot(value: unknown): Promise<boolean> {
		if (!this.#probeRoot) throw unavailable('revalidate a durable root');
		return this.#roots.revalidate(framescaperNativeLifecycleIdRequest(value, 'grantId').grantId, this.#probeRoot);
	}

	revokeRoot(value: unknown): boolean {
		const revoked = this.#roots.revoke(
			framescaperNativeLifecycleIdRequest(value, 'grantId').grantId, this.#now(), this.#lease(),
		);
		if (revoked) this.#watchCoordinator.refreshHints();
		return revoked;
	}

	createWatch(value: unknown): WatchRuleV1 {
		const request = framescaperNativeWatchCreateRequest(value);
		this.#roots.requireActive(request.grantId);
		const rule = this.#watch.create({
			...request,
			ruleId: nativeLifecycleOpaqueId(this.#mintOpaqueId(), 'minted watch rule id'),
			recursive: false,
			enabled: true,
			createdAtMs: this.#now(),
		}, this.#lease(), this.#now());
		this.#watchCoordinator.refreshHints();
		return rule;
	}

	setWatchEnabled(value: unknown): WatchRuleV1 {
		const request = framescaperNativeWatchEnabledRequest(value);
		const rule = this.#watch.setEnabled(
			request.ruleId, request.enabled, this.#lease(), this.#now(),
		);
		this.#watchCoordinator.refreshHints();
		return rule;
	}

	removeWatch(value: unknown): boolean {
		const removed = this.#watch.remove(
			framescaperNativeLifecycleIdRequest(value, 'ruleId').ruleId, this.#lease(), this.#now(),
		);
		if (removed) this.#watchCoordinator.refreshHints();
		return removed;
	}

	async reconcileWatch(): Promise<void> {
		await this.#watchCoordinator.reconcileNow();
	}

	async cleanupScratch(): Promise<readonly string[]> {
		if (!this.#scratchCleanup) throw unavailable('clean native scratch');
		return this.#scratch.cleanupExpired(this.#now(), this.#scratchCleanup, this.#lease());
	}

	async settleScratch(
		value: unknown,
	): Promise<Exclude<FramescaperNativeScratchState, 'reserved'>> {
		if (!this.#scratchCleanup) throw unavailable('settle native scratch');
		const jobId = framescaperNativeLifecycleIdRequest(value, 'jobId').jobId;
		const job = this.#queue.read(jobId);
		if (job === null) throw new Error('The native queue job does not exist.');
		const outcome = scratchOutcome(job.state);
		const state = await this.#scratch.settle(
			jobId, outcome, this.#now(), this.#scratchCleanup, this.#lease(),
		);
		if (state === 'reserved') throw new Error('Settled native scratch remained reserved.');
		return state;
	}

	async removeQueue(jobIdValue: string): Promise<boolean> {
		const job = this.#queue.read(jobIdValue);
		if (job === null) return false;
		if (job.state !== 'completed' && job.state !== 'failed' && job.state !== 'cancelled'
			&& !(job.state === 'blocked' && job.lastFailureCode === 'unsupported-plan-version')) {
			throw new Error('An active native queue job must be cancelled before removal.');
		}
		if (job.planVersion === 7 || job.planVersion === 8) {
			if (!this.#removeRenderInputs) throw unavailable('remove durable selected-V20 render inputs');
			await this.#removeRenderInputs(job);
		}
		if (this.#scratch.read(job.jobId) !== null) {
			if (!this.#scratchCleanup) throw unavailable('remove physical native scratch');
			await this.#scratch.removeForQueueRemoval(
				job.jobId, this.#scratchCleanup, this.#lease(), this.#now(),
			);
		}
		return this.#queue.remove(job.jobId, this.#lease(), this.#now());
	}

	async publish(value: unknown): Promise<FramescaperNativePublicationResult> {
		if (!this.#publicationPortFor || !this.#publicationFenceFor) {
			throw unavailable('publish fenced native media');
		}
		const request = framescaperNativePublicationLifecycleRequest(value);
		const job = this.#queue.read(request.jobId);
		if (job === null) throw new Error('The native queue job does not exist.');
		if (job.state !== 'running') throw new Error('Only a running native queue job may publish.');
		if (job.planFingerprint !== request.currentPlanFingerprint) {
			throw new Error('The native publication request does not name the queued plan fingerprint.');
		}
		const grant = this.#roots.requireActive(job.rootGrantId);
		const result = await publishVerifiedNativeMediaOutput({
			plan: {
				jobId: job.jobId,
				relativeDestination: job.relativeDestination,
				temporaryRelativePath: temporarySibling(job.relativeDestination, job.jobId),
				planFingerprint: job.planFingerprint,
			},
			currentPlanFingerprint: request.currentPlanFingerprint,
			finalized: request.finalized,
			declaredByteLength: request.declaredByteLength,
			declaredSha256: request.declaredSha256,
		}, this.#publicationPortFor(grant), this.#publicationFenceFor(job, grant));
		const completedAtMs = Math.max(this.#now(), job.updatedAtMs);
		this.#queue.control(job.jobId, { kind: 'complete' }, this.#lease(), completedAtMs);
		if (this.#scratch.read(job.jobId) !== null && this.#scratchCleanup) {
			await this.#scratch.settle(
				job.jobId, 'succeeded', completedAtMs, this.#scratchCleanup, this.#lease(),
			);
		}
		return result;
	}

	async checkpoint(value: unknown): Promise<NativeImageSequenceCheckpointResultV1> {
		if (!this.#checkpointInspectFor) throw unavailable('verify an image-sequence checkpoint');
		const request = framescaperNativeCheckpointLifecycleRequest(value);
		const job = this.#queue.read(request.jobId);
		if (job === null) throw new Error('The native queue job does not exist.');
		if (job.taskKind !== 'image-sequence-export'
			|| job.recoveryClass !== 'verified-frame-checkpoint') {
			throw new Error('Only a checkpointed image-sequence job may verify frames.');
		}
		const grant = this.#roots.requireActive(job.rootGrantId);
		return verifyAndStoreNativeImageSequenceCheckpoint(
			job, request, this.#checkpointInspectFor(grant), this.#checkpointStore,
		);
	}

	externalDisplays(): FramescaperNativeExternalDisplayProjection {
		const external = this.#externalDisplay;
		if (!external) return Object.freeze({ displays: Object.freeze([]), activeDisplayId: null });
		const displays = external.list().map((display) => displayProjection(display));
		const activeDisplayId = external.activeDisplayId();
		if (activeDisplayId !== null && !displays.some((display) => display.displayId === activeDisplayId)) {
			throw new Error('The active external display is absent from the current inventory.');
		}
		return Object.freeze({ displays: Object.freeze(displays), activeDisplayId });
	}

	async setExternalDisplay(value: unknown): Promise<FramescaperNativeExternalDisplayProjection> {
		const external = this.#externalDisplay;
		if (!external) throw unavailable('open an external display');
		const { displayId } = framescaperNativeExternalDisplayRequest(value);
		if (displayId === null) external.stop();
		else {
			const display = external.list().find((candidate) => candidate.displayId === displayId);
			if (!display || display.primary) throw new Error('The selected external display is unavailable.');
			await external.open(display);
		}
		return this.externalDisplays();
	}

	presentExternalDisplay(value: unknown): FramescaperNativeExternalDisplayProjection {
		const external = this.#externalDisplay;
		if (!external) throw unavailable('present an external-display frame');
		external.present(value as FramescaperExternalDisplayFrame);
		return this.externalDisplays();
	}
}

function displayProjection(display: FramescaperExternalDisplay) {
	return Object.freeze({
		displayId: boundedLifecycleText(display.displayId, 'display id', 128),
		label: boundedLifecycleText(display.label, 'display label', 256),
		primary: Boolean(display.primary),
		width: positive(display.width, 'display width'),
		height: positive(display.height, 'display height'),
		hdrCapable: Boolean(display.hdrCapable),
		colorManaged: Boolean(display.colorManaged),
	});
}

function scratchOutcome(state: string): NativeScratchOutcome {
	if (state === 'completed') return 'succeeded';
	if (state === 'cancelled') return 'cancelled';
	if (state === 'failed') return 'failed';
	throw new Error('Native scratch may settle only after its queue job settles.');
}

function temporarySibling(relativeDestination: string, jobIdValue: string): string {
	const separator = relativeDestination.lastIndexOf('/');
	const directory = separator < 0 ? '' : relativeDestination.slice(0, separator + 1);
	const name = relativeDestination.slice(separator + 1);
	return `${directory}${name}.${jobIdValue.slice(0, 16)}.partial`;
}

function positive(value: unknown, label: string): number {
	const result = nonNegativeLifecycleInteger(value, label);
	if (result === 0) throw new RangeError(`A native-services ${label} must be positive.`);
	return result;
}

function unavailable(action: string): Error {
	return new Error(`This desktop build cannot ${action}.`);
}

function unavailableOpaqueId(): string {
	throw unavailable('mint a watch-rule identity');
}

function unavailableJobId(): string {
	throw unavailable('mint a native queue job identity');
}
