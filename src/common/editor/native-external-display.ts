/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which display the clean programme output may open on, and what happens to it.
 *
 * The surface consumes the editor's own evaluated frame stream and transport
 * clock; it is a second *window*, not a second render engine. Audio is
 * untouched and keeps going to the existing selected mix device, because a
 * separate output route is a mixing decision the user did not make by opening a
 * monitor window.
 *
 * The selection is session-only and is never written into a project. A project
 * carrying "open full screen on display 2" would do something surprising on the
 * next machine, which may have one display, three, or a projector.
 *
 * Native Wayland reports unavailable rather than approximating. The protocol
 * gives a client no dependable way to place a window on a chosen output, so
 * "full screen on the display you picked" cannot be honoured; claiming it and
 * landing on the wrong screen mid-session is worse than saying so up front.
 * Linux coverage therefore runs under X11 and XWayland.
 *
 * HDR is claimed only when the display reports both HDR capability and colour
 * management. A surface that says HDR while the compositor is quietly tone
 * mapping is a grading monitor that lies.
 */

import { createNativeValidators } from './native-validation.ts';

export const NATIVE_EXTERNAL_DISPLAY_WINDOWING_SYSTEMS = Object.freeze([
	'windows', 'macos', 'x11', 'wayland',
] as const);

export type NativeExternalDisplayWindowingSystem =
	(typeof NATIVE_EXTERNAL_DISPLAY_WINDOWING_SYSTEMS)[number];

/** One UHD RGBA frame fits; transfer still uses independently bounded 16 MiB chunks. */
export const NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES = 64 * 1024 * 1024;

export const NATIVE_EXTERNAL_DISPLAY_REFUSALS = Object.freeze([
	'native-wayland-placement-unavailable',
	'display-unknown',
	'display-is-primary',
	'already-open',
] as const);

export type NativeExternalDisplayRefusal = (typeof NATIVE_EXTERNAL_DISPLAY_REFUSALS)[number];

export const NATIVE_EXTERNAL_DISPLAY_CLOSE_REASONS = Object.freeze([
	'menu-command',
	'escape-key',
	'display-removed',
	'display-became-primary',
	'shutdown',
] as const);

export type NativeExternalDisplayCloseReason =
	(typeof NATIVE_EXTERNAL_DISPLAY_CLOSE_REASONS)[number];

/**
 * Only a display that went away is a loss the user should be told about. A
 * display the user re-designated as primary is still there and still working;
 * telling them it was disconnected describes something that did not happen.
 */
const CLOSE_REASON_REPORTS_LOSS: Readonly<Record<NativeExternalDisplayCloseReason, boolean>> =
	Object.freeze({
		'menu-command': false,
		'escape-key': false,
		'display-removed': true,
		'display-became-primary': false,
		shutdown: false,
	});

export type NativeExternalDisplayColorMode = 'hdr' | 'sdr';

export interface ExternalDisplayDescriptorV1 {
	readonly displayId: string;
	readonly label: string;
	readonly primary: boolean;
	readonly width: number;
	readonly height: number;
	readonly hdrCapable: boolean;
	readonly colorManaged: boolean;
}

export interface ExternalDisplaySessionV1 {
	readonly displayId: string;
	readonly colorMode: NativeExternalDisplayColorMode;
	readonly openedAtMs: number;
}

export interface ExternalDisplayClosureV1 {
	readonly displayId: string;
	readonly reason: NativeExternalDisplayCloseReason;
	readonly atMs: number;
	/** True when the display itself went away, not merely stopped qualifying. */
	readonly reportsLoss: boolean;
}

export interface ExternalDisplaySessionStoreV1 {
	open(
		descriptor: ExternalDisplayDescriptorV1,
		atMs: number,
	): ExternalDisplaySessionV1;
	close(reason: NativeExternalDisplayCloseReason, atMs: number): ExternalDisplayClosureV1 | null;
	/** Reconcile against the current display set; a display that stops qualifying closes. */
	observeDisplays(
		displays: readonly ExternalDisplayDescriptorV1[],
		atMs: number,
	): ExternalDisplayClosureV1 | null;
	snapshot(): ExternalDisplaySessionV1 | null;
}

export class NativeExternalDisplayError extends Error {
	readonly refusal: NativeExternalDisplayRefusal;

	constructor(refusal: NativeExternalDisplayRefusal, message: string) {
		super(message);
		this.name = 'NativeExternalDisplayError';
		this.refusal = refusal;
	}
}

