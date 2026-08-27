/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
	createFramescaperCaptureDesktopPortV1,
} from './project-library-runtime/desktop/framescaper-capture-desktop-port.js';
import {
	configureFramescaperCaptureSessionSecurityV1,
} from './project-library-runtime/desktop/framescaper-capture-session-security.js';
import {
	registerFramescaperWebVcrDesktopV1,
} from './project-library-runtime/desktop/framescaper-web-vcr-registration.js';
import {
	FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS,
} from './framescaper-capture-main-channels.js';
import { acceptsSystemAudioRequest, selectSystemAudioStreams } from './display-capture.js';
import { isAppUrl, isEditorDocumentUrl } from './validation.js';

const CAPTURE_PRELOAD = 'framescaper-capture-sandbox-preload.cjs';

/** Composes product-specific permissions while keeping main a one-line owner. */
export function registerDesktopCaptureSecurity(options) {
	const seams = requireSeams(options);
	if (seams.productId !== 'framescaper') return registerLegacySoundscaperSecurity(seams);
	const capture = createFramescaperCaptureDesktopPortV1({
		productId: seams.productId,
		platform: seams.platform,
		systemVersion: seams.systemVersion,
		now: () => Date.now(),
		createOpaqueId: () => randomUUID().replaceAll('-', ''),
		listDesktopSources: () => seams.desktopCapturer.getSources({
			types: ['screen', 'window'],
			thumbnailSize: { width: 0, height: 0 },
			fetchWindowIcons: false,
		}),
	});
	const channels = Object.values(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS);
	const preloadId = seams.desktopSession.registerPreloadScript({
		type: 'frame',
		filePath: resolve(seams.desktopRoot, CAPTURE_PRELOAD),
	});
	let sessionSecurity = null;
	let webVcr = null;
	let disposed = false;
	try {
		const webVcrSeams = requireWebVcrSeams(seams);
		webVcr = registerFramescaperWebVcrDesktopV1({
			productId: seams.productId,
			desktopRoot: seams.desktopRoot,
			trustedAppSession: seams.desktopSession,
			enabled: seams.webVcrEnabled,
			smokeTrust: seams.webVcrSmokeTrust,
			displaySelectionMode: capture.status().selectionMode === 'system-picker'
				? 'system-picker' : 'owned-callback',
			sessionFromPartition: webVcrSeams.sessionFromPartition,
			createWindow: webVcrSeams.createWebVcrWindow,
			handle: seams.handle,
			removeHandler: seams.removeHandler,
			ownerFor: seams.ownerFor,
			currentOwnerFor: seams.currentOwnerFor,
			windowFor: seams.windowFor,
			isEditorDocumentUrl,
		});
		seams.handle(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.status, (event) => {
			focusedCaptureOwner(seams, event);
			return capture.status();
		});
		seams.handle(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.listSources, (event, generation) => (
			capture.listSources(focusedCaptureOwner(seams, event), generation)
		));
		seams.handle(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.grant, (event, request) => (
			capture.grant(focusedCaptureOwner(seams, event), request)
		));
		seams.handle(FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS.teardown, (event, generation) => (
			capture.teardown(focusedCaptureOwner(seams, event), generation)
		));
		sessionSecurity = configureFramescaperCaptureSessionSecurityV1({
			productId: seams.productId,
			trustedOrigin: seams.appOrigin,
			capture,
			webVcrCapture: webVcr.captureAuthority,
			session: seams.desktopSession,
			windowFor: seams.windowFor,
			currentOwnerFor: seams.currentOwnerFor,
			isAppUrl,
			isEditorDocumentUrl,
			...(seams.webVcrSmokeTrust && seams.observeWebVcrDisplaySecurityWitness
				? { onWebVcrDisplaySecurityWitness: seams.observeWebVcrDisplaySecurityWitness }
				: {}),
		});
	} catch (error) {
		for (const channel of channels) seams.removeHandler(channel);
		seams.desktopSession.unregisterPreloadScript(preloadId);
		webVcr?.dispose();
		capture.dispose();
		throw error;
	}
	return Object.freeze({
		revokeOwner(owner) {
			const captureRevoked = capture.revokeOwner(owner);
			const webVcrRevoked = webVcr.revokeOwner(owner);
			return captureRevoked || webVcrRevoked;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const channel of channels) seams.removeHandler(channel);
			seams.desktopSession.unregisterPreloadScript(preloadId);
			sessionSecurity.dispose();
			webVcr.dispose();
		},
	});
}

