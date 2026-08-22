/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES,
	resolveExternalDisplayColorMode,
	type ExternalDisplayDescriptorV1,
} from '../src/common/editor/native-external-display.ts';
import { createHash } from 'node:crypto';

const FRAME_CHANNEL = 'framescaper:external-display:v1:frame';
const SHA256 = /^[a-f0-9]{64}$/u;
export const FRAMESCAPER_EXTERNAL_DISPLAY_MAXIMUM_FRAME_BYTES =
	NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES;

export type FramescaperExternalDisplayDynamicRange = 'sdr' | 'hdr' | 'sdr-fallback';
export type FramescaperExternalDisplayLossReason =
	| 'display-removed' | 'display-became-primary' | 'window-closed' | 'placement-unavailable';

export interface FramescaperExternalDisplayBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface FramescaperExternalDisplay extends ExternalDisplayDescriptorV1 {
	readonly bounds: FramescaperExternalDisplayBounds;
}

export interface FramescaperExternalDisplayFrame {
	readonly sequence: number;
	readonly evaluationFingerprint: string;
	readonly width: number;
	readonly height: number;
	readonly dynamicRange: 'sdr' | 'hdr';
	readonly rgbaSha256: string;
	readonly rgba: Uint8Array;
}

export interface FramescaperExternalDisplayWindowOptions {
	readonly bounds: FramescaperExternalDisplayBounds;
	readonly show: false;
	readonly frame: false;
	readonly backgroundColor: '#000000';
	readonly webPreferences: Readonly<{
		readonly sandbox: true;
		readonly contextIsolation: true;
		readonly nodeIntegration: false;
		readonly webSecurity: true;
		readonly allowRunningInsecureContent: false;
	}>;
}

export interface FramescaperExternalDisplayWindow {
	readonly load: () => Promise<void>;
	readonly show: () => void;
	readonly close: () => void;
	readonly isDestroyed: () => boolean;
	readonly setBounds: (bounds: FramescaperExternalDisplayBounds) => void;
	readonly send: (channel: string, payload: unknown) => void;
	readonly onClosed?: (listener: () => void) => void;
}

export interface FramescaperExternalDisplayControllerOptions {
	readonly platform: NodeJS.Platform;
	readonly linuxSessionType?: string;
	readonly isEnabled?: () => boolean;
	readonly createWindow: (
		options: FramescaperExternalDisplayWindowOptions,
	) => FramescaperExternalDisplayWindow;
	readonly onLoss?: (reason: FramescaperExternalDisplayLossReason) => void;
}

export interface FramescaperExternalDisplaySnapshot {
	readonly active: boolean;
	readonly displayId: string | null;
	readonly dynamicRange: FramescaperExternalDisplayDynamicRange | null;
	readonly lastSequence: number | null;
}

export function externalDisplayPlacementSupport(
	platform: NodeJS.Platform,
	linuxSessionType: string | undefined,
): Readonly<{
	readonly supported: boolean;
	readonly reason: 'native-wayland-placement-unavailable' | 'unsupported-platform' | null;
}> {
	if (platform === 'darwin' || platform === 'win32') {
		return Object.freeze({ supported: true, reason: null });
	}
	if (platform !== 'linux') {
		return Object.freeze({ supported: false, reason: 'unsupported-platform' });
	}
	const session = linuxSessionType?.toLowerCase();
	if (session === 'x11' || session === 'xwayland') {
		return Object.freeze({ supported: true, reason: null });
	}
	return Object.freeze({ supported: false, reason: 'native-wayland-placement-unavailable' });
}

/** Session-only external presentation; no display choice is ever persisted. */
export class FramescaperExternalDisplayController {
	readonly #support: ReturnType<typeof externalDisplayPlacementSupport>;
	readonly #isEnabled: () => boolean;
	readonly #createWindow: FramescaperExternalDisplayControllerOptions['createWindow'];
	readonly #onLoss: (reason: FramescaperExternalDisplayLossReason) => void;
	#window: FramescaperExternalDisplayWindow | null = null;
	#display: FramescaperExternalDisplay | null = null;
	#dynamicRange: FramescaperExternalDisplayDynamicRange | null = null;
	#lastSequence: number | null = null;
	#closing = false;

