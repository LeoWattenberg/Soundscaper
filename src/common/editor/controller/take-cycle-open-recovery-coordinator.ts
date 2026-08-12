/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeMediaRecoveryDecision } from '../take-media-recovery-journal.ts';
import type { TakeCyclePendingOpenRecovery } from './take-cycle-capture-orchestrator.ts';

type DeferredOperation = () => PromiseLike<unknown> | unknown;
type DeferredKind = 'record-opened' | 'initial-save' | 'garbage-collection' | 'maintenance';
const DEFERRED_ORDER: readonly DeferredKind[] = Object.freeze([
	'record-opened', 'initial-save', 'garbage-collection', 'maintenance',
]);

export interface TakeCycleOpenRecoveryState {
	takeCycleRecovery: TakeCyclePendingOpenRecovery | null;
	takeCycleRecoveryInspecting: boolean;
}

export interface TakeCycleOpenRecoveryDependencies {
	readonly state: TakeCycleOpenRecoveryState;
	inspect(projectId: string): PromiseLike<TakeCyclePendingOpenRecovery | null>;
	recover(
		pending: TakeCyclePendingOpenRecovery,
		decision: TakeMediaRecoveryDecision,
	): PromiseLike<void> | void;
	getCurrentProjectId(): string | null;
	isDisposed(): boolean;
	isCurrentProjectWritable(): boolean;
	publish(): void;
}

export interface TakeCycleOpenRecoveryCoordinator {
	readonly blocked: boolean;
	inspectOpenedProject(projectId: string): Promise<Readonly<{ readonly pending: boolean }>>;
	deferRecordOpened(operation: DeferredOperation): Promise<boolean>;
	deferInitialSave(operation: DeferredOperation): Promise<boolean>;
	deferGarbageCollection(operation: DeferredOperation): Promise<boolean>;
	deferMaintenance(operation: DeferredOperation): Promise<boolean>;
	resolve(pending: TakeCyclePendingOpenRecovery, decision: TakeMediaRecoveryDecision): Promise<void>;
	leaveProject(projectId: string): void;
	dispose(): void;
}

