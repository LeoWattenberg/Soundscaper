/* SPDX-License-Identifier: AGPL-3.0-only */

export function modelTestCleanupDiagnostic(error) {
	const name = error instanceof Error && /^[A-Za-z][A-Za-z\d]{0,31}$/u.test(error.name)
		? error.name : 'Error';
	const message = error instanceof Error && error.message.length <= 512
		&& ![...error.message].some((character) => character === '/' || character === '\\'
			|| character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		? error.message : '[path-bearing message omitted]';
	return { name, message };
}

/** Preserve the model step failure if authenticated coverage cleanup also fails. */
export async function withModelTestElectron(electron, operation, reportCleanupError) {
	let operationFailed = false;
	let operationError;
	let result;
	try {
		result = await operation();
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}
	try {
		await electron.close();
	} catch (error) {
		if (!operationFailed) throw error;
		try { await reportCleanupError(error); }
		catch { /* Attachment failure cannot mask the primary model failure. */ }
	}
	if (operationFailed) throw operationError;
	return result;
}
