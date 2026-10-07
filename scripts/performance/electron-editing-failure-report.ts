/* SPDX-License-Identifier: AGPL-3.0-only */

interface FailureDetails {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
}

interface ElectronEditingFailureReport extends Readonly<Record<string, unknown>> {
	readonly status: 'failed';
	readonly completedObservationCount: number;
	readonly results: readonly object[];
	readonly error: FailureDetails;
}

/** Context and completed observations retain their existing JSON-ready metadata. */
export function createElectronEditingFailureReport(
	context: Readonly<Record<string, unknown>>,
	results: readonly object[],
	error: unknown,
): ElectronEditingFailureReport {
	return {
		...context,
		status: 'failed',
		completedObservationCount: results.length,
		results: [...results],
		error: failureDetails(error),
	};
}

function failureDetails(error: unknown): FailureDetails {
	if (error instanceof Error) {
		const { name, message, stack } = error;
		return { name, message, ...(typeof stack === 'string' ? { stack } : {}) };
	}
	let message: string;
	try { message = String(error); }
	catch { message = 'A non-Error value was thrown and could not be converted to text.'; }
	return { name: 'NonErrorThrown', message };
}
