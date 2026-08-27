/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	auditExtractedDesktopPackageContent,
	writeDesktopPackageContentManifest,
} from '../scripts/lib/desktop-package-content-manifest.mjs';
import { ASSISTANCE_TARGET_STATUSES } from '../desktop/assistance-native-runtime-payload.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';

const REVISION = 'a'.repeat(40);

test('the embedded package-content manifest binds the exact installed resource closure', async (context) => {
	const fixture = await packageTree(context);
	const written = await writeDesktopPackageContentManifest({
		resourcesRoot: fixture.resourcesRoot,
		runtimeManifestPath: fixture.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	});
	assert.equal(written.status, 'installed-resource-closure-audited');
	assert.equal(written.fileCount, 13);
	const audit = await auditExtractedDesktopPackageContent({
		extractedRoot: fixture.extractedRoot,
		runtimeManifestBytes: await readFile(fixture.runtimeManifestPath),
		productId: 'soundscaper',
		targetId: 'linux-x64',
	});
	assert.equal(audit.contentManifestSha256, written.contentManifestSha256);
	assert.equal(audit.sourceRevision, REVISION);
	assert.equal(audit.fileCount, 13);
	assert.match(audit.installedClosureSha256, /^[a-f\d]{64}$/u);
	assert.match(audit.resourcesPath, /usr\/lib\/soundscaper\/resources$/u);
});

test('human professional readiness fields cannot suppress package-content auditing', async (context) => {
	const fixture = await packageTree(context);
	const professional = fixture.runtimeManifest.soundscaperProfessionalNative;
	professional.reviewPolicy = null;
	professional.productionReadiness = { verified: { status: 'pending-human-review' } };
	await rm(join(
		fixture.resourcesRoot,
		'runtime/native/soundscaper-professional-host/linux-x64/milestone-5-native-isolation-review-policy.json',
	));
	await writeJson(fixture.runtimeManifestPath, fixture.runtimeManifest);
	const written = await writeDesktopPackageContentManifest({
		resourcesRoot: fixture.resourcesRoot,
		runtimeManifestPath: fixture.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	});
	assert.equal(written.status, 'installed-resource-closure-audited');
});

test('content audit rejects changed, extra, symbolic, and decoy resources', async (context) => {
	for (const failure of ['changed', 'extra', 'symbol', 'decoy']) {
		const fixture = await packageTree(context);
		await writeDesktopPackageContentManifest({
			resourcesRoot: fixture.resourcesRoot,
			runtimeManifestPath: fixture.runtimeManifestPath,
			productId: 'soundscaper',
			targetId: 'linux-x64',
		});
		if (failure === 'changed') {
			await writeFile(join(fixture.resourcesRoot, 'runtime/native/linux-x64/addon.node'), 'changed');
		}
		if (failure === 'extra') await writeFile(join(fixture.resourcesRoot, 'runtime/extra.so'), 'extra');
		if (failure === 'symbol') {
			await rm(join(fixture.resourcesRoot, 'runtime/native/linux-x64/addon.node'));
			await symlink(join(fixture.resourcesRoot, 'app.asar'),
				join(fixture.resourcesRoot, 'runtime/native/linux-x64/addon.node'));
		}
		if (failure === 'decoy') {
			await rm(join(dirname(fixture.resourcesRoot), 'soundscaper'));
		}
		await assert.rejects(auditExtractedDesktopPackageContent({
			extractedRoot: fixture.extractedRoot,
			runtimeManifestBytes: await readFile(fixture.runtimeManifestPath),
			productId: 'soundscaper',
			targetId: 'linux-x64',
		}), /closure|digest|inventory|symbolic|executable|layout/iu, failure);
	}
});