/** Own explicit open recovery and all post-open mutations deferred behind it. */
export function createTakeCycleOpenRecoveryCoordinator(
	dependencies: TakeCycleOpenRecoveryDependencies,
): Readonly<TakeCycleOpenRecoveryCoordinator> {
	let authority: TakeCyclePendingOpenRecovery | null = null;
	let resolving: Promise<void> | null = null;
	let resolvingDecision: TakeMediaRecoveryDecision | null = null;
	let resolvingAuthority: TakeCyclePendingOpenRecovery | null = null;
	let inspectionGeneration = 0;
	let inspectingProjectId: string | null = null;
	const deferred = new Map<DeferredKind, DeferredOperation[]>();
	return Object.freeze({
		get blocked() { return authority !== null || dependencies.state.takeCycleRecoveryInspecting; },
		inspectOpenedProject,
		deferRecordOpened: (operation: DeferredOperation) => defer('record-opened', operation),
		deferInitialSave: (operation: DeferredOperation) => defer('initial-save', operation),
		deferGarbageCollection: (operation: DeferredOperation) => defer('garbage-collection', operation),
		deferMaintenance: (operation: DeferredOperation) => defer('maintenance', operation),
		resolve,
		leaveProject,
		dispose: () => clearAuthority(false),
	});

	async function inspectOpenedProject(projectId: string): Promise<Readonly<{ readonly pending: boolean }>> {
		assertCurrentProject(projectId);
		const generation = ++inspectionGeneration;
		inspectingProjectId = projectId;
		deferred.clear();
		dependencies.state.takeCycleRecoveryInspecting = true;
		let inspected = false;
		try {
			const pending = await dependencies.inspect(projectId);
			assertCurrentProject(projectId);
			if (generation !== inspectionGeneration) throw staleAuthorityError();
			if (pending) assertPendingAuthority(pending, projectId);
			authority = pending;
			dependencies.state.takeCycleRecovery = pending;
			inspected = true;
			if (!pending) await drainDeferred(projectId);
			return Object.freeze({ pending: pending !== null });
		} finally {
			if (generation === inspectionGeneration) {
				inspectingProjectId = null;
				if (inspected) dependencies.state.takeCycleRecoveryInspecting = false;
				else {
					deferred.clear();
					if (authority?.projectId !== dependencies.getCurrentProjectId()) {
						authority = null;
						dependencies.state.takeCycleRecovery = null;
					}
				}
				dependencies.publish();
			}
		}
	}

	async function defer(kind: DeferredKind, operation: DeferredOperation): Promise<boolean> {
		if (!authority && !dependencies.state.takeCycleRecoveryInspecting) {
			await operation();
			return true;
		}
		const operations = deferred.get(kind) ?? [];
		operations.push(operation);
		deferred.set(kind, operations);
		return false;
	}

	function resolve(
		pending: TakeCyclePendingOpenRecovery,
		decision: TakeMediaRecoveryDecision,
	): Promise<void> {
		if (!authority) return Promise.reject(new Error('Take cycle recovery authority is stale.'));
		if (pending !== authority || pending !== dependencies.state.takeCycleRecovery) {
			return Promise.reject(new Error('Take cycle recovery requires the exact pending authority.'));
		}
		if (decision !== 'recover' && decision !== 'discard') {
			return Promise.reject(new RangeError('Take cycle recovery decision is invalid.'));
		}
		if (!dependencies.isCurrentProjectWritable()) {
			return Promise.reject(new Error('Take cycle recovery decisions require a writable active project.'));
		}
		if (resolving) {
			if (pending === resolvingAuthority && decision === resolvingDecision) return resolving;
			return Promise.reject(new Error('Take cycle recovery is already settling another decision.'));
		}
		try { assertCurrentProject(authority.projectId); }
		catch (error) { return Promise.reject(error); }
		const exactAuthority = authority;
		resolvingAuthority = exactAuthority;
		resolvingDecision = decision;
		resolving = settle(exactAuthority, decision).finally(() => {
			resolving = null;
			resolvingAuthority = null;
			resolvingDecision = null;
		});
		return resolving;
	}

	async function settle(
		pending: TakeCyclePendingOpenRecovery,
		decision: TakeMediaRecoveryDecision,
	): Promise<void> {
		try {
			await dependencies.recover(pending, decision);
		} catch (error) {
			if (await reconcileAuthorityAfterFailure(pending) === 'settled') {
				await finishSettlement(pending, dependencies.isCurrentProjectWritable());
				return;
			}
			throw error;
		}
		assertCurrentProject(pending.projectId);
		if (!dependencies.isCurrentProjectWritable()) {
			if (await reconcileAuthorityAfterFailure(pending) === 'settled') {
				await finishSettlement(pending, false);
				return;
			}
			throw new Error('Take cycle recovery lost project write authority during settlement.');
		}
		await finishSettlement(pending, true);
	}

	async function reconcileAuthorityAfterFailure(
		pending: TakeCyclePendingOpenRecovery,
	): Promise<'settled' | 'pending' | 'unknown'> {
		try {
			assertCurrentProject(pending.projectId);
			const inspected = await dependencies.inspect(pending.projectId);
			assertCurrentProject(pending.projectId);
			if (!inspected) return 'settled';
			assertPendingAuthority(inspected, pending.projectId);
			if (authority === pending && dependencies.state.takeCycleRecovery === pending) {
				authority = inspected;
				dependencies.state.takeCycleRecovery = inspected;
				dependencies.publish();
			}
			return 'pending';
		} catch {
			return 'unknown';
		}
	}

	async function finishSettlement(
		pending: TakeCyclePendingOpenRecovery,
		resumeDeferred: boolean,
	): Promise<void> {
		assertCurrentProject(pending.projectId);
		if (authority !== pending || dependencies.state.takeCycleRecovery !== pending) {
			throw new Error('Take cycle recovery authority changed during settlement.');
		}
		const operations = deferredOperations();
		deferred.clear();
		authority = null;
		dependencies.state.takeCycleRecovery = null;
		dependencies.publish();
		for (const operation of resumeDeferred ? operations : []) {
			assertCurrentProject(pending.projectId);
			await operation();
		}
	}

	function leaveProject(projectId: string): void {
		if (authority?.projectId !== projectId && inspectingProjectId !== projectId) return;
		deferred.clear();
		clearAuthority(true);
	}

	async function drainDeferred(projectId: string): Promise<void> {
		while (deferred.size) {
			const operations = deferredOperations();
			deferred.clear();
			for (const operation of operations) {
				assertCurrentProject(projectId);
				await operation();
			}
		}
	}

	function deferredOperations(): readonly DeferredOperation[] {
		return DEFERRED_ORDER.flatMap((kind) => deferred.get(kind) ?? []);
	}

	function clearAuthority(publish: boolean): void {
		inspectionGeneration += 1;
		inspectingProjectId = null;
		authority = null;
		deferred.clear();
		dependencies.state.takeCycleRecoveryInspecting = false;
		if (dependencies.state.takeCycleRecovery) {
			dependencies.state.takeCycleRecovery = null;
			if (publish) dependencies.publish();
		}
	}

	function assertCurrentProject(projectId: string): void {
		if (dependencies.isDisposed() || dependencies.getCurrentProjectId() !== projectId) {
			throw staleAuthorityError();
		}
	}
}

function staleAuthorityError(): Error {
	return new Error('Take cycle recovery authority is stale for the active project.');
}

function assertPendingAuthority(pending: TakeCyclePendingOpenRecovery, projectId: string): void {
	if (pending.projectId !== projectId || pending.requiresDecision !== true || !Object.isFrozen(pending)) {
		throw new Error('Take cycle inspection returned invalid pending authority.');
	}
}
