import type {
	DesktopNightlyTestsProgress,
	DesktopNightlyTestsStatus,
} from '../scripts/lib/desktop-nightly-tests-runtime.mjs';

interface NightlyTestsBrowserWindow {
	readonly webContents: {
		executeJavaScript(source: string, userGesture?: boolean): Promise<unknown>;
		setWindowOpenHandler(handler: () => { readonly action: 'deny' }): void;
		on(event: 'will-navigate', listener: (event: { preventDefault(): void }, candidate: string) => void): void;
	};
	loadURL(url: string): Promise<void>;
	once(event: 'closed', listener: () => void): void;
	show(): void;
	setTitle(title: string): void;
	setProgressBar(value: number, options?: { readonly mode: 'normal' | 'error' | 'paused' }): void;
	isDestroyed(): boolean;
	destroy(): void;
}

export interface DesktopNightlyTestsProgressWindow {
	readonly window: NightlyTestsBrowserWindow;
	update(progress: DesktopNightlyTestsProgress): void;
	finish(
		progress: DesktopNightlyTestsProgress,
		status: Exclude<DesktopNightlyTestsStatus, 'running'>,
	): void;
}

export const NIGHTLY_TESTS_PROGRESS_SCHEME: 'soundscaper-nightly-progress';
export const NIGHTLY_TESTS_PROGRESS_DOCUMENT_URL: string;

export function createDesktopNightlyTestsProgressWindow(options: {
	readonly BrowserWindow: new (options: Readonly<Record<string, unknown>>) => NightlyTestsBrowserWindow;
	readonly protocol: {
		handle(scheme: string, handler: (request: { readonly url: string; readonly method: string }) => Response): void;
		unhandle(scheme: string): void;
	};
	readonly initialProgress: DesktopNightlyTestsProgress;
	readonly onError?: (error: unknown) => void;
}): Promise<DesktopNightlyTestsProgressWindow>;
