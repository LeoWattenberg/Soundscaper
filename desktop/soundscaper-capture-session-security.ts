/* SPDX-License-Identifier: AGPL-3.0-only */

interface PermissionDetails {
	readonly requestingUrl?: string;
	readonly securityOrigin?: string;
	readonly isMainFrame?: boolean;
	readonly mediaType?: 'audio' | 'video' | 'unknown';
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

interface DesktopCaptureSource {
	readonly id?: unknown;
	readonly name?: unknown;
}

type DisplayMediaResult = Readonly<{
	readonly video?: DesktopCaptureSource;
	readonly audio?: 'loopback';
}>;

type DisplayMediaRequestHandler = (
	request: Readonly<DisplayMediaRequest>,
	callback: (value: DisplayMediaResult) => void,
) => void;

type DownloadListener = (event: unknown, item: Readonly<{ cancel(): void }>) => void;

export interface SoundscaperCaptureSessionSecuritySession {
	setPermissionCheckHandler(value: PermissionCheckHandler | null): void;
	setPermissionRequestHandler(value: PermissionRequestHandler | null): void;
	setDisplayMediaRequestHandler(
		value: DisplayMediaRequestHandler | null,
		options?: Readonly<{ readonly useSystemPicker: boolean }>,
	): void;
	on(name: 'will-download', listener: DownloadListener): void;
	removeListener(name: 'will-download', listener: DownloadListener): void;
}

interface SoundscaperCaptureWindow {
	readonly webContents: Readonly<{
		readonly mainFrame: unknown;
		getURL(): string;
	}>;
	isDestroyed(): boolean;
	isFocused(): boolean;
}

interface SoundscaperCaptureSessionSecurityOptions {
	readonly productId: string;
	readonly trustedOrigin: string;
	readonly platform: string;
	readonly desktopCapturer: Readonly<{
		getSources(options: Readonly<{
			readonly types: readonly ['screen'];
			readonly thumbnailSize: Readonly<{ readonly width: 0; readonly height: 0 }>;
		}>): PromiseLike<readonly DesktopCaptureSource[]>;
	}>;
	readonly session: SoundscaperCaptureSessionSecuritySession;
	readonly windowFor: () => SoundscaperCaptureWindow | null;
	readonly isEditorDocumentUrl: (value: string) => boolean;
}

export interface SoundscaperCaptureSessionSecurityRegistration {
	revokeOwner(owner: object): false;
	dispose(): void;
}

/** Installs the trusted Soundscaper audio-device and Windows loopback boundary. */
export function configureSoundscaperCaptureSessionSecurityV1(
	options: SoundscaperCaptureSessionSecurityOptions,
): Readonly<SoundscaperCaptureSessionSecurityRegistration> {
	const seams = validateOptions(options);
	if (seams.productId !== 'soundscaper') {
		throw new Error('Soundscaper capture session security requires the Soundscaper product.');
	}
	let disposed = false;

	const permissionCheck: PermissionCheckHandler = (
		webContents,
		permission,
		requestingOrigin,
		details = {},
	) => {
		if (disposed || !trustedEditorPermission(
			seams, webContents, requestingOrigin, details,
		)) return false;
		if (permission === 'fullscreen') return true;
		if (permission === 'display-capture') return seams.platform === 'win32';
		if (permission === 'speaker-selection') return true;
		if (permission !== 'media'
			|| (details.securityOrigin !== undefined
				&& !sameOrigin(details.securityOrigin, seams.trustedOrigin))) return false;
		const mediaTypes = details.mediaTypes
			?? (details.mediaType === undefined ? [] : [details.mediaType]);
		return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
	};

	const permissionRequest: PermissionRequestHandler = (
		webContents,
		permission,
		callback,
		details = {},
	) => {
		callback(permissionCheck(
			webContents,
			permission,
			originForDocument(details.requestingUrl),
			details,
		));
	};

	const displayRequest: DisplayMediaRequestHandler = (request, callback) => {
		if (disposed || !trustedDisplayRequest(seams, request)) {
			respondDisplay(callback, Object.freeze({}));
			return;
		}
		let sourceRequest: PromiseLike<readonly DesktopCaptureSource[]>;
		try {
			sourceRequest = seams.desktopCapturer.getSources({
				types: ['screen'],
				thumbnailSize: { width: 0, height: 0 },
			});
		} catch {
			respondDisplay(callback, Object.freeze({}));
			return;
		}
		void Promise.resolve(sourceRequest).then((sources) => {
			if (disposed || !trustedDisplayRequest(seams, request)) {
				respondDisplay(callback, Object.freeze({}));
				return;
			}
			const video = sources.find(validSource);
			respondDisplay(callback,
				video ? Object.freeze({ video, audio: 'loopback' }) : Object.freeze({}));
		}, () => respondDisplay(callback, Object.freeze({})));
	};

	const cancelDownload: DownloadListener = (_event, item) => item.cancel();
	seams.session.setPermissionCheckHandler(permissionCheck);
	seams.session.setPermissionRequestHandler(permissionRequest);
	seams.session.setDisplayMediaRequestHandler(displayRequest, { useSystemPicker: false });
	seams.session.on('will-download', cancelDownload);

	return Object.freeze({
		revokeOwner(_owner: object): false { return false; },
		dispose(): void {
			if (disposed) return;
			disposed = true;
			seams.session.setPermissionCheckHandler(null);
			seams.session.setPermissionRequestHandler(null);
			seams.session.setDisplayMediaRequestHandler(null);
			seams.session.removeListener('will-download', cancelDownload);
		},
	});
}

function trustedEditorPermission(
	seams: SoundscaperCaptureSessionSecurityOptions,
	webContents: unknown,
	requestingOrigin: string,
	details: PermissionDetails,
): boolean {
	const window = seams.windowFor();
	return Boolean(window && !window.isDestroyed() && window.isFocused()
		&& webContents === window.webContents
		&& details.isMainFrame === true
		&& sameOrigin(requestingOrigin, seams.trustedOrigin)
		&& seams.isEditorDocumentUrl(details.requestingUrl ?? '')
		&& seams.isEditorDocumentUrl(window.webContents.getURL()));
}

function trustedDisplayRequest(
	seams: SoundscaperCaptureSessionSecurityOptions,
	request: Readonly<DisplayMediaRequest>,
): boolean {
	const window = seams.windowFor();
	return seams.platform === 'win32'
		&& Boolean(window && !window.isDestroyed() && window.isFocused()
			&& request.frame === window.webContents.mainFrame
			&& sameOrigin(request.securityOrigin, seams.trustedOrigin)
			&& seams.isEditorDocumentUrl(window.webContents.getURL())
			&& request.userGesture === true
			&& request.videoRequested === true
			&& request.audioRequested === true);
}

function sameOrigin(candidate: string | undefined, trustedOrigin: string): boolean {
	return normalizeOrigin(candidate) === normalizeOrigin(trustedOrigin);
}

function originForDocument(candidate: string | undefined): string {
	try {
		const url = new URL(String(candidate ?? ''));
		return `${url.protocol}//${url.host}`;
	} catch {
		return '';
	}
}

function normalizeOrigin(value: string | undefined): string {
	return String(value ?? '').replace(/\/+$/u, '');
}

function validSource(value: DesktopCaptureSource): boolean {
	return typeof value?.id === 'string' && value.id.length > 0
		&& typeof value.name === 'string' && value.name.length > 0;
}

function respondDisplay(
	callback: (value: DisplayMediaResult) => void,
	value: DisplayMediaResult,
): void {
	try { callback(value); } catch {
		// Navigation can destroy the requesting frame before source enumeration settles.
	}
}

function validateOptions(
	value: SoundscaperCaptureSessionSecurityOptions,
): SoundscaperCaptureSessionSecurityOptions {
	if (!value || typeof value !== 'object' || typeof value.productId !== 'string'
		|| typeof value.trustedOrigin !== 'string' || typeof value.platform !== 'string'
		|| !value.desktopCapturer || typeof value.desktopCapturer.getSources !== 'function'
		|| !value.session || typeof value.session.setPermissionCheckHandler !== 'function'
		|| typeof value.session.setPermissionRequestHandler !== 'function'
		|| typeof value.session.setDisplayMediaRequestHandler !== 'function'
		|| typeof value.session.on !== 'function' || typeof value.session.removeListener !== 'function'
		|| typeof value.windowFor !== 'function' || typeof value.isEditorDocumentUrl !== 'function') {
		throw new TypeError('Soundscaper capture session security seams are invalid.');
	}
	return value;
}
