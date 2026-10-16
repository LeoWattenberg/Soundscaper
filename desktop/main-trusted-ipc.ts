/* SPDX-License-Identifier: AGPL-3.0-only */

type Listener = (event: unknown, ...args: unknown[]) => unknown;

/** Share the current-window and main-document check across desktop services. */
export function createTrustedDesktopIpc(options: {
	readonly ipcMain: { handle(channel: string, listener: Listener): unknown; on(channel: string, listener: Listener): unknown };
	readonly windowFor: () => { readonly webContents: unknown } | null;
	readonly assertDocumentUrl: (url: string) => void;
}) {
	function assertTrusted(eventValue: unknown): void {
		const event = eventValue as { sender?: { mainFrame?: unknown }; senderFrame?: { url: string } } | null;
		const window = options.windowFor();
		if (!window || !event || event.sender !== window.webContents) throw new Error('IPC sender is not the application window');
		if (!event.senderFrame || event.senderFrame !== event.sender?.mainFrame) {
			throw new Error('IPC sender is not the active main document');
		}
		options.assertDocumentUrl(event.senderFrame.url);
	}
	return {
		handle(channel: string, listener: Listener): void {
			options.ipcMain.handle(channel, (event, ...args) => { assertTrusted(event); return listener(event, ...args); });
		},
		on(channel: string, listener: Listener): void {
			options.ipcMain.on(channel, (event, ...args) => { assertTrusted(event); listener(event, ...args); });
		},
	};
}
