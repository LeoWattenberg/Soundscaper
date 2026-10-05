/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FramescaperCaptureSetupOptions { readonly showPanel?: boolean }

/** UI setup surfaces share runtime initialization while choosing whether to open its dock. */
export function createFramescaperCaptureSetupActions<Actions extends Readonly<{ openSetup(): unknown }>>(
	actions: Actions,
	setPanelVisibility: (panelId: string, visible: boolean) => Promise<unknown>,
	reportError: (error: unknown) => unknown,
): Omit<Actions, 'openSetup'> & Readonly<{ openSetup(options?: FramescaperCaptureSetupOptions): void }> {
	return Object.freeze({ ...actions, openSetup: (options?: FramescaperCaptureSetupOptions): void => {
		actions.openSetup();
		if (options?.showPanel !== false) void setPanelVisibility('recording-setup', true).catch(reportError);
	} });
}
