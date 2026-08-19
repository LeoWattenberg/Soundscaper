/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeliveryPresetService } from './delivery-preset-service.ts';
import { createDeliveryQueueService } from './delivery-queue-service.ts';
import { saveCurrentDeliveryReport } from './delivery-report-action.ts';
import { exportProjectEdl, exportProjectFcpxml, exportProjectOtio } from './interchange-export-action.ts';

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
	readonly getProject?: () => Readonly<Record<string, unknown>> | null | undefined;
}

export function createExportActionGroup(runtime: ExportActionGroupRuntime) {
	const {
		handleExportAction, state, productName, getProjectTitle,
		fileService, persistSetting, publishDocumentSnapshot, createId, getProject,
	} = runtime;
	const interchange = () => ({
		getProject: getProject ?? (() => null), state, fileService, publishDocumentSnapshot,
	});
	return Object.freeze({
		start: (settings: unknown) => handleExportAction('start', settings),
		cancel: () => handleExportAction('cancel'),
		/**
		 * Show the delivery canvas an open export dialog is asking for.
		 *
		 * A delivery that reframes to 9:16 was never previewed at 9:16: the panel
		 * resolves the project's derived canvas and nothing told it otherwise, so
		 * the one control whose whole purpose is reframing could not be judged
		 * before the render. This is session state, cleared when the dialog closes.
		 */
		previewDeliveryCanvas: (canvas: unknown) => {
			const next = canvas && typeof canvas === 'object' ? canvas : null;
			if (state.videoDeliveryPreviewCanvas === next) return;
			state.videoDeliveryPreviewCanvas = next;
			publishDocumentSnapshot?.();
		},
		saveReport: () => saveCurrentDeliveryReport({
			state, productName: productName ?? null, projectTitle: getProjectTitle?.() ?? null, fileService,
		}),
		exportEdl: (options?: {
			sequenceId?: string; trackId?: string; reelNames?: Readonly<Record<string, string>>;
		}) => exportProjectEdl({ ...interchange(), ...options }),
		exportOtio: (options?: { sequenceId?: string }) => exportProjectOtio({ ...interchange(), ...options }),
		exportFcpxml: (options?: { sequenceId?: string }) => exportProjectFcpxml({ ...interchange(), ...options }),
		presets: createDeliveryPresetService({
			state, persistSetting, publishDocumentSnapshot, createId, fileService,
		}),
		queue: createDeliveryQueueService({
			handleExportAction, publishDocumentSnapshot, createId, state,
		}),
	});
}