test('content audit binds the embedded and adjacent runtime manifests exactly', async (context) => {
	const fixture = await packageTree(context);
	await writeDesktopPackageContentManifest({
		resourcesRoot: fixture.resourcesRoot,
		runtimeManifestPath: fixture.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	});
	const other = Buffer.from(`${JSON.stringify({
		...fixture.runtimeManifest,
		sourceRevision: 'b'.repeat(40),
	}, null, 2)}\n`);
	await assert.rejects(auditExtractedDesktopPackageContent({
		extractedRoot: fixture.extractedRoot,
		runtimeManifestBytes: other,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /runtime manifest/iu);
});

test('package-content authority rejects bundled FFmpeg and legacy runtime summaries', async (context) => {
	const bundled = await packageTree(context);
	await mkdir(join(bundled.resourcesRoot, 'runtime/ffmpeg/9'), { recursive: true });
	await writeFile(join(bundled.resourcesRoot, 'runtime/ffmpeg/9/ffmpeg-core.wasm'), 'forbidden core');
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: bundled.resourcesRoot,
		runtimeManifestPath: bundled.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /forbidden bundled FFmpeg.*runtime\/ffmpeg/iu);

	const legacy = await packageTree(context);
	legacy.runtimeManifest.ffmpeg = { version: '5.1.4' };
	await writeFile(legacy.runtimeManifestPath,
		`${JSON.stringify(legacy.runtimeManifest, null, 2)}\n`);
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: legacy.resourcesRoot,
		runtimeManifestPath: legacy.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /legacy bundled FFmpeg runtime summary/iu);
});

test('package-content authority binds the codec-only OS payload for every supported package target', async (context) => {
	for (const target of ['win-x64', 'win-arm64', 'mac-arm64']) {
		const fixture = await osCodecPackageTree(context, target);
		const written = await writeDesktopPackageContentManifest({
			resourcesRoot: fixture.resourcesRoot,
			runtimeManifestPath: fixture.runtimeManifestPath,
			productId: 'soundscaper',
			targetId: target,
		});
		assert.equal(written.status, 'installed-resource-closure-audited');
	}
});

test('package-content authority rejects changed codec evidence and unexpected subtree content', async (context) => {
	const changed = await osCodecPackageTree(context, 'win-x64');
	changed.runtimeManifest.osAudioCodecNative.payload.sha256 = '0'.repeat(64);
	await writeJson(changed.runtimeManifestPath, changed.runtimeManifest);
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: changed.resourcesRoot,
		runtimeManifestPath: changed.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'win-x64',
	}), /OS audio codec.*payload/iu);

	const extra = await osCodecPackageTree(context, 'win-arm64');
	await writeFile(join(
		extra.resourcesRoot,
		'runtime/native/soundscaper-os-audio-codec/win-arm64/foreign.node',
	), 'foreign');
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: extra.resourcesRoot,
		runtimeManifestPath: extra.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'win-arm64',
	}), /unexpected files.*soundscaper-os-audio-codec/iu);

	const unsignedMac = await osCodecPackageTree(context, 'mac-arm64');
	unsignedMac.runtimeManifest.osAudioCodecNative.signing = {
		mode: 'not-applicable', identitySha256: null, verificationStatus: 'not-applicable',
	};
	await writeJson(unsignedMac.runtimeManifestPath, unsignedMac.runtimeManifest);
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: unsignedMac.resourcesRoot,
		runtimeManifestPath: unsignedMac.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'mac-arm64',
	}), /invalid OS audio codec native evidence/iu);
});

test('package-content authority requires null and absence outside supported Soundscaper targets', async (context) => {
	const absent = await osCodecPackageTree(context, 'mac-arm64');
	absent.runtimeManifest.osAudioCodecNative = null;
	await writeJson(absent.runtimeManifestPath, absent.runtimeManifest);
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: absent.resourcesRoot,
		runtimeManifestPath: absent.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'mac-arm64',
	}), /unexpected files.*soundscaper-os-audio-codec/iu);

	const linux = await packageTree(context);
	await addOsCodecPayload(linux, 'linux-x64');
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: linux.resourcesRoot,
		runtimeManifestPath: linux.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /OS audio codec.*(?:unsupported|invalid|Linux)/iu);

	const framescaper = await framescaperPackageTree(context);
	await makeMediaHostPending(framescaper);
	await addOsCodecPayload(framescaper, 'linux-x64');
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: framescaper.resourcesRoot,
		runtimeManifestPath: framescaper.runtimeManifestPath,
		productId: 'framescaper',
		targetId: 'linux-x64',
	}), /Framescaper.*OS audio codec|OS audio codec.*Framescaper/iu);
});

