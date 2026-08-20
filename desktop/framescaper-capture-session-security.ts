/* SPDX-License-Identifier: AGPL-3.0-only */

interface PermissionDetails {
	readonly requestingUrl?: string;
	readonly mediaTypes?: readonly string[];
}

type PermissionCheckHandler = (
	webContents: unknown,
	permission: string,
	requestingOrigin: string,
	details?: PermissionDetails,
) => boolean;

type PermissionRequestHandler = (
	webContents: unknown,
	permission: string,
	callback: (allowed: boolean) => void,
	details?: PermissionDetails,
) => void;

interface DisplayMediaRequest {
	readonly frame?: unknown;
	readonly securityOrigin?: string;
	readonly userGesture?: boolean;
	readonly videoRequested?: boolean;
	readonly audioRequested?: boolean;
}

type DisplayMediaResult = Readonly<{
	readonly video?: Readonly<{ readonly id: string; readonly name: string }>;
	readonly audio?: 'loopback';
}>;

type DisplayMediaRequestHandler = (
	request: Readonly<DisplayMediaRequest>,
	callback: (value: DisplayMediaResult) => void,
) => void;

type DownloadListener = (event: unknown, item: Readonly<{ cancel(): void }>) => void;

export interface FramescaperCaptureSessionSecuritySession {
	setPermissionCheckHandler(value: PermissionCheckHandler | null): void;
	setPermissionRequestHandler(value: PermissionRequestHandler | null): void;
	setDisplayMediaRequestHandler(
		value: DisplayMediaRequestHandler | null,
		options?: Readonly<{ readonly useSystemPicker: boolean }>,
	): void;
	on(name: 'will-download', listener: DownloadListener): void;
	removeListener(name: 'will-download', listener: DownloadListener): void;
}

interface CaptureAuthority {
	status(): Readonly<{ readonly selectionMode: string }>;
	allowsMedia(owner: object, mediaTypes: readonly string[]): boolean;
	allowsDisplayPermission(owner: object): boolean;
	consumeSystemPickerGrant(owner: object): boolean;
	consumeDisplayGrant(owner: object, request: Readonly<{
		readonly userGesture: boolean;
		readonly videoRequested: boolean;
		readonly audioRequested: boolean;
	}>): DisplayMediaResult | null;
	dispose(): void;
}

interface WindowReference {
	readonly webContents: Readonly<{
		readonly mainFrame: unknown;
		getURL(): string;
	}>;
	isDestroyed(): boolean;
	isFocused(): boolean;
}

interface FramescaperCaptureSessionSecurityOptions {
	readonly productId: string;
	readonly trustedOrigin: string;
	readonly capture: CaptureAuthority;
	readonly session: FramescaperCaptureSessionSecuritySession;
	readonly windowFor: () => WindowReference | null;
	readonly currentOwnerFor: (webContents: object) => object;
	readonly isAppUrl: (value: string) => boolean;
	readonly isEditorDocumentUrl: (value: string) => boolean;
}

export interface FramescaperCaptureSessionSecurityRegistration {
	dispose(): void;
}

/**
 * Installs the complete Framescaper permission and display-delivery boundary.
 * Renderer calls can only authorize Chromium-owned media; bytes never cross it.
 */
