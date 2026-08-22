/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperNativeQueueEnqueueRendererRequest,
	FramescaperNativeQueueProjection,
	FramescaperNativeQueueRendererAction,
	FramescaperNativeServicePreference,
	FramescaperNativeServicesRendererSnapshot,
	FramescaperNativeServicesStore,
	FramescaperNativeWatchCreateRendererRequest,
} from './framescaper-native-services-bridge.ts';

export type FramescaperNativeQueueUiAction =
	| FramescaperNativeQueueRendererAction
	| 'remove';

export type FramescaperNativeServicesDialogAction =
	| Readonly<{ readonly type: 'refresh' }>
	| Readonly<{
		readonly type: 'queue-control';
		readonly jobId: string;
		readonly action: FramescaperNativeQueueRendererAction;
	}>
	| Readonly<{ readonly type: 'queue-remove'; readonly jobId: string }>
	| Readonly<{ readonly type: 'queue-reorder'; readonly jobId: string; readonly index: number }>
	| (Readonly<{ readonly type: 'queue-enqueue' }> & FramescaperNativeQueueEnqueueRendererRequest)
	| Readonly<{ readonly type: 'root-select' }>
	| Readonly<{ readonly type: 'root-revalidate'; readonly grantId: string }>
	| Readonly<{ readonly type: 'root-revoke'; readonly grantId: string }>
	| (Readonly<{ readonly type: 'watch-create' }> & FramescaperNativeWatchCreateRendererRequest)
	| Readonly<{ readonly type: 'watch-set-enabled'; readonly ruleId: string; readonly enabled: boolean }>
	| Readonly<{ readonly type: 'watch-remove'; readonly ruleId: string }>
	| Readonly<{ readonly type: 'watch-reconcile' }>
	| Readonly<{ readonly type: 'scratch-cleanup' }>
	| Readonly<{ readonly type: 'scratch-settle'; readonly jobId: string }>
	| Readonly<{
		readonly type: 'set-preference';
		readonly preference: FramescaperNativeServicePreference;
		readonly enabled: boolean;
	}>;

export interface FramescaperNativeServicesDialogState {
	readonly snapshot: FramescaperNativeServicesRendererSnapshot | null;
	readonly pending: string | null;
	readonly completed: string | null;
	readonly error: string;
}

export type FramescaperNativeServicesDialogEvent =
	| Readonly<{ readonly type: 'begin'; readonly action: FramescaperNativeServicesDialogAction }>
	| Readonly<{
		readonly type: 'settled';
		readonly action: FramescaperNativeServicesDialogAction;
		readonly snapshot: FramescaperNativeServicesRendererSnapshot;
	}>
	| Readonly<{
		readonly type: 'failed';
		readonly action: FramescaperNativeServicesDialogAction;
		readonly message: string;
	}>;

export const EMPTY_FRAMESCAPER_NATIVE_SERVICES_DIALOG_STATE:
	FramescaperNativeServicesDialogState = Object.freeze({
		snapshot: null,
		pending: null,
		completed: null,
		error: '',
	});

export function framescaperNativeServicesActionKey(
	action: FramescaperNativeServicesDialogAction,
): string {
	if (action.type === 'queue-control') return `queue:${action.jobId}:${action.action}`;
	if (action.type === 'queue-remove') return `queue:${action.jobId}:remove`;
	if (action.type === 'queue-reorder') return `queue:${action.jobId}:reorder:${String(action.index)}`;
	if (action.type === 'queue-enqueue') return `queue:enqueue:${action.projectId}`;
	if (action.type === 'root-select') return 'root:select';
	if (action.type === 'root-revalidate') return `root:${action.grantId}:revalidate`;
	if (action.type === 'root-revoke') return `root:${action.grantId}:revoke`;
	if (action.type === 'watch-create') return `watch:create:${action.projectId}`;
	if (action.type === 'watch-set-enabled') {
		return `watch:${action.ruleId}:${action.enabled ? 'enable' : 'disable'}`;
	}
	if (action.type === 'watch-remove') return `watch:${action.ruleId}:remove`;
	if (action.type === 'watch-reconcile') return 'watch:reconcile';
	if (action.type === 'scratch-cleanup') return 'scratch:cleanup';
	if (action.type === 'scratch-settle') return `scratch:${action.jobId}:settle`;
	if (action.type === 'set-preference') {
		return `preference:${action.preference}:${String(action.enabled)}`;
	}
	return 'refresh';
}