test('Framescaper rejects its static-FFmpeg media host while retaining OpenFX closure', async (context) => {
	const forbidden = await framescaperPackageTree(context);
	await assert.rejects(writeDesktopPackageContentManifest({
		resourcesRoot: forbidden.resourcesRoot,
		runtimeManifestPath: forbidden.runtimeManifestPath,
		productId: 'framescaper',
		targetId: 'linux-x64',
	}), /forbidden bundled FFmpeg.*framescaper-media-host/iu);

	const fixture = await framescaperPackageTree(context);
	await makeMediaHostPending(fixture);
	const written = await writeDesktopPackageContentManifest({
		resourcesRoot: fixture.resourcesRoot, runtimeManifestPath: fixture.runtimeManifestPath,
		productId: 'framescaper', targetId: 'linux-x64',
	});
	assert.equal(written.status, 'installed-resource-closure-audited');

	const reportOnly = await framescaperPackageTree(context);
	await makeMediaHostPending(reportOnly);
	const openFx = reportOnly.runtimeManifest.framescaperNativeHosts.openFxHost;
	openFx.reviewPolicy = null;
	openFx.productionReadiness = { verified: { status: 'pending-human-review' } };
	for (const name of [
		'milestone-5-native-isolation-review-policy.json',
		'framescaper-openfx-production-readiness.json',
	]) await rm(join(
		reportOnly.resourcesRoot,
		`runtime/native/framescaper-openfx-host/linux-x64/${name}`,
	));
	await writeJson(reportOnly.runtimeManifestPath, reportOnly.runtimeManifest);
	const automated = await writeDesktopPackageContentManifest({
		resourcesRoot: reportOnly.resourcesRoot,
		runtimeManifestPath: reportOnly.runtimeManifestPath,
		productId: 'framescaper',
		targetId: 'linux-x64',
	});
	assert.equal(automated.status, 'installed-resource-closure-audited');
});

async function makeMediaHostPending(fixture) {
	await rm(join(fixture.resourcesRoot, 'runtime/native/framescaper-media-host/linux-x64'), {
		recursive: true, force: true,
	});
	fixture.runtimeManifest.framescaperNativeHosts.mediaHost = {
		status: 'pending-external', blockedBy: 'Static FFmpeg hosts are not distributable.',
		payloads: [], reviewPolicy: null, productionReadiness: null,
	};
	await writeFile(fixture.runtimeManifestPath,
		`${JSON.stringify(fixture.runtimeManifest, null, 2)}\n`);
}

async function osCodecPackageTree(context, target) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-package-os-codec-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resourcesRoot = join(root, 'resources');
	const nativePrefix = `runtime/native/${target}`;
	const professionalPrefix = `runtime/native/soundscaper-professional-host/${target}`;
	const payloads = {
		'app.asar': Buffer.from('authenticated application'),
		[`${nativePrefix}/native-addon-payload-manifest.json`]: Buffer.from('native manifest'),
		[`${professionalPrefix}/soundscaper-professional-native-payload-manifest.json`]:
			Buffer.from('professional manifest'),
		[`${professionalPrefix}/milestone-5-native-isolation-review-policy.json`]:
			Buffer.from('professional review policy'),
	};
	for (const [path, bytes] of Object.entries(payloads)) {
		await mkdir(dirname(join(resourcesRoot, path)), { recursive: true });
		await writeFile(join(resourcesRoot, path), bytes);
	}
	const descriptor = (path) => ({
		byteLength: payloads[path].byteLength,
		sha256: createHash('sha256').update(payloads[path]).digest('hex'),
	});
	const [platform, arch] = target.split('-');
	const runtimeManifest = {
		schemaVersion: 1,
		productId: 'soundscaper',
		applicationVersion: '0.2.0-beta.1',
		sourceRevision: REVISION,
		target: { platform, arch },
		desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		nativeAddons: {
			target, status: 'pending-external', payload: null,
			payloadManifest: { sha256: descriptor(`${nativePrefix}/native-addon-payload-manifest.json`).sha256 },
		},
		soundscaperProfessionalNative: {
			target, status: 'pending-external', payload: null, productionReadiness: null,
			payloadManifest: descriptor(
				`${professionalPrefix}/soundscaper-professional-native-payload-manifest.json`,
			),
			reviewPolicy: {
				name: 'milestone-5-native-isolation-review-policy.json',
				...descriptor(`${professionalPrefix}/milestone-5-native-isolation-review-policy.json`),
			},
		},
		assistanceNativeRuntime: { target, status: 'unsupported', payload: null },
		framescaperNativeHosts: null,
		translations: {},
	};
	const runtimeManifestPath = join(root, 'runtime-manifest.json');
	const fixture = { resourcesRoot, runtimeManifest, runtimeManifestPath, payloads };
	await addOsCodecPayload(fixture, target);
	return fixture;
}