export function configureFramescaperCaptureSessionSecurityV1(
	options: FramescaperCaptureSessionSecurityOptions,
): Readonly<FramescaperCaptureSessionSecurityRegistration> {
	const seams = validateOptions(options);
	if (seams.productId !== 'framescaper') {
		throw new Error('Framescaper capture session security requires the Framescaper product.');
	}
	const session = seams.session;
	let disposed = false;

	const permissionCheck: PermissionCheckHandler = (
		webContents,
		permission,
		requestingOrigin,
		details = {},
	) => {
		if (disposed) return false;
		if (permission === 'fullscreen') {
			return trustedAppDocument(seams, webContents, details.requestingUrl, requestingOrigin);
		}
		const owner = trustedCaptureOwner(seams, webContents, details.requestingUrl, requestingOrigin);
		if (!owner) return false;
		if (permission === 'display-capture') {
			return seams.capture.status().selectionMode !== 'system-picker'
				&& seams.capture.allowsDisplayPermission(owner);
		}
		if (permission !== 'media') return false;
		return seams.capture.allowsMedia(owner, details.mediaTypes ?? []);
	};

	const permissionRequest: PermissionRequestHandler = (
		webContents,
		permission,
		callback,
		details = {},
	) => {
		const requestingUrl = details.requestingUrl ?? '';
		const requestingOrigin = originForDocument(requestingUrl);
		if (permission === 'display-capture' && !disposed
			&& seams.capture.status().selectionMode === 'system-picker') {
			const owner = trustedCaptureOwner(seams, webContents, requestingUrl, requestingOrigin);
			callback(Boolean(owner && seams.capture.consumeSystemPickerGrant(owner)));
			return;
		}
		callback(permissionCheck(webContents, permission, requestingOrigin, details));
	};

	const displayRequest: DisplayMediaRequestHandler = (request, callback) => {
		const window = trustedFocusedWindow(seams);
		if (!window || request.frame !== window.webContents.mainFrame
			|| !trustedOrigin(request.securityOrigin, seams.trustedOrigin)
			|| !seams.isEditorDocumentUrl(window.webContents.getURL())
			|| request.userGesture !== true || request.videoRequested !== true) {
			callback(Object.freeze({}));
			return;
		}
		const owner = currentOwner(seams, window.webContents);
		if (!owner) {
			callback(Object.freeze({}));
			return;
		}
		const granted = seams.capture.consumeDisplayGrant(owner, {
			userGesture: true,
			videoRequested: true,
			audioRequested: request.audioRequested === true,
		});
		callback(granted ?? Object.freeze({}));
	};

	const cancelDownload: DownloadListener = (_event, item) => item.cancel();
	session.setPermissionCheckHandler(permissionCheck);
	session.setPermissionRequestHandler(permissionRequest);
	session.setDisplayMediaRequestHandler(displayRequest, {
		useSystemPicker: seams.capture.status().selectionMode === 'system-picker',
	});
	session.on('will-download', cancelDownload);

	return Object.freeze({
		dispose(): void {
			if (disposed) return;
			disposed = true;
			session.setPermissionCheckHandler(null);
			session.setPermissionRequestHandler(null);
			session.setDisplayMediaRequestHandler(null);
			session.removeListener('will-download', cancelDownload);
			seams.capture.dispose();
		},
	});
}

function validateOptions(
	value: FramescaperCaptureSessionSecurityOptions,
): FramescaperCaptureSessionSecurityOptions {
	if (!value || typeof value !== 'object' || typeof value.productId !== 'string'
		|| typeof value.trustedOrigin !== 'string' || typeof value.capture !== 'object'
		|| typeof value.session !== 'object' || typeof value.windowFor !== 'function'
		|| typeof value.currentOwnerFor !== 'function' || typeof value.isAppUrl !== 'function'
		|| typeof value.isEditorDocumentUrl !== 'function') {
		throw new TypeError('Framescaper capture session security seams are invalid.');
	}
	return value;
}

function trustedCaptureOwner(
	seams: FramescaperCaptureSessionSecurityOptions,
	webContents: unknown,
	requestingUrl: string | undefined,
	requestingOrigin: string | undefined,
): object | null {
	const window = trustedFocusedWindow(seams);
	if (!window || webContents !== window.webContents
		|| !trustedOrigin(requestingOrigin, seams.trustedOrigin)) return null;
	const documentUrl = requestingUrl || window.webContents.getURL();
	if (!seams.isEditorDocumentUrl(documentUrl)
		|| !seams.isEditorDocumentUrl(window.webContents.getURL())) return null;
	return currentOwner(seams, window.webContents);
}

function trustedAppDocument(
	seams: FramescaperCaptureSessionSecurityOptions,
	webContents: unknown,
	requestingUrl: string | undefined,
	requestingOrigin: string | undefined,
): boolean {
	const window = seams.windowFor();
	if (!window || window.isDestroyed() || webContents !== window.webContents
		|| !trustedOrigin(requestingOrigin, seams.trustedOrigin)) return false;
	return seams.isAppUrl(requestingUrl || window.webContents.getURL());
}

function trustedFocusedWindow(
	seams: FramescaperCaptureSessionSecurityOptions,
): WindowReference | null {
	const window = seams.windowFor();
	return window && !window.isDestroyed() && window.isFocused() ? window : null;
}

function currentOwner(
	seams: FramescaperCaptureSessionSecurityOptions,
	webContents: object,
): object | null {
	try { return seams.currentOwnerFor(webContents); } catch { return null; }
}

function trustedOrigin(candidate: string | undefined, expected: string): boolean {
	return String(candidate || '').replace(/\/+$/u, '') === expected.replace(/\/+$/u, '');
}

function originForDocument(value: string): string {
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}`;
	} catch {
		return '';
	}
}
