/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DesktopMainWindowRecoveryOptions {
	readonly cleanup: () => void | Promise<void>;
	readonly reload: () => void | Promise<void>;
	readonly exit: (code: number) => void | Promise<void>;
	readonly reportError?: (error: unknown) => void;
}

export interface DesktopMainWindowRecoveryAttachmentOptions {
	readonly cleanup: () => Promise<void>;
	readonly editorUrl: string;
	readonly exit: (code: number) => void | Promise<void>;
	readonly isIntentional: () => boolean;
	readonly reportError: (error: unknown) => void;
	readonly webContents: Readonly<{
		on(event: 'render-process-gone', listener: () => void): unknown;
	}>;
	readonly windowFor: () => Readonly<{
		isDestroyed(): boolean;
		loadURL(url: string): Promise<unknown>;
		readonly webContents: unknown;
	}> | null;
}

/** Coalesces a crashed renderer into one cleanup barrier and trusted reload. */
export class DesktopMainWindowRecovery {
	#cleanup: () => void | Promise<void>;
	#exit: (code: number) => void | Promise<void>;
	#recovery: Promise<void> | null = null;
	#reload: () => void | Promise<void>;
	#reportError: (error: unknown) => void;

	constructor(options: DesktopMainWindowRecoveryOptions) {
		this.#cleanup = requiredCallback(options.cleanup, 'cleanup');
		this.#reload = requiredCallback(options.reload, 'reload');
		this.#exit = requiredCallback(options.exit, 'exit');
		this.#reportError = options.reportError ?? (() => {});
	}

	recover(): Promise<void> {
		this.#recovery ??= this.#run().finally(() => { this.#recovery = null; });
		return this.#recovery;
	}

	async #run(): Promise<void> {
		try {
			await this.#cleanup();
			await this.#reload();
		} catch (error) {
			try { this.#reportError(error); } catch { /* Reporting cannot restore a renderer. */ }
			await this.#exit(1);
		}
	}
}

/** Attaches the only renderer-crash path and keeps window validation out of main composition. */
export function attachDesktopMainWindowRecovery(
	options: DesktopMainWindowRecoveryAttachmentOptions,
): DesktopMainWindowRecovery {
	const recovery = new DesktopMainWindowRecovery({
		cleanup: options.cleanup,
		reload: async () => {
			const window = options.windowFor();
			if (!window || window.isDestroyed() || window.webContents !== options.webContents) {
				throw new Error('Desktop main window is unavailable for renderer recovery');
			}
			await window.loadURL(options.editorUrl);
		},
		exit: options.exit,
		reportError: options.reportError,
	});
	options.webContents.on('render-process-gone', () => {
		if (options.isIntentional()) {
			void options.cleanup().catch(options.reportError);
			return;
		}
		void recovery.recover();
	});
	return recovery;
}

function requiredCallback<Value extends (...args: never[]) => unknown>(value: Value, label: string): Value {
	if (typeof value !== 'function') throw new TypeError(`Desktop main-window recovery requires ${label}`);
	return value;
}