	constructor(options: FramescaperExternalDisplayControllerOptions) {
		this.#support = externalDisplayPlacementSupport(options.platform, options.linuxSessionType);
		this.#isEnabled = options.isEnabled ?? (() => false);
		this.#createWindow = options.createWindow;
		this.#onLoss = options.onLoss ?? (() => {});
	}

	async open(
		displayValue: FramescaperExternalDisplay,
		requestedDynamicRange: 'sdr' | 'hdr',
	): Promise<FramescaperExternalDisplaySnapshot> {
		if (!this.#isEnabled()) throw new Error('External display presentation is disabled.');
		if (!this.#support.supported) {
			this.#onLoss('placement-unavailable');
			throw new Error(`External display placement is unavailable: ${this.#support.reason ?? 'unknown'}.`);
		}
		const display = admitDisplay(displayValue);
		if (display.primary) throw new Error('External display presentation requires a non-primary display.');
		if (requestedDynamicRange !== 'sdr' && requestedDynamicRange !== 'hdr') {
			throw new TypeError('External display dynamic range must be explicitly SDR or HDR.');
		}
		this.stop();
		// The sink is deliberately SDR-only until a target-specific HDR surface is qualified.
		const dynamicRange = requestedDynamicRange === 'hdr' ? 'sdr-fallback' : 'sdr';
		const window = this.#createWindow(windowOptions(display.bounds));
		this.#window = window;
		this.#display = display;
		this.#dynamicRange = dynamicRange;
		this.#lastSequence = null;
		window.onClosed?.(() => {
			if (!this.#closing && this.#window === window) this.#lose('window-closed');
		});
		try {
			await window.load();
			if (this.#window !== window || window.isDestroyed()) {
				throw new Error('The external display window closed before presentation began.');
			}
			window.show();
			return this.snapshot();
		} catch (error) {
			if (this.#window === window) this.stop();
			throw error;
		}
	}

	present(frameValue: FramescaperExternalDisplayFrame): void {
		const window = this.#window;
		if (window === null || this.#display === null || this.#dynamicRange === null || window.isDestroyed()) {
			throw new Error('No external display session is active.');
		}
		const frame = admitFrame(frameValue);
		if (this.#lastSequence !== null && frame.sequence <= this.#lastSequence) {
			throw new Error('External display frame sequence numbers must be strictly increasing.');
		}
		const dynamicRange = this.#dynamicRange === 'hdr' && frame.dynamicRange === 'hdr' ? 'hdr' : 'sdr';
		this.#lastSequence = frame.sequence;
		window.send(FRAME_CHANNEL, Object.freeze({
			...frame,
			dynamicRange,
		}));
	}

	reconcileDisplays(displayValues: readonly FramescaperExternalDisplay[]): void {
		if (!Array.isArray(displayValues) || displayValues.length > 64) {
			throw new RangeError('External display reconciliation requires a bounded display list.');
		}
		if (this.#display === null || this.#window === null) return;
		const displays = displayValues.map(admitDisplay);
		const current = displays.find((display) => display.displayId === this.#display!.displayId);
		if (!current) {
			this.#lose('display-removed');
			return;
		}
		if (current.primary) {
			this.#lose('display-became-primary');
			return;
		}
		if (!sameBounds(current.bounds, this.#display.bounds)) this.#window.setBounds(current.bounds);
		if (this.#dynamicRange === 'hdr' && resolveExternalDisplayColorMode(current) !== 'hdr') {
			this.#dynamicRange = 'sdr-fallback';
		}
		this.#display = current;
	}

	stop(): void {
		const window = this.#window;
		this.#window = null;
		this.#display = null;
		this.#dynamicRange = null;
		this.#lastSequence = null;
		if (window !== null && !window.isDestroyed()) {
			this.#closing = true;
			try {
				window.close();
			} finally {
				this.#closing = false;
			}
		}
	}

	snapshot(): FramescaperExternalDisplaySnapshot {
		return Object.freeze({
			active: this.#window !== null && !this.#window.isDestroyed(),
			displayId: this.#display?.displayId ?? null,
			dynamicRange: this.#dynamicRange,
			lastSequence: this.#lastSequence,
		});
	}

	#lose(reason: FramescaperExternalDisplayLossReason): void {
		this.stop();
		this.#onLoss(reason);
	}
}

function windowOptions(bounds: FramescaperExternalDisplayBounds): FramescaperExternalDisplayWindowOptions {
	return Object.freeze({
		bounds,
		show: false,
		frame: false,
		backgroundColor: '#000000',
		webPreferences: Object.freeze({
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
		}),
	});
}

function admitDisplay(value: FramescaperExternalDisplay): FramescaperExternalDisplay {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join('|') !== [
			'displayId', 'label', 'primary', 'width', 'height',
			'hdrCapable', 'colorManaged', 'bounds',
		].sort().join('|')) {
		throw new TypeError('An external display must be an exact descriptor.');
	}
	if (typeof value.displayId !== 'string' || value.displayId.length === 0 || value.displayId.length > 128) {
		throw new TypeError('An external display requires a bounded id.');
	}
	if (typeof value.label !== 'string' || value.label.length === 0 || value.label.length > 256) {
		throw new TypeError('An external display requires a bounded label.');
	}
	for (const key of ['primary', 'hdrCapable', 'colorManaged'] as const) {
		if (typeof value[key] !== 'boolean') throw new TypeError(`An external display ${key} report must be boolean.`);
	}
	return Object.freeze({
		displayId: value.displayId,
		label: value.label,
		primary: value.primary,
		width: dimension(value.width),
		height: dimension(value.height),
		hdrCapable: value.hdrCapable,
		colorManaged: value.colorManaged,
		bounds: bounds(value.bounds),
	});
}

function admitFrame(value: FramescaperExternalDisplayFrame): FramescaperExternalDisplayFrame {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join('|') !== [
			'sequence', 'evaluationFingerprint', 'width', 'height', 'dynamicRange', 'rgbaSha256', 'rgba',
		].sort().join('|')) {
		throw new TypeError('An external display frame must be one exact evaluated RGBA frame.');
	}
	if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
		throw new RangeError('An external display frame requires a non-negative sequence number.');
	}
	if (!SHA256.test(value.evaluationFingerprint)) {
		throw new TypeError('An external display frame requires its evaluated-frame fingerprint.');
	}
	if (value.dynamicRange !== 'sdr' && value.dynamicRange !== 'hdr') {
		throw new TypeError('An evaluated external-display frame must declare SDR or HDR.');
	}
	if (!SHA256.test(value.rgbaSha256)) {
		throw new TypeError('An external display frame requires its exact RGBA digest.');
	}
	const width = dimension(value.width);
	const height = dimension(value.height);
	const byteLength = width * height * 4;
	if (!Number.isSafeInteger(byteLength) || byteLength > FRAMESCAPER_EXTERNAL_DISPLAY_MAXIMUM_FRAME_BYTES) {
		throw new RangeError('An external display RGBA frame exceeds its exact byte ceiling.');
	}
	if (!(value.rgba instanceof Uint8Array) || value.rgba.byteLength !== byteLength) {
		throw new RangeError('An external display RGBA frame does not match its geometry.');
	}
	const rgba = new Uint8Array(value.rgba);
	if (createHash('sha256').update(rgba).digest('hex') !== value.rgbaSha256) {
		throw new Error('An external display RGBA frame does not match its digest.');
	}
	return Object.freeze({
		sequence: value.sequence,
		evaluationFingerprint: value.evaluationFingerprint,
		width,
		height,
		dynamicRange: value.dynamicRange,
		rgbaSha256: value.rgbaSha256,
		rgba,
	});
}

function bounds(value: FramescaperExternalDisplayBounds): FramescaperExternalDisplayBounds {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join('|') !== ['x', 'y', 'width', 'height'].sort().join('|')) {
		throw new TypeError('External display bounds must be an exact rectangle.');
	}
	if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)) {
		throw new RangeError('External display placement coordinates must be safe integers.');
	}
	return Object.freeze({ x: value.x, y: value.y, width: dimension(value.width), height: dimension(value.height) });
}

function dimension(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 32_768) {
		throw new RangeError('External display dimensions must be bounded positive integers.');
	}
	return value as number;
}

function sameBounds(left: FramescaperExternalDisplayBounds, right: FramescaperExternalDisplayBounds): boolean {
	return left.x === right.x && left.y === right.y
		&& left.width === right.width && left.height === right.height;
}
