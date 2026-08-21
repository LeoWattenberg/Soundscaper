/* SPDX-License-Identifier: AGPL-3.0-only */

export type AudioEditorDesktopPlatform = 'win32' | 'linux' | 'darwin';

export interface AudioEditorDesktopChromeLabels {
	readonly minimize: string;
	readonly maximize: string;
	readonly restore: string;
	readonly quit: string;
}

/** Renderer-owned projection of the narrow, privileged desktop window bridge. */
export interface AudioEditorDesktopChrome {
	readonly platform: AudioEditorDesktopPlatform;
	readonly fullscreen: boolean;
	readonly maximized: boolean;
	readonly labels: AudioEditorDesktopChromeLabels;
	readonly onMinimize: () => void;
	readonly onToggleMaximize: () => void;
	readonly onQuit: () => void;
}

interface AudioEditorWindowControlsProps {
	readonly desktopChrome?: AudioEditorDesktopChrome | null;
	readonly fullscreenLabel: string;
	readonly onFullscreen: () => void;
}

/** Windows and Linux conventionally reserve Alt mnemonics for their app menubars. */
export function desktopChromeSupportsMenuAccessKeys(
	platform: AudioEditorDesktopPlatform | undefined,
): boolean {
	return platform === 'win32' || platform === 'linux';
}

export default function AudioEditorWindowControls({
	desktopChrome = null,
	fullscreenLabel,
	onFullscreen,
}: AudioEditorWindowControlsProps) {
	const maximizeLabel = desktopChrome?.maximized
		? desktopChrome.labels.restore
		: desktopChrome?.labels.maximize;
	const maximizeAction = desktopChrome?.maximized ? 'restore' : 'maximize';
	return (
		<div className="kw-audio-editor__window-actions">
			<button type="button" className="kw-audio-editor__fullscreen" aria-label={fullscreenLabel} title={fullscreenLabel} onClick={onFullscreen}>
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
				</svg>
			</button>
			{desktopChrome && <div className="application-header__windows-controls" data-desktop-window-controls="true">
				<button
					type="button"
					className="application-header__windows-control application-header__windows-control--minimize"
					aria-label={desktopChrome.labels.minimize}
					title={desktopChrome.labels.minimize}
					data-window-control="minimize"
					onClick={desktopChrome.onMinimize}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8.5h10" /></svg>
				</button>
				<button
					type="button"
					className="application-header__windows-control application-header__windows-control--maximize"
					aria-label={maximizeLabel}
					title={maximizeLabel}
					aria-pressed={desktopChrome.maximized}
					disabled={desktopChrome.fullscreen}
					data-window-control={maximizeAction}
					onClick={desktopChrome.onToggleMaximize}
				>
					{desktopChrome.maximized
						? <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5.5 5.5V3h7.5v7.5h-2.5M3 5.5h7.5V13H3z" /></svg>
						: <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3h10v10H3z" /></svg>}
				</button>
				<button
					type="button"
					className="application-header__windows-control application-header__windows-control--close"
					aria-label={desktopChrome.labels.quit}
					title={desktopChrome.labels.quit}
					data-window-control="quit"
					onClick={desktopChrome.onQuit}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 4 8 8m0-8-8 8" /></svg>
				</button>
			</div>}
		</div>
	);
}
