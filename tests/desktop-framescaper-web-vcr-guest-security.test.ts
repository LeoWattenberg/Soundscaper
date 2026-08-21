/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	configureFramescaperWebVcrGuestSecurityV1,
	configureFramescaperWebVcrSmokeCertificateTrustV1,
	type FramescaperWebVcrGuestSecuritySession,
} from '../desktop/framescaper-web-vcr-guest-security.ts';

type PermissionCheck = Exclude<Parameters<FramescaperWebVcrGuestSecuritySession['setPermissionCheckHandler']>[0], null>;
type PermissionRequest = Exclude<Parameters<FramescaperWebVcrGuestSecuritySession['setPermissionRequestHandler']>[0], null>;
type DevicePermission = Exclude<Parameters<FramescaperWebVcrGuestSecuritySession['setDevicePermissionHandler']>[0], null>;
type Download = Parameters<FramescaperWebVcrGuestSecuritySession['on']>[1];
type CertificateVerify = Exclude<Parameters<FramescaperWebVcrGuestSecuritySession['setCertificateVerifyProc']>[0], null>;

const CERTIFICATE_DATA = readFileSync(new URL('fixtures/web-vcr/fixture-cert.pem', import.meta.url), 'utf8');
const CERTIFICATE_FINGERPRINT = new X509Certificate(CERTIFICATE_DATA).fingerprint256;

test('dedicated guest session denies every permission and download until disposed', () => {
	const harness = sessionHarness();
	const registration = configureFramescaperWebVcrGuestSecurityV1(harness.session);
	assert.equal(harness.permissionCheck({}, 'media', 'https://example.com/', {}), false);
	assert.equal(harness.devicePermission({ deviceType: 'usb' }), false);
	const decisions: boolean[] = [];
	harness.permissionRequest({}, 'notifications', (value) => decisions.push(value), {});
	assert.deepEqual(decisions, [false]);
	const event = { prevented: 0, preventDefault() { this.prevented += 1; } };
	const item = { cancelled: 0, cancel() { this.cancelled += 1; } };
	for (const listener of harness.downloads) listener(event, item);
	assert.deepEqual({ prevented: event.prevented, cancelled: item.cancelled }, {
		prevented: 1, cancelled: 1,
	});
	registration.dispose();
	registration.dispose();
	assert.equal(harness.permissionCheckValue, null);
	assert.equal(harness.permissionRequestValue, null);
	assert.equal(harness.devicePermissionValue, null);
	assert.equal(harness.downloads.size, 0);
});

test('loopback smoke certificate trust is exact, partition-local, and falls back to Chromium', () => {
	const harness = sessionHarness();
	const registration = configureFramescaperWebVcrSmokeCertificateTrustV1(harness.session, {
		enabled: true,
		origin: 'https://127.0.0.1:9443',
		fingerprint: CERTIFICATE_FINGERPRINT,
	});
	const decisions: number[] = [];
	harness.certificateVerify({
		hostname: '127.0.0.1', certificate: { data: CERTIFICATE_DATA, fingerprint: 'not-authoritative' },
	}, (value) => decisions.push(value));
	harness.certificateVerify({
		hostname: '127.0.0.1', certificate: { data: 'not a certificate' },
	}, (value) => decisions.push(value));
	harness.certificateVerify({
		hostname: 'example.com', certificate: { data: CERTIFICATE_DATA },
	}, (value) => decisions.push(value));
	assert.deepEqual(decisions, [0, -3, -3]);
	registration.dispose();
	assert.equal(harness.certificateVerifyValue, null);

	assert.throws(() => configureFramescaperWebVcrSmokeCertificateTrustV1(harness.session, {
		enabled: true, origin: 'https://example.com:9443', fingerprint: CERTIFICATE_FINGERPRINT,
	}), /loopback/iu);
	assert.throws(() => configureFramescaperWebVcrSmokeCertificateTrustV1(harness.session, {
		enabled: true, origin: 'http://127.0.0.1:9443', fingerprint: CERTIFICATE_FINGERPRINT,
	}), /HTTPS/iu);
});

function sessionHarness() {
	const harness = {
		permissionCheckValue: null as PermissionCheck | null,
		permissionRequestValue: null as PermissionRequest | null,
		devicePermissionValue: null as DevicePermission | null,
		certificateVerifyValue: null as CertificateVerify | null,
		downloads: new Set<Download>(),
		permissionCheck(...args: Parameters<PermissionCheck>) {
			if (!harness.permissionCheckValue) throw new Error('permission check missing');
			return harness.permissionCheckValue(...args);
		},
		permissionRequest(...args: Parameters<PermissionRequest>) {
			if (!harness.permissionRequestValue) throw new Error('permission request missing');
			harness.permissionRequestValue(...args);
		},
		devicePermission(...args: Parameters<DevicePermission>) {
			if (!harness.devicePermissionValue) throw new Error('device permission missing');
			return harness.devicePermissionValue(...args);
		},
		certificateVerify(...args: Parameters<CertificateVerify>) {
			if (!harness.certificateVerifyValue) throw new Error('certificate verifier missing');
			harness.certificateVerifyValue(...args);
		},
		session: null as unknown as FramescaperWebVcrGuestSecuritySession,
	};
	harness.session = {
		setPermissionCheckHandler: (value) => { harness.permissionCheckValue = value; },
		setPermissionRequestHandler: (value) => { harness.permissionRequestValue = value; },
		setDevicePermissionHandler: (value) => { harness.devicePermissionValue = value; },
		setCertificateVerifyProc: (value) => { harness.certificateVerifyValue = value; },
		on: (name, listener) => { assert.equal(name, 'will-download'); harness.downloads.add(listener); },
		removeListener: (name, listener) => {
			assert.equal(name, 'will-download'); harness.downloads.delete(listener);
		},
	};
	return harness;
}
