/* SPDX-License-Identifier: AGPL-3.0-only */

interface EditorStatus {
	readonly message?: string | null;
	readonly state?: string | null;
}

/** Errors announce through a toast; the status toolbar remains a compact progress surface. */
export function workspaceStatusPresentation(status: EditorStatus | null | undefined, localError: string | null | undefined, ready: string) {
	const controllerError = status?.state === 'error' ? status.message || null : null;
	const hasError = Boolean(localError || controllerError);
	return {
		statusMessage: hasError ? '' : status?.message || ready,
		statusState: hasError ? 'info' : status?.state || 'info',
		statusError: localError ? null : controllerError,
	};
}