// A malformed timestamp is a caller bug rather than one of the refusals the
// menu explains, so it stays a RangeError and never gains a refusal code.
const { nonNegativeInteger } = createNativeValidators({
	subject: 'A clean programme output',
	raise: (message: string): never => {
		throw new RangeError(message);
	},
});

/**
 * The displays the menu may offer. The primary display is excluded because the
 * editor already lives there, and native Wayland offers nothing at all.
 */
export function listSelectableExternalDisplays(
	displays: readonly ExternalDisplayDescriptorV1[],
	windowingSystem: NativeExternalDisplayWindowingSystem,
): readonly ExternalDisplayDescriptorV1[] {
	if (windowingSystem === 'wayland') return Object.freeze([]);
	return Object.freeze(displays.filter((display) => !display.primary));
}

/** A surface claims HDR only when the display is both capable and managed. */
export function resolveExternalDisplayColorMode(
	descriptor: ExternalDisplayDescriptorV1,
): NativeExternalDisplayColorMode {
	return descriptor.hdrCapable && descriptor.colorManaged ? 'hdr' : 'sdr';
}

/** Audio never moves; the programme window is a video surface only. */
export const NATIVE_EXTERNAL_DISPLAY_AUDIO_ROUTE = 'existing-selected-mix-device';

/** The selection is session state; nothing about it is ever persisted. */
export const NATIVE_EXTERNAL_DISPLAY_PERSISTENCE = 'session-only';

export function createExternalDisplaySessionStore(
	windowingSystem: NativeExternalDisplayWindowingSystem,
): ExternalDisplaySessionStoreV1 {
	assertWindowingSystem(windowingSystem);
	let session: ExternalDisplaySessionV1 | null = null;

	return Object.freeze({
		open(descriptor: ExternalDisplayDescriptorV1, atMs: number): ExternalDisplaySessionV1 {
			if (windowingSystem === 'wayland') {
				throw new NativeExternalDisplayError(
					'native-wayland-placement-unavailable',
					'Native Wayland gives no dependable way to place a window on a chosen output.',
				);
			}
			if (descriptor.primary) {
				throw new NativeExternalDisplayError(
					'display-is-primary',
					'The clean programme output opens on a non-primary display.',
				);
			}
			if (session !== null) {
				throw new NativeExternalDisplayError(
					'already-open',
					'The clean programme output is already open; close it before opening another.',
				);
			}
			session = Object.freeze({
				displayId: displayId(descriptor.displayId),
				colorMode: resolveExternalDisplayColorMode(descriptor),
				openedAtMs: nonNegativeInteger(atMs, 'openedAtMs'),
			});
			return session;
		},
		close(
			reason: NativeExternalDisplayCloseReason,
			atMs: number,
		): ExternalDisplayClosureV1 | null {
			if (session === null) return null;
			if (!(NATIVE_EXTERNAL_DISPLAY_CLOSE_REASONS as readonly string[]).includes(reason)) {
				throw new RangeError('A clean programme output closes for a known reason.');
			}
			const closure = Object.freeze({
				displayId: session.displayId,
				reason,
				atMs: nonNegativeInteger(atMs, 'atMs'),
				reportsLoss: CLOSE_REASON_REPORTS_LOSS[reason],
			});
			session = null;
			return closure;
		},
		observeDisplays(
			displays: readonly ExternalDisplayDescriptorV1[],
			atMs: number,
		): ExternalDisplayClosureV1 | null {
			if (session === null) return null;
			const current = displays.find((display) => display.displayId === session?.displayId);
			if (current && !current.primary) return null;
			return this.close(current ? 'display-became-primary' : 'display-removed', atMs);
		},
		snapshot(): ExternalDisplaySessionV1 | null {
			return session;
		},
	});
}

/**
 * A session is never restored. This exists so the restart path has one obvious
 * place to call and one obvious answer, rather than an omission that later
 * looks like a bug.
 */
export function restoreExternalDisplaySession(): null {
	return null;
}

function assertWindowingSystem(value: unknown): void {
	if (typeof value !== 'string'
		|| !(NATIVE_EXTERNAL_DISPLAY_WINDOWING_SYSTEMS as readonly string[]).includes(value)) {
		throw new RangeError('A clean programme output needs a known windowing system.');
	}
}

function displayId(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
		throw new NativeExternalDisplayError('display-unknown', 'A display id must be bounded text.');
	}
	return value;
}
