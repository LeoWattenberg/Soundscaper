/* SPDX-License-Identifier: AGPL-3.0-only */

import { errorDiagnosticMessage } from '../error-diagnostic-message.ts';

interface PresentationState {
	status: { message: string; state: string };
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
	readonly publishDocument: () => void;
	readonly publishTelemetry: () => void;
	readonly updateTaskProgress: (progress: number) => void;
}) {
	const { state, copy, publishDocument, publishTelemetry } = dependencies;
	function setStatus(message: string, status = 'info'): void {
		state.status = { message: message || copy.ready, state: status };
		publishDocument();
	}
	return Object.freeze({
		setStatus,
		handleError(error: unknown): null {
			state.localDiagnostics.record(error, 'controller');
			setStatus(copy.genericError.replace('{message}', errorDiagnosticMessage(error, copy.unknownError)), 'error');
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
