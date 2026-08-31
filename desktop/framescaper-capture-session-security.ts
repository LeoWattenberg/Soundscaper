/* SPDX-License-Identifier: AGPL-3.0-only */

interface PermissionDetails {
	readonly requestingUrl?: string;
	readonly mediaTypes?: readonly string[];
	readonly mediaType?: 'video' | 'audio' | 'unknown';
	readonly isMainFrame?: boolean;
	readonly securityOrigin?: string;
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
	readonly video?: object;
	readonly audio?: 'loopback' | object;
	readonly enableLocalEcho?: boolean;
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
	consumeMediaGrant(owner: object, mediaTypes: readonly string[]): boolean;
	allowsDisplayPermission(owner: object): boolean;
	consumeSystemPickerGrant(owner: object): boolean;
	consumeDisplayGrant(owner: object, request: Readonly<{
		readonly userGesture: boolean;
		readonly videoRequested: boolean;
		readonly audioRequested: boolean;
	}>): DisplayMediaResult | null;
	dispose(): void;
}

interface WebVcrCaptureAuthority {
	hasPending(owner: object): boolean;
	consumeCurrent(owner: object, request: Readonly<{
		readonly userGesture: boolean;
		readonly videoRequested: boolean;
		readonly audioRequested: boolean;
	}>): DisplayMediaResult | null | undefined;
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
	readonly webVcrCapture?: WebVcrCaptureAuthority;
	readonly session: FramescaperCaptureSessionSecuritySession;
	readonly windowFor: () => WindowReference | null;
	readonly currentOwnerFor: (webContents: object) => object;
	readonly isAppUrl: (value: string) => boolean;
	readonly isEditorDocumentUrl: (value: string) => boolean;
	readonly onWebVcrDisplaySecurityWitness?: (
		value: FramescaperWebVcrDisplaySecurityWitnessV1,
	) => void;
}

export type FramescaperWebVcrDisplaySecurityWitnessV1 = Readonly<
	| {
		readonly version: 1;
		readonly stage: 'permission-check' | 'permission-request';
		readonly windowLive: boolean;
		readonly focused: boolean;
		readonly senderMatches: boolean;
		readonly originMatches: boolean;
		readonly editorDocument: boolean;
		readonly ownerAvailable: boolean;
		readonly pending: boolean;
		readonly systemPicker: boolean;
		readonly allowed: boolean;
	}
	| {
		readonly version: 1;
		readonly stage: 'display-request';
		readonly windowLive: boolean;
		readonly focused: boolean;
		readonly frameMatches: boolean;
		readonly originMatches: boolean;
		readonly editorDocument: boolean;
		readonly ownerAvailable: boolean;
		readonly userGesture: boolean;
		readonly videoRequested: boolean;
		readonly audioRequested: boolean;
		readonly pending: boolean;
		readonly systemPicker: boolean;
		readonly outcome: 'rejected-trust' | 'rejected-system-picker'
			| 'rejected-web-vcr-grant' | 'rejected-device-grant'
			| 'granted-web-vcr' | 'granted-device';
	}