async function addOsCodecPayload(fixture, target) {
	const prefix = `runtime/native/soundscaper-os-audio-codec/${target}`;
	const manifestPath = `${prefix}/os-audio-codec-native-payload-manifest.json`;
	const payloadPath = `${prefix}/soundscaper_os_audio_codec.node`;
	fixture.payloads ??= {};
	fixture.payloads[manifestPath] = Buffer.from(`authenticated codec manifest ${target}`);
	fixture.payloads[payloadPath] = Buffer.from(`authenticated codec payload ${target}`);
	for (const path of [manifestPath, payloadPath]) {
		await mkdir(dirname(join(fixture.resourcesRoot, path)), { recursive: true });
		await writeFile(join(fixture.resourcesRoot, path), fixture.payloads[path]);
	}
	const descriptor = (path) => ({
		byteLength: fixture.payloads[path].byteLength,
		sha256: createHash('sha256').update(fixture.payloads[path]).digest('hex'),
	});
	fixture.runtimeManifest.osAudioCodecNative = {
		target, status: 'built',
		payloadManifest: {
			id: 'soundscaper-os-audio-codec-native-1.0.0',
			name: 'os-audio-codec-native-payload-manifest.json',
			...descriptor(manifestPath),
		},
		payload: { name: 'soundscaper_os_audio_codec.node', ...descriptor(payloadPath) },
		sourceRevision: '3'.repeat(64),
		buildPlanSha256: '4'.repeat(64),
		nativeCanary: 'passed',
		signing: target === 'mac-arm64'
			? { mode: 'ad-hoc', identitySha256: '5'.repeat(64), verificationStatus: 'passed' }
			: { mode: 'not-applicable', identitySha256: null, verificationStatus: 'not-applicable' },
	};
	await writeJson(fixture.runtimeManifestPath, fixture.runtimeManifest);
}