/** Renderer generations lose capture authority with their other capabilities. */
export function revokeDesktopCaptureOwner(registration, owner) {
	return registration?.revokeOwner(owner);
}

/** Capture permissions, preloads, IPC handlers and grants share one exit barrier. */
export function disposeDesktopCaptureSecurity(registration) {
	return registration?.dispose();
}

function focusedCaptureOwner(seams, event) {
	if (seams.productId !== 'framescaper') throw new Error('Capture IPC requires Framescaper.');
	const window = seams.windowFor();
	if (!window || window.isDestroyed() || !window.isFocused()
		|| event.sender !== window.webContents
		|| !event.senderFrame || event.senderFrame !== event.sender.mainFrame
		|| !isEditorDocumentUrl(event.senderFrame.url)) {
		throw new Error('Capture IPC requires the focused trusted Framescaper document.');
	}
	return seams.ownerFor(event);
}

function registerLegacySoundscaperSecurity(seams) {
	const permissionCheck = (webContents, permission, requestingOrigin, details) => {
		if (!isAppUrl(requestingOrigin || webContents?.getURL())) return false;
		if (permission === 'fullscreen') return true;
		if (permission === 'display-capture') return seams.platform === 'win32';
		if (permission !== 'media') return false;
		const mediaTypes = details?.mediaTypes || [];
		return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
	};
	const permissionRequest = (webContents, permission, callback, details) => {
		callback(permissionCheck(
			webContents,
			permission,
			details?.requestingUrl || webContents?.getURL(),
			details,
		));
	};
	seams.desktopSession.setPermissionCheckHandler(permissionCheck);
	seams.desktopSession.setPermissionRequestHandler(permissionRequest);
	if (seams.platform === 'win32') {
		seams.desktopSession.setDisplayMediaRequestHandler((request, callback) => {
			if (!acceptsSystemAudioRequest(request, { platform: seams.platform })) return callback({});
			void seams.desktopCapturer.getSources({
				types: ['screen'], thumbnailSize: { width: 0, height: 0 },
			}).then((sources) => callback(selectSystemAudioStreams(request, sources, {
				platform: seams.platform,
			}))).catch(() => callback({}));
		});
	}
	const cancelDownload = (_event, item) => item.cancel();
	seams.desktopSession.on('will-download', cancelDownload);
	let disposed = false;
	return Object.freeze({
		revokeOwner: () => false,
		dispose() {
			if (disposed) return;
			disposed = true;
			seams.desktopSession.setPermissionCheckHandler(null);
			seams.desktopSession.setPermissionRequestHandler(null);
			if (seams.platform === 'win32') seams.desktopSession.setDisplayMediaRequestHandler(null);
			seams.desktopSession.removeListener('will-download', cancelDownload);
		},
	});
}

function requireSeams(value) {
	if (!value || typeof value !== 'object') throw new TypeError('Desktop capture registration seams are required.');
	for (const [name, kind] of Object.entries({
		appOrigin: 'string', desktopRoot: 'string', platform: 'string', productId: 'string',
		systemVersion: 'string', desktopCapturer: 'object', desktopSession: 'object',
		handle: 'function', removeHandler: 'function', ownerFor: 'function',
		currentOwnerFor: 'function', windowFor: 'function',
	})) {
		if (value[name] === null || typeof value[name] !== kind) {
			throw new TypeError(`Desktop capture registration requires a ${kind} ${name} seam.`);
		}
	}
	if (value.observeWebVcrDisplaySecurityWitness !== undefined
		&& typeof value.observeWebVcrDisplaySecurityWitness !== 'function') {
		throw new TypeError('Desktop capture registration requires a function Web VCR witness seam.');
	}
	return value;
}

function requireWebVcrSeams(value) {
	if (typeof value.webVcrEnabled !== 'boolean'
		|| !Object.hasOwn(value, 'webVcrSmokeTrust')
		|| (value.webVcrSmokeTrust !== null && typeof value.webVcrSmokeTrust !== 'object')
		|| typeof value.sessionFromPartition !== 'function'
		|| typeof value.createWebVcrWindow !== 'function') {
		throw new TypeError('Desktop capture registration requires Web VCR composition seams.');
	}
	return value;
}
