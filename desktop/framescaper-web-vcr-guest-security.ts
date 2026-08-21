/* SPDX-License-Identifier: AGPL-3.0-only */

import { X509Certificate } from 'node:crypto';

import {
	cancelFramescaperWebVcrDownload,
} from './framescaper-web-vcr-security-policy.ts';

type PermissionCheck = (
	webContents: unknown,
	permission: string,
	requestingOrigin: string,
	details: unknown,
) => boolean;
type PermissionRequest = (
	webContents: unknown,
	permission: string,
	callback: (allowed: boolean) => void,
	details: unknown,
) => void;
type DevicePermission = (details: unknown) => boolean;
type DownloadListener = (
	event: Readonly<{ preventDefault(): void }>,
	item: Readonly<{ cancel(): void }>,
) => void;
type CertificateVerify = (
	request: Readonly<{
		readonly hostname?: string;
		readonly certificate?: Readonly<{ readonly data?: string; readonly fingerprint?: string }>;
	}>,
	callback: (result: number) => void,
) => void;

export interface FramescaperWebVcrGuestSecuritySession {
	setPermissionCheckHandler(value: PermissionCheck | null): void;
	setPermissionRequestHandler(value: PermissionRequest | null): void;
	setDevicePermissionHandler(value: DevicePermission | null): void;
	setCertificateVerifyProc(value: CertificateVerify | null): void;
	on(name: 'will-download', listener: DownloadListener): void;
	removeListener(name: 'will-download', listener: DownloadListener): void;
}

export interface FramescaperWebVcrGuestSecurityRegistrationV1 {
	dispose(): void;
}

export interface FramescaperWebVcrSmokeCertificateV1 {
	readonly enabled: true;
	readonly origin: string;
	readonly fingerprint: string;
}

export function validateFramescaperWebVcrSmokeCertificateV1(
	value: FramescaperWebVcrSmokeCertificateV1,
): Readonly<FramescaperWebVcrSmokeCertificateV1> {
	smokeCertificate(value);
	return Object.freeze({ enabled: true, origin: value.origin, fingerprint: value.fingerprint });
}

/** Installs the complete deny-by-default boundary on the dedicated remote partition. */
export function configureFramescaperWebVcrGuestSecurityV1(
	session: FramescaperWebVcrGuestSecuritySession,
): Readonly<FramescaperWebVcrGuestSecurityRegistrationV1> {
	const value = guestSession(session);
	const denyCheck: PermissionCheck = () => false;
	const denyRequest: PermissionRequest = (_webContents, _permission, callback) => callback(false);
	const denyDevice: DevicePermission = () => false;
	const denyDownload: DownloadListener = (event, item) => cancelFramescaperWebVcrDownload(event, item);
	value.setPermissionCheckHandler(denyCheck);
	value.setPermissionRequestHandler(denyRequest);
	value.setDevicePermissionHandler(denyDevice);
	value.on('will-download', denyDownload);
	let disposed = false;
	return Object.freeze({
		dispose(): void {
			if (disposed) return;
			disposed = true;
			value.setPermissionCheckHandler(null);
			value.setPermissionRequestHandler(null);
			value.setDevicePermissionHandler(null);
			value.removeListener('will-download', denyDownload);
		},
	});
}

/**
 * Optional packaged-smoke seam. It is scoped to the guest partition and trusts
 * only one explicitly configured loopback hostname and certificate fingerprint.
 */
export function configureFramescaperWebVcrSmokeCertificateTrustV1(
	session: FramescaperWebVcrGuestSecuritySession,
	configuration: FramescaperWebVcrSmokeCertificateV1 | null | undefined,
): Readonly<FramescaperWebVcrGuestSecurityRegistrationV1> {
	const value = guestSession(session);
	if (configuration === null || configuration === undefined) {
		return Object.freeze({ dispose: () => undefined });
	}
	const admitted = validateFramescaperWebVcrSmokeCertificateV1(configuration);
	const policy = smokeCertificate(admitted);
	const verify: CertificateVerify = (request, callback) => {
		callback(request.hostname === policy.hostname
			&& certificateFingerprint(request.certificate?.data) === policy.fingerprint ? 0 : -3);
	};
	value.setCertificateVerifyProc(verify);
	let disposed = false;
	return Object.freeze({
		dispose(): void {
			if (disposed) return;
			disposed = true;
			value.setCertificateVerifyProc(null);
		},
	});
}

function guestSession(value: FramescaperWebVcrGuestSecuritySession): FramescaperWebVcrGuestSecuritySession {
	if (!value || typeof value !== 'object' || typeof value.setPermissionCheckHandler !== 'function'
		|| typeof value.setPermissionRequestHandler !== 'function'
		|| typeof value.setDevicePermissionHandler !== 'function'
		|| typeof value.setCertificateVerifyProc !== 'function'
		|| typeof value.on !== 'function' || typeof value.removeListener !== 'function') {
		throw new TypeError('Web VCR guest security session seam is invalid.');
	}
	return value;
}

function smokeCertificate(value: FramescaperWebVcrSmokeCertificateV1): Readonly<{
	readonly hostname: string;
	readonly fingerprint: string;
}> {
	if (!value || typeof value !== 'object' || value.enabled !== true
		|| typeof value.origin !== 'string' || typeof value.fingerprint !== 'string'
		|| !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u.test(value.fingerprint)) {
		throw new TypeError('Web VCR smoke certificate configuration is invalid.');
	}
	let origin: URL;
	try {
		origin = new URL(value.origin);
	} catch {
		throw new TypeError('Web VCR smoke certificate origin is invalid.');
	}
	if (origin.protocol !== 'https:') throw new TypeError('Web VCR smoke certificate requires HTTPS.');
	if (!['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)) {
		throw new TypeError('Web VCR smoke certificate requires an exact loopback host.');
	}
	if (!origin.port || origin.username || origin.password || origin.pathname !== '/'
		|| origin.search || origin.hash || origin.origin !== value.origin) {
		throw new TypeError('Web VCR smoke certificate origin must be a canonical loopback origin.');
	}
	return Object.freeze({ hostname: origin.hostname, fingerprint: value.fingerprint });
}

function certificateFingerprint(data: unknown): string | null {
	if (typeof data !== 'string') return null;
	try { return new X509Certificate(data).fingerprint256; }
	catch { return null; }
}
