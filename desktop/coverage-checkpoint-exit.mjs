/* SPDX-License-Identifier: AGPL-3.0-only */

/** Checkpoints Node coverage without allowing checkpoint/reporting failure to strand Electron. */
export function exitAfterCoverageCheckpoint({ checkpoint, exit, reportError }, requestedCode) {
	let exitCode = requestedCode;
	try {
		checkpoint();
	} catch (error) {
		if (exitCode === 0) exitCode = 1;
		try { reportError(error); } catch { /* The exit remains authoritative. */ }
	} finally {
		exit(exitCode);
	}
}
