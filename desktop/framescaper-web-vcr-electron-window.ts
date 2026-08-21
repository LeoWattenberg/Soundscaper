/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	WebVcrCommandV1,
	WebVcrResolution,
} from './framescaper-web-vcr-contract.ts';
import type {
	FramescaperWebVcrGuestContent,
} from './framescaper-web-vcr-host.ts';
import type {
	FramescaperWebVcrDebuggerPort,
} from './framescaper-web-vcr-target-observer.ts';

type EventListener = (...args: unknown[]) => void;

export interface FramescaperWebVcrElectronWindow extends FramescaperWebVcrGuestContent {
	readonly webContents: Readonly<{
		readonly mainFrame: object;
		readonly debugger: FramescaperWebVcrDebuggerPort;
		readonly navigationHistory: Readonly<{
			canGoBack(): boolean;
			canGoForward(): boolean;
			goBack(): void;
			goForward(): void;
		}>;
		getURL(): string;
		reload(): void;
		setAudioMuted(value: boolean): void;
		sendInputEvent(value: Readonly<Record<string, unknown>>): void;
		setWindowOpenHandler(
			value: (details: Readonly<{ readonly url: string }>) => Readonly<Record<string, unknown>>,
		): void;
		on(name: string, listener: EventListener): void;
		removeListener(name: string, listener: EventListener): void;
	}>;
	loadURL(url: string): Promise<void>;
	on(name: string, listener: EventListener): void;
	removeListener(name: string, listener: EventListener): void;
}

export interface FramescaperWebVcrRuntimeBrowserSession {
	clearAuthCache(): Promise<void>;
	clearCache(): Promise<void>;
	clearStorageData(): Promise<void>;
}

export function framescaperWebVcrInputEvents(
	command: Extract<WebVcrCommandV1, { readonly kind: 'pointer-input' | 'key-input' }>,
	resolution: WebVcrResolution,
): readonly Readonly<Record<string, unknown>>[] {
	const event = framescaperWebVcrInputEvent(command, resolution);
	if (command.kind === 'key-input' && command.action === 'down'
		&& [...command.key].length === 1
		&& !command.modifiers.some((value) => value === 'alt' || value === 'control' || value === 'meta')) {
		return Object.freeze([event, Object.freeze({ type: 'char', keyCode: command.key })]);
	}
	return Object.freeze([event]);
}

function framescaperWebVcrInputEvent(
	command: Extract<WebVcrCommandV1, { readonly kind: 'pointer-input' | 'key-input' }>,
	resolution: WebVcrResolution,
): Readonly<Record<string, unknown>> {
	if (command.kind === 'key-input') return Object.freeze({
		type: command.action === 'down' ? 'keyDown' : 'keyUp',
		keyCode: command.key,
		isAutoRepeat: command.repeat,
		modifiers: command.modifiers,
	});
	const viewport = framescaperWebVcrCssViewport(resolution);
	const base = {
		x: Math.round(command.x * (viewport.width - 1)),
		y: Math.round(command.y * (viewport.height - 1)),
		modifiers: command.modifiers,
	};
	if (command.action === 'wheel') return Object.freeze({
		type: 'mouseWheel', ...base, deltaX: command.deltaX, deltaY: command.deltaY,
	});
	return Object.freeze({
		type: command.action === 'down' ? 'mouseDown' : command.action === 'up' ? 'mouseUp' : 'mouseMove',
		...base,
		...(command.button === 'none' ? {} : { button: command.button }),
		...(command.action === 'down' || command.action === 'up' ? { clickCount: 1 } : {}),
	});
}

export function framescaperWebVcrCaptureSurface(resolution: WebVcrResolution) {
	return resolution === '720p' ? Object.freeze({ width: 1280, height: 720 })
		: resolution === '1080p' ? Object.freeze({ width: 1920, height: 1080 })
			: Object.freeze({ width: 3840, height: 2160 });
}

export function framescaperWebVcrCssViewport(resolution: WebVcrResolution) {
	return resolution === '720p' ? Object.freeze({ width: 1280, height: 720 })
		: Object.freeze({ width: 1920, height: 1080 });
}
