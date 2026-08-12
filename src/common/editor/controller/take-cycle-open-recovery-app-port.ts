/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeMediaRecoveryDecision } from '../take-media-recovery-journal.ts';
import type { TakeCyclePendingOpenRecovery } from './take-cycle-capture-orchestrator.ts';
import type {
	TakeCycleOpenRecoveryCoordinator,
} from './take-cycle-open-recovery-coordinator.ts';

export { createTakeCycleOpenRecoveryCoordinator } from './take-cycle-open-recovery-coordinator.ts';

export type TakeCycleDeferredOpenOperation = () => PromiseLike<unknown> | unknown;

export interface TakeCycleOpenRecoveryAppPort {
	readonly blocked: boolean;
	inspectOpenedProject(projectId: string): Promise<Readonly<{ readonly pending: boolean }>>;
	deferRecordOpened(operation: TakeCycleDeferredOpenOperation): Promise<boolean>;
	deferInitialSave(operation: TakeCycleDeferredOpenOperation): Promise<boolean>;
	deferGarbageCollection(operation: TakeCycleDeferredOpenOperation): Promise<boolean>;
	deferMaintenance(operation: TakeCycleDeferredOpenOperation): Promise<boolean>;
	resolve(pending: TakeCyclePendingOpenRecovery, decision: TakeMediaRecoveryDecision): Promise<void>;
	leaveProject(projectId: string): void;
	dispose(): void;
}

export type TakeCycleOpenRecoveryProjectPort = Pick<TakeCycleOpenRecoveryAppPort,
	'blocked' | 'inspectOpenedProject' | 'deferRecordOpened' | 'deferInitialSave'
	| 'deferGarbageCollection' | 'deferMaintenance'
>;

/** Forward-reference the recovery coordinator across the legacy app composition order. */
export function createTakeCycleOpenRecoveryAppPort(): Readonly<{
	readonly port: Readonly<TakeCycleOpenRecoveryAppPort>;
	bind(coordinator: Readonly<TakeCycleOpenRecoveryCoordinator>): void;
}> {
	let coordinator: Readonly<TakeCycleOpenRecoveryCoordinator> | null = null;
	const requireCoordinator = (): Readonly<TakeCycleOpenRecoveryCoordinator> => {
		if (!coordinator) throw new Error('Take cycle open recovery is not composed.');
		return coordinator;
	};
	return Object.freeze({
		port: Object.freeze({
			get blocked() { return coordinator?.blocked ?? true; },
			inspectOpenedProject: (projectId: string) => requireCoordinator().inspectOpenedProject(projectId),
			deferRecordOpened: (operation: TakeCycleDeferredOpenOperation) => requireCoordinator().deferRecordOpened(operation),
			deferInitialSave: (operation: TakeCycleDeferredOpenOperation) => requireCoordinator().deferInitialSave(operation),
			deferGarbageCollection: (operation: TakeCycleDeferredOpenOperation) => requireCoordinator().deferGarbageCollection(operation),
			deferMaintenance: (operation: TakeCycleDeferredOpenOperation) => requireCoordinator().deferMaintenance(operation),
			resolve: (pending: TakeCyclePendingOpenRecovery, decision: TakeMediaRecoveryDecision) => (
				requireCoordinator().resolve(pending, decision)
			),
			leaveProject: (projectId: string) => requireCoordinator().leaveProject(projectId),
			dispose: () => requireCoordinator().dispose(),
		}),
		bind(value) {
			if (coordinator) throw new Error('Take cycle open recovery is already composed.');
			coordinator = value;
		},
	});
}

/** Preserve legacy focused fixtures that do not compose durable cycle repositories. */
export function createImmediateTakeCycleOpenRecoveryProjectPort(): Readonly<TakeCycleOpenRecoveryProjectPort> {
	const run = async (operation: TakeCycleDeferredOpenOperation): Promise<true> => {
		await operation();
		return true;
	};
	return Object.freeze({
		blocked: false,
		inspectOpenedProject: async () => Object.freeze({ pending: false }),
		deferRecordOpened: run,
		deferInitialSave: run,
		deferGarbageCollection: run,
		deferMaintenance: run,
	});
}