>;

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
		if (permission === 'media' && details.mediaType !== undefined
			&& !trustedOrigin(details.securityOrigin, seams.trustedOrigin)) return false;
		// Electron rewrites display-video preflight to the same `video` shape as camera.
		// This check is non-consuming; the exact empty request below is the final discriminator.
		if (permission === 'media' && details.mediaType === 'video'
			&& details.mediaTypes === undefined
			&& trustedOrigin(details.securityOrigin, seams.trustedOrigin)) {
			const pending = Boolean(owner && seams.webVcrCapture?.hasPending(owner));
			const systemPicker = seams.capture.status().selectionMode === 'system-picker';
			const allowed = owner !== null && details.isMainFrame === true
				&& pending && !systemPicker;
			emitPermissionWitness(seams, 'permission-check', webContents,
				details.requestingUrl, requestingOrigin, owner, pending, systemPicker, allowed);
			return allowed;
		}
		if (permission === 'display-capture') {
			const window = seams.windowFor();
			const windowLive = Boolean(window && !window.isDestroyed());
			const focused = Boolean(windowLive && window?.isFocused());
			const senderMatches = Boolean(windowLive && webContents === window?.webContents);
			const originMatches = trustedOrigin(requestingOrigin, seams.trustedOrigin);
			const editorDocument = Boolean(windowLive && seams.isEditorDocumentUrl(
				details.requestingUrl || window!.webContents.getURL(),
			) && seams.isEditorDocumentUrl(window!.webContents.getURL()));
			const pending = Boolean(owner && seams.webVcrCapture?.hasPending(owner));
			const systemPicker = seams.capture.status().selectionMode === 'system-picker';
			const allowed = owner !== null && !systemPicker
				&& (pending || seams.capture.allowsDisplayPermission(owner));
			emitWitness(seams, Object.freeze({
				version: 1, stage: 'permission-check', windowLive, focused, senderMatches,
				originMatches, editorDocument, ownerAvailable: owner !== null, pending, systemPicker, allowed,
			}));
			return allowed;
		}
		if (!owner) return false;
		if (permission !== 'media') return false;
		const mediaTypes = details.mediaTypes
			?? (details.mediaType === 'audio' || details.mediaType === 'video'
				? [details.mediaType] : []);
		return mediaTypes.length > 0 && seams.capture.allowsMedia(owner, mediaTypes);
	};

	const permissionRequest: PermissionRequestHandler = (
		webContents,
		permission,
		callback,
		details = {},
	) => {
		const requestingUrl = details.requestingUrl ?? '';
		const requestingOrigin = originForDocument(requestingUrl);
		if (permission === 'display-capture') {
			const window = seams.windowFor();
			const windowLive = Boolean(window && !window.isDestroyed());
			const focused = Boolean(windowLive && window?.isFocused());
			const senderMatches = Boolean(windowLive && webContents === window?.webContents);
			const originMatches = trustedOrigin(requestingOrigin, seams.trustedOrigin);
			const editorDocument = Boolean(windowLive && seams.isEditorDocumentUrl(
				requestingUrl || window!.webContents.getURL(),
			) && seams.isEditorDocumentUrl(window!.webContents.getURL()));
			const owner = disposed ? null
				: trustedCaptureOwner(seams, webContents, requestingUrl, requestingOrigin);
			const pending = Boolean(owner && seams.webVcrCapture?.hasPending(owner));
			const systemPicker = seams.capture.status().selectionMode === 'system-picker';
			const allowed = !owner ? false
				: systemPicker
					? !pending && seams.capture.consumeSystemPickerGrant(owner)
					: pending || seams.capture.allowsDisplayPermission(owner);
			emitWitness(seams, Object.freeze({
				version: 1, stage: 'permission-request', windowLive, focused, senderMatches,
				originMatches, editorDocument, ownerAvailable: owner !== null, pending,
				systemPicker, allowed,
			}));
			callback(allowed);
			return;
		}
		if (permission === 'media' && !disposed) {
			const owner = trustedCaptureOwner(seams, webContents, requestingUrl, requestingOrigin);
			const mediaTypes = details.mediaTypes;
			if (Array.isArray(mediaTypes) && mediaTypes.length === 0) {
				const pending = Boolean(owner && seams.webVcrCapture?.hasPending(owner));
				const systemPicker = seams.capture.status().selectionMode === 'system-picker';
				const allowed = owner !== null && details.isMainFrame === true
					&& trustedOrigin(details.securityOrigin, seams.trustedOrigin)
					&& pending && !systemPicker;
				emitPermissionWitness(seams, 'permission-request', webContents,
					requestingUrl, requestingOrigin, owner, pending, systemPicker, allowed);
				callback(allowed);
				return;
			}
			callback(Boolean(owner && mediaTypes && mediaTypes.length > 0
				&& seams.capture.consumeMediaGrant(owner, mediaTypes)));
			return;
		}
		callback(permissionCheck(webContents, permission, requestingOrigin, details));
	};

	const displayRequest: DisplayMediaRequestHandler = (request, callback) => {
		const window = seams.windowFor();
		const windowLive = Boolean(window && !window.isDestroyed());
		const focused = Boolean(windowLive && window?.isFocused());
		const frameMatches = Boolean(windowLive && request.frame === window?.webContents.mainFrame);
		const originMatches = trustedOrigin(request.securityOrigin, seams.trustedOrigin);
		const editorDocument = Boolean(windowLive
			&& seams.isEditorDocumentUrl(window!.webContents.getURL()));
		const userGesture = request.userGesture === true;
		const videoRequested = request.videoRequested === true;
		const audioRequested = request.audioRequested === true;
		const systemPicker = seams.capture.status().selectionMode === 'system-picker';
		if (disposed || !windowLive || !focused || !frameMatches || !originMatches
			|| !editorDocument || !userGesture || !videoRequested) {
			emitDisplayWitness(seams, {
				windowLive, focused, frameMatches, originMatches, editorDocument,
				userGesture, videoRequested, audioRequested, owner: null, pending: false,
				systemPicker, outcome: 'rejected-trust',
			});
			callback(Object.freeze({}));
			return;
		}
		const owner = currentOwner(seams, window!.webContents);
		if (!owner) {
			emitDisplayWitness(seams, {
				windowLive, focused, frameMatches, originMatches, editorDocument,
				userGesture, videoRequested, audioRequested, owner: null, pending: false,
				systemPicker, outcome: 'rejected-trust',
			});
			callback(Object.freeze({}));
			return;
		}
		const admittedRequest = {
			userGesture: true,
			videoRequested: true,
			audioRequested,
		};
		const webVcrCapture = seams.webVcrCapture;
		const pending = Boolean(webVcrCapture?.hasPending(owner));
		if (pending && webVcrCapture) {
			if (systemPicker) {
				emitDisplayWitness(seams, {
					windowLive, focused, frameMatches, originMatches, editorDocument,
					userGesture, videoRequested, audioRequested, owner, pending, systemPicker,
					outcome: 'rejected-system-picker',
				});
				callback(Object.freeze({}));
				return;
			}
			const granted = webVcrCapture.consumeCurrent(owner, admittedRequest);
			emitDisplayWitness(seams, {
				windowLive, focused, frameMatches, originMatches, editorDocument,
				userGesture, videoRequested, audioRequested, owner, pending, systemPicker,
				outcome: granted ? 'granted-web-vcr' : 'rejected-web-vcr-grant',
			});
			callback(granted ?? Object.freeze({}));
			return;
		}
		const granted = seams.capture.consumeDisplayGrant(owner, admittedRequest);
		emitDisplayWitness(seams, {
			windowLive, focused, frameMatches, originMatches, editorDocument,
			userGesture, videoRequested, audioRequested, owner, pending, systemPicker,
			outcome: granted ? 'granted-device' : 'rejected-device-grant',
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
			seams.webVcrCapture?.dispose();
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
		|| typeof value.isEditorDocumentUrl !== 'function'
		|| (value.onWebVcrDisplaySecurityWitness !== undefined
			&& typeof value.onWebVcrDisplaySecurityWitness !== 'function')) {
		throw new TypeError('Framescaper capture session security seams are invalid.');
	}
	if (value.webVcrCapture !== undefined && (!value.webVcrCapture
		|| typeof value.webVcrCapture.hasPending !== 'function'
		|| typeof value.webVcrCapture.consumeCurrent !== 'function'
		|| typeof value.webVcrCapture.dispose !== 'function')) {
		throw new TypeError('Framescaper Web VCR capture security seam is invalid.');
	}
	return value;
}

function emitDisplayWitness(
	seams: FramescaperCaptureSessionSecurityOptions,
	value: Readonly<{
		readonly windowLive: boolean;
		readonly focused: boolean;
		readonly frameMatches: boolean;
		readonly originMatches: boolean;
		readonly editorDocument: boolean;
		readonly userGesture: boolean;
		readonly videoRequested: boolean;
		readonly audioRequested: boolean;
		readonly owner: object | null;
		readonly pending: boolean;
		readonly systemPicker: boolean;
		readonly outcome: Extract<FramescaperWebVcrDisplaySecurityWitnessV1,
			{ readonly stage: 'display-request' }>['outcome'];
	}>,
): void {
	emitWitness(seams, Object.freeze({
		version: 1,
		stage: 'display-request',
		windowLive: value.windowLive,
		focused: value.focused,
		frameMatches: value.frameMatches,
		originMatches: value.originMatches,
		editorDocument: value.editorDocument,
		ownerAvailable: value.owner !== null,
		userGesture: value.userGesture,
		videoRequested: value.videoRequested,
		audioRequested: value.audioRequested,
		pending: value.pending,
		systemPicker: value.systemPicker,
		outcome: value.outcome,
	}));
}

function emitPermissionWitness(
	seams: FramescaperCaptureSessionSecurityOptions,
	stage: 'permission-check' | 'permission-request',
	webContents: unknown,
	requestingUrl: string | undefined,
	requestingOrigin: string,
	owner: object | null,
	pending: boolean,
	systemPicker: boolean,
	allowed: boolean,
): void {
	const window = seams.windowFor();
	const windowLive = Boolean(window && !window.isDestroyed());
	const focused = Boolean(windowLive && window?.isFocused());
	const senderMatches = Boolean(windowLive && webContents === window?.webContents);
	const originMatches = trustedOrigin(requestingOrigin, seams.trustedOrigin);
	const editorDocument = Boolean(windowLive && seams.isEditorDocumentUrl(
		requestingUrl || window!.webContents.getURL(),
	) && seams.isEditorDocumentUrl(window!.webContents.getURL()));
	emitWitness(seams, Object.freeze({
		version: 1, stage, windowLive, focused, senderMatches, originMatches,
		editorDocument, ownerAvailable: owner !== null, pending, systemPicker, allowed,
	}));
}

function emitWitness(
	seams: FramescaperCaptureSessionSecurityOptions,
	value: FramescaperWebVcrDisplaySecurityWitnessV1,
): void {
	try { seams.onWebVcrDisplaySecurityWitness?.(value); } catch {
		// Packaged diagnostic observation can never alter capture admission.
	}
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
