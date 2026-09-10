/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorCancellableHandle } from '../shared/lifecycle.ts';

/** The controller workspace fields the export domain reads and publishes. */
export interface EditorExportState {
	deliveryReport?: unknown;
	readonly disposed: boolean;
	exportAbort: EditorCancellableHandle | null;
	exportGeneration: number;
	exportOutput: unknown;
	readonly mobile: boolean;
	outputCleanup: (() => PromiseLike<unknown> | unknown) | null;
	outputUrl: string | null;
}

export type DeliveryReportState = Pick<EditorExportState, 'deliveryReport'>;

/** Limit interchange writers to the report they publish into workspace state. */
export function createDeliveryReportStateAccess(state: DeliveryReportState): DeliveryReportState {
	return Object.freeze({
		get deliveryReport() { return state.deliveryReport; },
		set deliveryReport(value: unknown) { state.deliveryReport = value; },
	});
}

/**
 * Project the flat workspace into the exact state capability loaded export code
 * receives. Accessors keep controller storage live without exposing unrelated
 * workspace or recording/transport-owner fields across the deferred boundary.
 */
export function createEditorExportStateAccess(state: EditorExportState): EditorExportState {
	const access: EditorExportState = {
		get deliveryReport() { return state.deliveryReport; },
		set deliveryReport(value: unknown) { state.deliveryReport = value; },
		get disposed() { return state.disposed; },
		get exportAbort() { return state.exportAbort; },
		set exportAbort(value: EditorCancellableHandle | null) { state.exportAbort = value; },
		get exportGeneration() { return state.exportGeneration; },
		set exportGeneration(value: number) { state.exportGeneration = value; },
		get exportOutput() { return state.exportOutput; },
		set exportOutput(value: unknown) { state.exportOutput = value; },
		get mobile() { return state.mobile; },
		get outputCleanup() { return state.outputCleanup; },
		set outputCleanup(value: (() => PromiseLike<unknown> | unknown) | null) { state.outputCleanup = value; },
		get outputUrl() { return state.outputUrl; },
		set outputUrl(value: string | null) { state.outputUrl = value; },
	};
	Object.freeze(access);
	return access;
}