export function reduceFramescaperNativeServicesDialog(
	state: FramescaperNativeServicesDialogState,
	event: FramescaperNativeServicesDialogEvent,
): FramescaperNativeServicesDialogState {
	const key = framescaperNativeServicesActionKey(event.action);
	if (event.type === 'begin') {
		return Object.freeze({ ...state, pending: key, completed: null, error: '' });
	}
	if (event.type === 'failed') {
		return Object.freeze({ ...state, pending: null, completed: null, error: event.message });
	}
	return Object.freeze({
		snapshot: event.snapshot,
		pending: null,
		completed: key,
		error: '',
	});
}

export async function runFramescaperNativeServicesAction(
	store: FramescaperNativeServicesStore,
	action: FramescaperNativeServicesDialogAction,
): Promise<FramescaperNativeServicesDialogEvent> {
	try {
		const snapshot = await perform(store, action);
		return Object.freeze({ type: 'settled' as const, action, snapshot });
	} catch (error) {
		return Object.freeze({
			type: 'failed' as const,
			action,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

export function framescaperNativeQueueUiActions(
	job: FramescaperNativeQueueProjection,
	runtimeUsable: boolean,
): readonly FramescaperNativeQueueUiAction[] {
	if (job.state === 'completed') return Object.freeze(['remove']);
	if (job.state === 'failed' || job.state === 'cancelled') {
		return Object.freeze(runtimeUsable ? ['retry', 'remove'] : ['remove']);
	}
	if (job.state === 'blocked' && job.lastFailureCode === 'unsupported-plan-version') {
		return Object.freeze(['cancel', 'remove']);
	}
	if (job.state === 'paused') {
		return Object.freeze(runtimeUsable ? ['resume', 'cancel'] : ['cancel']);
	}
	if (job.state === 'queued' || job.state === 'running') {
		return Object.freeze(['pause', 'cancel']);
	}
	return Object.freeze(['cancel']);
}

async function perform(
	store: FramescaperNativeServicesStore,
	action: FramescaperNativeServicesDialogAction,
): Promise<FramescaperNativeServicesRendererSnapshot> {
	if (action.type === 'refresh') return store.refresh();
	if (action.type === 'queue-control') {
		return store.control({ jobId: action.jobId, action: action.action });
	}
	if (action.type === 'queue-remove') return store.remove({ jobId: action.jobId });
	if (action.type === 'queue-reorder') {
		return store.reorder({ jobId: action.jobId, index: action.index });
	}
	if (action.type === 'queue-enqueue') {
		const { type: _type, ...request } = action;
		return store.enqueue(request);
	}
	if (action.type === 'root-select') return store.selectRoot();
	if (action.type === 'root-revalidate') return store.revalidateRoot({ grantId: action.grantId });
	if (action.type === 'root-revoke') return store.revokeRoot({ grantId: action.grantId });
	if (action.type === 'watch-create') {
		const { type: _type, ...request } = action;
		return store.createWatch(request);
	}
	if (action.type === 'watch-set-enabled') {
		return store.setWatchEnabled({ ruleId: action.ruleId, enabled: action.enabled });
	}
	if (action.type === 'watch-remove') return store.removeWatch({ ruleId: action.ruleId });
	if (action.type === 'watch-reconcile') return store.reconcileWatch();
	if (action.type === 'scratch-cleanup') return store.cleanupScratch();
	if (action.type === 'scratch-settle') return store.settleScratch({ jobId: action.jobId });
	return store.setPreference({ preference: action.preference, enabled: action.enabled });
}
