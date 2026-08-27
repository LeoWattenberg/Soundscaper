/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { WebVcrSnapshot } from './framescaper-web-vcr-contract.ts';
import type { FramescaperWebVcrElectronWindow } from './framescaper-web-vcr-electron-window.ts';
import {
	configureFramescaperWebVcrGuestSecurityV1,
	configureFramescaperWebVcrSmokeCertificateTrustV1,
	validateFramescaperWebVcrSmokeCertificateV1,
	type FramescaperWebVcrGuestSecurityRegistrationV1,
	type FramescaperWebVcrGuestSecuritySession,
	type FramescaperWebVcrSmokeCertificateV1,
} from './framescaper-web-vcr-guest-security.ts';
import { FRAMESCAPER_WEB_VCR_PARTITION } from './framescaper-web-vcr-host.ts';
import { FRAMESCAPER_WEB_VCR_CHANNELS } from './framescaper-web-vcr-main-channels.ts';
import { registerFramescaperWebVcrTrustedPreloadV1 } from './framescaper-web-vcr-preload-registration.ts';
import {
	createFramescaperWebVcrRuntimeV1,
	type FramescaperWebVcrRuntimeV1,
} from './framescaper-web-vcr-runtime.ts';

const TRUSTED_PRELOAD = 'framescaper-web-vcr-sandbox-preload.cjs';
const HANDLER_CHANNELS = Object.freeze([
	FRAMESCAPER_WEB_VCR_CHANNELS.handshake,
	FRAMESCAPER_WEB_VCR_CHANNELS.open,
	FRAMESCAPER_WEB_VCR_CHANNELS.dispatch,
	FRAMESCAPER_WEB_VCR_CHANNELS.prepareCapture,
	FRAMESCAPER_WEB_VCR_CHANNELS.setCaptureState,
	FRAMESCAPER_WEB_VCR_CHANNELS.dispose,
]);

interface IpcEvent {
	readonly sender: object;
	readonly senderFrame: Readonly<{ readonly url: string }> | null;
}

interface TrustedWindow {
	readonly webContents: Readonly<{
		readonly mainFrame: object;
		getURL(): string;
		send(channel: string, value: unknown): void;
	}>;
	isDestroyed(): boolean;
	isFocused(): boolean;
}

interface GuestSession extends FramescaperWebVcrGuestSecuritySession {
	clearAuthCache(): Promise<void>;
	clearCache(): Promise<void>;
	clearStorageData(): Promise<void>;
}

export interface FramescaperWebVcrSmokeTrustV1 {
	readonly kind: 'packaged-smoke-v1';
	readonly certificate: FramescaperWebVcrSmokeCertificateV1;
}

interface RegistrationOptions {
	readonly productId: string;
	readonly desktopRoot: string;
	readonly trustedAppSession: Readonly<{
		registerPreloadScript(value: Readonly<{ readonly type: 'frame'; readonly filePath: string }>): string;
		unregisterPreloadScript(id: string): void;
	}>;
	readonly enabled: boolean;
	readonly smokeTrust: FramescaperWebVcrSmokeTrustV1 | null;
	readonly displaySelectionMode: 'owned-callback' | 'system-picker';
	readonly sessionFromPartition: (partition: string) => GuestSession;
	readonly createWindow: (options: unknown) => FramescaperWebVcrElectronWindow;
	readonly handle: (channel: string, listener: (event: IpcEvent, value?: unknown) => unknown) => void;
	readonly removeHandler: (channel: string) => void;
	readonly ownerFor: (event: IpcEvent) => object;
	readonly currentOwnerFor: (webContents: object) => object;
	readonly windowFor: () => TrustedWindow | null;
	readonly isEditorDocumentUrl: (value: string) => boolean;
	readonly now?: () => number;
	readonly createOpaqueId?: () => string;
}

export interface FramescaperWebVcrRegistrationV1 {
	readonly captureAuthority: FramescaperWebVcrRuntimeV1['captureAuthority'];
	revokeOwner(owner: object): boolean;
	dispose(): void;
}