async function writeJson(path, value) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function packageTree(context) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-package-content-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const extractedRoot = join(root, 'extracted');
	const applicationRoot = join(extractedRoot, 'usr/lib/soundscaper');
	const resourcesRoot = join(applicationRoot, 'resources');
	const payloads = {
		'app.asar': Buffer.from('authenticated application'),
		'runtime/native/linux-x64/native-addon-payload-manifest.json': Buffer.from('authenticated addon manifest'),
		'runtime/native/linux-x64/addon.node': Buffer.from('authenticated native payload'),
		'runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-native-payload-manifest.json':
			Buffer.from('authenticated professional manifest'),
		'runtime/native/soundscaper-professional-host/linux-x64/soundscaper_professional.node':
			Buffer.from('authenticated professional payload'),
		'runtime/native/soundscaper-professional-host/linux-x64/milestone-5-native-isolation-review-policy.json':
			Buffer.from('authenticated native-isolation review policy'),
		'runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-plugin-peer':
			Buffer.from('authenticated professional plug-in peer'),
		'runtime/native/soundscaper-professional-host/linux-x64/m5-native-isolation-launcher':
			Buffer.from('authenticated isolation launcher'),
		'runtime/native/soundscaper-professional-host/linux-x64/profiles/linux-v1.json':
			Buffer.from('authenticated sandbox profile'),
		'runtime/native/soundscaper-professional-host/linux-x64/profiles/linux-broker-v1.json':
			Buffer.from('authenticated broker policy'),
		'runtime/native/soundscaper-professional-host/linux-x64/runtime/ld-linux-x86-64.so.2':
			Buffer.from('authenticated runtime loader'),
		'runtime/assistance/test/node_modules/runtime/native.node': Buffer.from('authenticated assistance payload'),
		'runtime/translations/audacity/4/latest.json': Buffer.from('authenticated translations'),
	};
	for (const [path, bytes] of Object.entries(payloads)) {
		await mkdir(dirname(join(resourcesRoot, path)), { recursive: true });
		await writeFile(join(resourcesRoot, path), bytes);
	}
	const executable = Buffer.alloc(64);
	executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
	executable.writeUInt16LE(62, 18);
	await writeFile(join(applicationRoot, 'soundscaper'), executable);
	const descriptor = (path) => ({
		byteLength: payloads[path].byteLength,
		sha256: createHash('sha256').update(payloads[path]).digest('hex'),
	});
	const runtimeManifest = {
		schemaVersion: 1,
		productId: 'soundscaper',
		applicationVersion: '0.2.0-beta.1',
		sourceRevision: REVISION,
		target: { platform: 'linux', arch: 'x64' },
		desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		nativeAddons: {
			target: 'linux-x64', status: 'built',
			payloadManifest: { sha256: descriptor('runtime/native/linux-x64/native-addon-payload-manifest.json').sha256 },
			payload: { name: 'addon.node', ...descriptor('runtime/native/linux-x64/addon.node') },
		},
		osAudioCodecNative: null,
		soundscaperProfessionalNative: {
			target: 'linux-x64', status: 'built',
			productionReadiness: null,
			reviewPolicy: {
				name: 'milestone-5-native-isolation-review-policy.json',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/milestone-5-native-isolation-review-policy.json'),
			},
			payloadManifest: descriptor(
				'runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-native-payload-manifest.json',
			),
			payload: {
				name: 'soundscaper_professional.node',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/soundscaper_professional.node'),
			},
			pluginPeer: {
				path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-plugin-peer',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-plugin-peer'),
			},
			isolation: {
				launcher: {
					path: 'native/soundscaper-professional-host/prebuilt/linux-x64/m5-native-isolation-launcher',
					...descriptor('runtime/native/soundscaper-professional-host/linux-x64/m5-native-isolation-launcher'),
				},
				sandboxProfile: {
					path: 'native/soundscaper-professional-host/prebuilt/linux-x64/profiles/linux-v1.json',
					...descriptor('runtime/native/soundscaper-professional-host/linux-x64/profiles/linux-v1.json'),
				},
				brokerPolicy: {
					path: 'native/soundscaper-professional-host/prebuilt/linux-x64/profiles/linux-broker-v1.json',
					...descriptor('runtime/native/soundscaper-professional-host/linux-x64/profiles/linux-broker-v1.json'),
				},
				runtimeClosure: [{
					path: 'native/soundscaper-professional-host/prebuilt/linux-x64/runtime/ld-linux-x86-64.so.2',
					...descriptor('runtime/native/soundscaper-professional-host/linux-x64/runtime/ld-linux-x86-64.so.2'),
				}],
			},
		},
		assistanceNativeRuntime: {
			target: 'linux-x64', status: 'built',
			payload: {
				root: 'assistance/test',
				files: { 'node_modules/runtime/native.node': descriptor('runtime/assistance/test/node_modules/runtime/native.node') },
			},
		},
		framescaperNativeHosts: null,
		translations: { latest: { path: 'latest.json', ...descriptor('runtime/translations/audacity/4/latest.json') } },
	};
	const runtimeManifestPath = join(root, 'runtime-manifest.json');
	await writeFile(runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`);
	return { extractedRoot, resourcesRoot, runtimeManifest, runtimeManifestPath };
}

async function framescaperPackageTree(context) {
	const fixture = await packageTree(context);
	await rm(join(fixture.resourcesRoot, 'runtime/native/soundscaper-professional-host'), {
		recursive: true,
	});
	await rm(join(dirname(fixture.resourcesRoot), 'soundscaper'));
	const executable = Buffer.alloc(64);
	executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
	executable.writeUInt16LE(62, 18);
	await writeFile(join(dirname(fixture.resourcesRoot), 'framescaper'), executable);
	const prefix = 'runtime/native/framescaper-openfx-host/linux-x64';
	const mediaPrefix = 'runtime/native/framescaper-media-host/linux-x64';
	const mediaPath = `${mediaPrefix}/media-host`;
	const files = {
		[mediaPath]: Buffer.from('authenticated media host'),
		[`${mediaPrefix}/milestone-5-native-isolation-review-policy.json`]:
			Buffer.from('authenticated Framescaper media isolation policy'),
		[`${mediaPrefix}/framescaper-media-host-production-readiness.json`]:
			Buffer.from('authenticated Framescaper media readiness'),
		[`${prefix}/scanner`]: Buffer.from('authenticated OpenFX scanner'),
		[`${prefix}/runtime-host`]: Buffer.from('authenticated OpenFX runtime host'),
		[`${prefix}/milestone-5-native-isolation-review-policy.json`]:
			Buffer.from('authenticated Framescaper isolation policy'),
		[`${prefix}/framescaper-openfx-production-readiness.json`]:
			Buffer.from('authenticated Framescaper OpenFX readiness'),
	};
	for (const [path, bytes] of Object.entries(files)) {
		await mkdir(dirname(join(fixture.resourcesRoot, path)), { recursive: true });
		await writeFile(join(fixture.resourcesRoot, path), bytes);
	}
	const descriptor = (path) => ({
		byteLength: files[path].byteLength,
		sha256: createHash('sha256').update(files[path]).digest('hex'),
	});
	const runtimeManifest = {
		...fixture.runtimeManifest,
		productId: 'framescaper',
		soundscaperProfessionalNative: null,
		framescaperNativeHosts: {
			target: 'linux-x64',
			mediaHost: {
				status: 'built', blockedBy: null,
				payloads: [{ name: 'media-host', ...descriptor(mediaPath) }],
				reviewPolicy: {
					name: 'milestone-5-native-isolation-review-policy.json',
					...descriptor(`${mediaPrefix}/milestone-5-native-isolation-review-policy.json`),
				},
				productionReadiness: {
					reference: { target: 'linux-x64' },
					evidence: {
						name: 'framescaper-media-host-production-readiness.json',
						...descriptor(`${mediaPrefix}/framescaper-media-host-production-readiness.json`),
					},
					verified: {
						status: 'authenticated',
						evidence: { target: 'linux-x64' },
					},
				},
			},
			openFxHost: {
				status: 'built', blockedBy: null,
				payloads: [
					{ name: 'scanner', ...descriptor(`${prefix}/scanner`) },
					{ name: 'runtime-host', ...descriptor(`${prefix}/runtime-host`) },
				],
				reviewPolicy: {
					name: 'milestone-5-native-isolation-review-policy.json',
					...descriptor(`${prefix}/milestone-5-native-isolation-review-policy.json`),
				},
				productionReadiness: {
					evidence: {
						name: 'framescaper-openfx-production-readiness.json',
						...descriptor(`${prefix}/framescaper-openfx-production-readiness.json`),
					},
				},
			},
		},
	};
	await writeFile(fixture.runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`);
	return { ...fixture, runtimeManifest };
}

