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

	for (const [host, name, expected] of [[
		'openfx', 'framescaper-openfx-production-readiness.json', /OpenFX production-readiness evidence/iu,
	]]) {
		const missing = await framescaperPackageTree(context);
		await makeMediaHostPending(missing);
		await rm(join(
			missing.resourcesRoot,
			`runtime/native/framescaper-${host}-host/linux-x64/${name}`,
		));
		await assert.rejects(writeDesktopPackageContentManifest({
			resourcesRoot: missing.resourcesRoot,
			runtimeManifestPath: missing.runtimeManifestPath,
			productId: 'framescaper',
			targetId: 'linux-x64',
		}), expected);
	}
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