/** Registers the trusted API while deferring all guest-partition state until an admitted open. */
export function registerFramescaperWebVcrDesktopV1(
	value: RegistrationOptions,
): Readonly<FramescaperWebVcrRegistrationV1> {
	const seams = registrationOptions(value);
	const smokeTrust = validateSmokeTrust(seams.smokeTrust);
	const preload = registerFramescaperWebVcrTrustedPreloadV1({
		productId: seams.productId,
		preloadPath: resolve(seams.desktopRoot, TRUSTED_PRELOAD),
		trustedAppSession: seams.trustedAppSession,
	});
	let guestSession: GuestSession | null = null;
	let guestSecurity: Readonly<FramescaperWebVcrGuestSecurityRegistrationV1> | null = null;
	let certificateTrust: Readonly<FramescaperWebVcrGuestSecurityRegistrationV1> | null = null;
	let disposed = false;

	const runtime = createFramescaperWebVcrRuntimeV1({
		productId: seams.productId,
		enabled: seams.enabled && seams.displaySelectionMode === 'owned-callback',
		unavailableReason: seams.enabled && seams.displaySelectionMode === 'system-picker'
			? 'unsupported-platform' : 'roadmap-gate',
		now: seams.now ?? (() => Date.now()),
		createOpaqueId: seams.createOpaqueId ?? defaultOpaqueId,
		createWindow: (options) => {
			materializeGuestSession();
			return seams.createWindow(options);
		},
		browserSession: {
			clearAuthCache: () => materializeGuestSession().clearAuthCache(),
			clearCache: () => materializeGuestSession().clearCache(),
			clearStorageData: () => materializeGuestSession().clearStorageData(),
		},
		emitSnapshot,
	});

	try {
		seams.handle(FRAMESCAPER_WEB_VCR_CHANNELS.handshake, (event) => {
			trustedOwner(event, false);
			return runtime.handshake();
		});
		seams.handle(FRAMESCAPER_WEB_VCR_CHANNELS.open, (event, request) => (
			runtime.open(trustedOwner(event, true), request)
		));
		seams.handle(FRAMESCAPER_WEB_VCR_CHANNELS.dispatch, (event, command) => (
			runtime.dispatch(trustedOwner(event, true), command)
		));
		seams.handle(FRAMESCAPER_WEB_VCR_CHANNELS.prepareCapture, (event, reference) => (
			runtime.prepareCapture(trustedOwner(event, true), reference)
		));
		seams.handle(FRAMESCAPER_WEB_VCR_CHANNELS.setCaptureState, (event, request) => (
			runtime.setCaptureState(trustedOwner(event, false), request)
		));
		seams.handle(FRAMESCAPER_WEB_VCR_CHANNELS.dispose, (event, reference) => (
			runtime.disposeSession(trustedOwner(event, false), reference)
		));
	} catch (error) {
		cleanup();
		throw error;
	}

	return Object.freeze({
		captureAuthority: runtime.captureAuthority,
		revokeOwner: (owner: object) => runtime.revokeOwner(owner),
		dispose: cleanup,
	});

	function trustedOwner(event: IpcEvent, requireFocus: boolean): object {
		const window = seams.windowFor();
		if (disposed || !window || window.isDestroyed() || (requireFocus && !window.isFocused())
			|| event.sender !== window.webContents || !event.senderFrame
			|| event.senderFrame !== window.webContents.mainFrame
			|| !seams.isEditorDocumentUrl(event.senderFrame.url)
			|| !seams.isEditorDocumentUrl(window.webContents.getURL())) {
			throw new Error('Web VCR IPC requires the current trusted Framescaper document.');
		}
		return reference(seams.ownerFor(event), 'Web VCR renderer owner');
	}

	function emitSnapshot(owner: object, snapshot: Readonly<WebVcrSnapshot>): void {
		const window = seams.windowFor();
		if (disposed || !window || window.isDestroyed()) return;
		try {
			if (seams.currentOwnerFor(window.webContents) !== owner) return;
		} catch { return; }
		window.webContents.send(FRAMESCAPER_WEB_VCR_CHANNELS.snapshot, snapshot);
	}

	function materializeGuestSession(): GuestSession {
		if (guestSession) return guestSession;
		if (!seams.enabled || seams.displaySelectionMode !== 'owned-callback') {
			throw new Error('Web VCR guest is disabled.');
		}
		const session = seams.sessionFromPartition(FRAMESCAPER_WEB_VCR_PARTITION);
		const security = configureFramescaperWebVcrGuestSecurityV1(session);
		try {
			const certificate = smokeTrust
				? configureFramescaperWebVcrSmokeCertificateTrustV1(session, smokeTrust.certificate)
				: null;
			guestSession = session;
			guestSecurity = security;
			certificateTrust = certificate;
			return session;
		} catch (error) {
			security.dispose();
			throw error;
		}
	}

	function cleanup(): void {
		if (disposed) return;
		disposed = true;
		for (const channel of HANDLER_CHANNELS) seams.removeHandler(channel);
		runtime.dispose();
		certificateTrust?.dispose();
		guestSecurity?.dispose();
		preload.dispose();
		guestSession = null;
	}
}

function registrationOptions(value: RegistrationOptions): RegistrationOptions {
	if (!value || typeof value !== 'object' || value.productId !== 'framescaper'
		|| typeof value.desktopRoot !== 'string' || !value.desktopRoot
		|| typeof value.enabled !== 'boolean'
		|| !['owned-callback', 'system-picker'].includes(value.displaySelectionMode)
		|| !value.trustedAppSession || typeof value.trustedAppSession.registerPreloadScript !== 'function'
		|| typeof value.trustedAppSession.unregisterPreloadScript !== 'function'
		|| typeof value.sessionFromPartition !== 'function' || typeof value.createWindow !== 'function'
		|| typeof value.handle !== 'function' || typeof value.removeHandler !== 'function'
		|| typeof value.ownerFor !== 'function' || typeof value.currentOwnerFor !== 'function'
		|| typeof value.windowFor !== 'function' || typeof value.isEditorDocumentUrl !== 'function'
		|| (value.now !== undefined && typeof value.now !== 'function')
		|| (value.createOpaqueId !== undefined && typeof value.createOpaqueId !== 'function')) {
		throw new TypeError('Web VCR desktop registration seams are invalid.');
	}
	return value;
}

function validateSmokeTrust(
	value: FramescaperWebVcrSmokeTrustV1 | null,
): Readonly<FramescaperWebVcrSmokeTrustV1> | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || value.kind !== 'packaged-smoke-v1'
		|| Reflect.ownKeys(value).length !== 2) {
		throw new TypeError('Web VCR smoke trust must use the dedicated packaged-smoke shape.');
	}
	return Object.freeze({
		kind: 'packaged-smoke-v1',
		certificate: validateFramescaperWebVcrSmokeCertificateV1(value.certificate),
	});
}

function defaultOpaqueId(): string {
	return randomUUID().replaceAll('-', '');
}

function reference(value: unknown, label: string): object {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new TypeError(`${label} is invalid.`);
	return value;
}
