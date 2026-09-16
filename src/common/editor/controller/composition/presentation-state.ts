/* SPDX-License-Identifier: AGPL-3.0-only */

import { errorDiagnosticMessage } from '../../error-diagnostic-message.ts';
import { freezePresentationMessage, localizedErrorMessage, setLocalizedStatus, type LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';

interface PresentationState {
	status: { message: string; state: string; localization?: LocalizedPresentationMessage };
	exportProgress: number;
	analysisResult: unknown;
	analysisVisuals: unknown;
	analysisReport: unknown;
	readonly localDiagnostics: { record(error: unknown, source: 'controller'): void };
}

/** Own the rules for publishing low-frequency document state and live progress. */
export function createControllerPresentationState(dependencies: {
	readonly state: PresentationState;
	readonly copy: Readonly<{ ready: string; genericError: string; unknownError: string }>;
	readonly formatMessage?: (message: LocalizedPresentationMessage) => string;
	readonly publishDocument: () => void;
	readonly publishTelemetry: () => void;
	readonly updateTaskProgress: (progress: number) => void;
}) {
	const { state, copy, publishDocument, publishTelemetry } = dependencies;
	function setStatus(message: string, status = 'info', localization?: LocalizedPresentationMessage): void {
		const identity = localization ? freezePresentationMessage(localization) : !message ? Object.freeze({ key: 'ready' }) : undefined;
		state.status = { message: identity && dependencies.formatMessage ? dependencies.formatMessage(identity) : message || copy.ready, state: status, ...(identity ? { localization: identity } : {}) };
		publishDocument();
	}
	return Object.freeze({
		setStatus,
		refreshLocalization(format: (message: LocalizedPresentationMessage) => string): void {
			if (state.status.localization) state.status = { ...state.status, message: format(state.status.localization) };
		},
		handleError(error: unknown): null {
			state.localDiagnostics.record(error, 'controller');
			setLocalizedStatus(setStatus, copy, 'genericError', { message: localizedErrorMessage(error) ?? errorDiagnosticMessage(error, copy.unknownError) }, 'error');
			return null;
		},
		showAnalysis(result: unknown, visuals: unknown = null, report: unknown = null): void {
			state.analysisResult = result || null;
			state.analysisVisuals = visuals;
			state.analysisReport = report;
			publishDocument();
		},
		toggleExport(active: boolean): void {
			if (!active) { state.exportProgress = 0; publishTelemetry(); }
			publishDocument();
		},
		updateExportProgress(progress: unknown): void {
			state.exportProgress = Math.max(0, Math.min(1, Number(progress) || 0));
			dependencies.updateTaskProgress(state.exportProgress);
			publishTelemetry();
		},
	});
}
