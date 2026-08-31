/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateMilestone5PackagePayloadBinding } from '../scripts/lib/milestone-5-handoff-package-binding.mjs';

const DIGEST = 'a'.repeat(64);
const INPUT_PATHS = {
	nativeAddonPayload: 'config/native-addon-payload-manifest.json',
	soundscaperProfessionalPayload: 'config/soundscaper-professional-native-payload-manifest.json',
	mediaHostPayload: 'config/framescaper-media-host-payload-manifest.json',
	openFxHostPayload: 'config/framescaper-openfx-host-payload-manifest.json',
};

test('Soundscaper package audit binds the native payload closure', () => {
	const fixture = soundscaperFixture();
	assert.doesNotThrow(() => validateMilestone5PackagePayloadBinding(
		fixture.packageAudit, fixture.payloadAudit, INPUT_PATHS,
	));
	const changed = structuredClone(fixture.packageAudit);
	changed.runtimeManifest.value.soundscaperProfessionalNative.payload.sha256 = 'b'.repeat(64);
	assert.throws(() => validateMilestone5PackagePayloadBinding(
		changed, fixture.payloadAudit, INPUT_PATHS,
	), /professional native target/iu);
});

test('Framescaper package audit binds media, OpenFX and isolation payload closures', () => {
	const fixture = framescaperFixture();
	assert.doesNotThrow(() => validateMilestone5PackagePayloadBinding(
		fixture.packageAudit, fixture.payloadAudit, INPUT_PATHS,
	));
	const changedIsolation = structuredClone(fixture.packageAudit);
	changedIsolation.runtimeManifest.value.framescaperNativeHosts.mediaHost.payloads[1].sha256 =
		'b'.repeat(64);
	assert.throws(
		() => validateMilestone5PackagePayloadBinding(
			changedIsolation, fixture.payloadAudit, INPUT_PATHS,
		),
		/media host target/iu,
	);
});

function soundscaperFixture() {
	const payloadAudit = basePayloadAudit();
	const native = payload('native/addon.node', 'addon.node');
	const professional = payload('native/professional.node', 'professional.node');
	payloadAudit.manifests.nativeAddon.targets = [{
		id: 'linux-x64', status: 'built', blockedBy: null, payload: native.source,
	}];
	payloadAudit.manifests.soundscaperProfessional.targets = [{
		id: 'linux-x64', status: 'built', blockedBy: null,
		sourceAuthentication: { status: 'authenticated' }, payload: professional.source,
	}];
	payloadAudit.rows.push({
		identity: 'soundscaper-professional:linux-x64',
	});
	return {
		payloadAudit,
		packageAudit: {
			productId: 'soundscaper',
			targetId: 'linux-x64',
			runtimeManifest: { value: {
				nativeAddons: {
					target: 'linux-x64', status: 'built', blockedBy: null,
					payloadManifest: { id: 'native', sha256: DIGEST }, payload: native.packaged,
				},
				soundscaperProfessionalNative: {
					target: 'linux-x64', targetSource: 'declared', status: 'built', blockedBy: null,
					payloadManifest: { id: 'professional', byteLength: 11, sha256: DIGEST },
					sourceAuthentication: { status: 'authenticated' },
					payload: professional.packaged,
				},
				framescaperNativeHosts: null,
			} },
		},
	};
}

function framescaperFixture() {
	const payloadAudit = basePayloadAudit();
	const native = payload('native/addon.node', 'addon.node');
	const media = payload('native/media-host', 'media-host');
	const scanner = payload('native/scanner', 'scanner');
	const runtime = payload('native/runtime-host', 'runtime-host');
	const mediaIsolation = isolationPayload('native/media-isolation');
	const openFxIsolation = isolationPayload('native/openfx-isolation');
	payloadAudit.manifests.nativeAddon.targets = [{
		id: 'linux-x64', status: 'built', blockedBy: null, payload: native.source,
	}];
	payloadAudit.manifests.mediaHost.targets = [{
		id: 'linux-x64', status: 'built', blockedBy: null, payload: media.source,
		isolationPayload: mediaIsolation.source,
	}];
	payloadAudit.manifests.openFxHost.targets = [{
		id: 'linux-x64', status: 'built', blockedBy: null,
		payload: {
			scannerPayload: scanner.source, runtimeHostPayload: runtime.source,
			isolationPayload: openFxIsolation.source,
		},
	}];
	payloadAudit.rows.push(
		{
			identity: 'framescaper-media:linux-x64',
		},
		{
			identity: 'framescaper-openfx:linux-x64',
		},
	);
	return {
		payloadAudit,
		packageAudit: {
			productId: 'framescaper',
			targetId: 'linux-x64',
			runtimeManifest: { value: {
				nativeAddons: {
					target: 'linux-x64', status: 'built', blockedBy: null,
					payloadManifest: { id: 'native', sha256: DIGEST }, payload: native.packaged,
				},
				soundscaperProfessionalNative: null,
				framescaperNativeHosts: {
					target: 'linux-x64',
					mediaHost: {
						payloadManifest: { id: 'media', sha256: DIGEST }, status: 'built',
						blockedBy: null, payloads: [media.packaged, ...mediaIsolation.packaged],
					},
					openFxHost: {
						payloadManifest: { id: 'openfx', sha256: DIGEST }, status: 'built',
						blockedBy: null,
						payloads: [scanner.packaged, runtime.packaged, ...openFxIsolation.packaged],
					},
				},
			} },
		},
	};
}

function basePayloadAudit() {
	return {
		inputDigests: {
			[INPUT_PATHS.nativeAddonPayload]: { byteLength: 10, sha256: DIGEST },
			[INPUT_PATHS.soundscaperProfessionalPayload]: { byteLength: 11, sha256: DIGEST },
			[INPUT_PATHS.mediaHostPayload]: { byteLength: 12, sha256: DIGEST },
			[INPUT_PATHS.openFxHostPayload]: { byteLength: 13, sha256: DIGEST },
		},
		manifests: {
			nativeAddon: { id: 'native', targets: [] },
			soundscaperProfessional: { id: 'professional', targets: [] },
			mediaHost: { id: 'media', targets: [] },
			openFxHost: { id: 'openfx', targets: [] },
		},
		rows: [],
	};
}

function payload(path, name) {
	return {
		source: { path, byteLength: 7, sha256: DIGEST },
		packaged: { name, byteLength: 7, sha256: DIGEST },
	};
}

function isolationPayload(prefix) {
	const launcher = payload(`${prefix}/launcher`, 'launcher');
	const sandbox = payload(`${prefix}/sandbox`, 'sandbox');
	const broker = payload(`${prefix}/broker`, 'broker');
	const library = payload(`${prefix}/runtime-library`, 'runtime-library');
	return {
		source: {
			launcherPayload: launcher.source,
			sandboxProfilePayload: sandbox.source,
			brokerPolicyPayload: broker.source,
			runtimeLibraryPayloads: [library.source],
		},
		packaged: [launcher.packaged, sandbox.packaged, broker.packaged, library.packaged],
	};
}
