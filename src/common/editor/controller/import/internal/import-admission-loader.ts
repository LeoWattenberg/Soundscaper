/* SPDX-License-Identifier: AGPL-3.0-only */

let execution: Promise<typeof import('./project-import-admission.ts')> | null = null;

/** Keep the import dependency preload at one entry shared by foreground and archive imports. */
export function loadImportAdmissionExecution(): Promise<typeof import('./project-import-admission.ts')> {
	return execution ||= import('./project-import-admission.ts').catch((error: unknown) => {
		execution = null;
		throw error;
	});
}