/**
 * A target that could not be built carries no payload, and the manifest admits
 * three ways for that to be true. This gate knew only one of them, so packaging
 * Windows ARM64 — where the assistance runtime is pending-external because no
 * upstream build exists for it — failed on a target the manifest itself calls
 * valid, while Windows x64 packaged from the same run.
 */
test('a payload-free assistance target packages under every status the manifest admits', async (context) => {
	for (const status of ASSISTANCE_TARGET_STATUSES.filter((value) => value !== 'built')) {
		const fixture = await packageTree(context);
		fixture.runtimeManifest.assistanceNativeRuntime = {
			target: fixture.runtimeManifest.assistanceNativeRuntime.target, status, payload: null,
		};
		await writeFile(fixture.runtimeManifestPath,
			`${JSON.stringify(fixture.runtimeManifest, null, 2)}\n`);
		const written = await writeDesktopPackageContentManifest({
			resourcesRoot: fixture.resourcesRoot,
			runtimeManifestPath: fixture.runtimeManifestPath,
			productId: 'soundscaper',
			targetId: 'linux-x64',
		});
		assert.equal(written.status, 'installed-resource-closure-audited', status);
	}

	// The reason it could not be built never licenses shipping one anyway.
	const fixture = await packageTree(context);
	fixture.runtimeManifest.assistanceNativeRuntime = {
		target: fixture.runtimeManifest.assistanceNativeRuntime.target,
		status: 'pending-external',
		payload: { root: 'assistance/sherpa-onnx/1.13.5', files: {} },
	};
	await writeFile(fixture.runtimeManifestPath,
		`${JSON.stringify(fixture.runtimeManifest, null, 2)}\n`);
	await assert.rejects(() => writeDesktopPackageContentManifest({
		resourcesRoot: fixture.resourcesRoot,
		runtimeManifestPath: fixture.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /invalid assistance target state/u);

	// And a status the manifest does not admit is still refused.
	const invented = await packageTree(context);
	invented.runtimeManifest.assistanceNativeRuntime = {
		target: invented.runtimeManifest.assistanceNativeRuntime.target,
		status: 'skipped', payload: null,
	};
	await writeFile(invented.runtimeManifestPath,
		`${JSON.stringify(invented.runtimeManifest, null, 2)}\n`);
	await assert.rejects(() => writeDesktopPackageContentManifest({
		resourcesRoot: invented.resourcesRoot,
		runtimeManifestPath: invented.runtimeManifestPath,
		productId: 'soundscaper',
		targetId: 'linux-x64',
	}), /invalid assistance target state/u);
});
