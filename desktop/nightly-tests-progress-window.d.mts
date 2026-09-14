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
	loadFile(file: string): Promise<void>;
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

export function createDesktopNightlyTestsProgressWindow(options: {
	readonly BrowserWindow: new (options: Readonly<Record<string, unknown>>) => NightlyTestsBrowserWindow;
	readonly initialProgress: DesktopNightlyTestsProgress;
}): Promise<DesktopNightlyTestsProgressWindow>;
