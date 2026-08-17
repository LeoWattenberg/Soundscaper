/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeliveryPresetService } from './delivery-preset-service.ts';
import { createDeliveryQueueService } from './delivery-queue-service.ts';
import { saveCurrentDeliveryReport } from './delivery-report-action.ts';

/**
 * The export action group.
 *
 * Extracted from the action facade so delivery can grow its own surfaces —
 * report, presets, queue — without the facade, which sits at its size ceiling,
 * paying a line for each one.
 */

export interface ExportActionGroupRuntime {
	readonly handleExportAction: (action: string, settings?: unknown) => Promise<unknown> | unknown;
	readonly state: Record<string, unknown>;
	readonly productName?: string | null;
	readonly getProjectTitle?: () => string | null;
	readonly fileService?: { saveFile?: (request: Readonly<Record<string, unknown>>) => unknown } | null;
	readonly persistSetting: (
		key: string, value: unknown, options?: Readonly<Record<string, unknown>>,
	) => Promise<unknown> | unknown;
	readonly publishDocumentSnapshot?: () => void;
	readonly createId?: (prefix: string) => string;
}

export function createExportActionGroup(runtime: ExportActionGroupRuntime) {
	const {
		handleExportAction, state, productName, getProjectTitle,
		fileService, persistSetting, publishDocumentSnapshot, createId,
	} = runtime;
	return Object.freeze({
		start: (settings: unknown) => handleExportAction('start', settings),
		cancel: () => handleExportAction('cancel'),
		saveReport: () => saveCurrentDeliveryReport({
			state, productName: productName ?? null, projectTitle: getProjectTitle?.() ?? null, fileService,
		}),
		presets: createDeliveryPresetService({
			state, persistSetting, publishDocumentSnapshot, createId, fileService,
		}),
		queue: createDeliveryQueueService({
			handleExportAction, publishDocumentSnapshot, createId, state,
		}),
	});
}
