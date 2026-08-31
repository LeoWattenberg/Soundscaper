/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { DESKTOP_CODEC_POLICY } from '../../scripts/lib/desktop-codec-policy.mjs';
import {
	typedUnavailableSoundscaperProfessionalNativeNotices,
} from '../../scripts/lib/soundscaper-professional-native-notices.mjs';

const REVISION = 'a'.repeat(40);

export async function packageTree(context) {
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
		'runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-native-build-result.json':
			Buffer.from('authenticated professional build-result receipt'),
		'runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-plugin-peer':
			Buffer.from('authenticated professional plug-in peer'),
		'runtime/native/soundscaper-professional-host/linux-x64/soundscaper_delivery_fs':
			Buffer.from('authenticated persistent-delivery filesystem helper'),
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
		applicationVersion: '1.0.0-rc.1',
		sourceRevision: REVISION,
		target: { platform: 'linux', arch: 'x64' },
		desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		desktopNotices: {
			professionalNative: typedUnavailableSoundscaperProfessionalNativeNotices('linux-x64'),
		},
		nativeAddons: {
			target: 'linux-x64', status: 'built',
			payloadManifest: { sha256: descriptor('runtime/native/linux-x64/native-addon-payload-manifest.json').sha256 },
			payload: { name: 'addon.node', ...descriptor('runtime/native/linux-x64/addon.node') },
		},
		osAudioCodecNative: null,
		soundscaperProfessionalNative: {
			target: 'linux-x64', status: 'built',
			osAudioCodec: null,
			payloadManifest: descriptor(
				'runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-native-payload-manifest.json',
			),
			payload: {
				name: 'soundscaper_professional.node',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/soundscaper_professional.node'),
			},
			buildResult: {
				path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-build-result.json',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-native-build-result.json'),
			},
			pluginPeer: {
				path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-plugin-peer',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/soundscaper-professional-plugin-peer'),
			},
			deliveryFilesystem: {
				path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper_delivery_fs',
				...descriptor('runtime/native/soundscaper-professional-host/linux-x64/soundscaper_delivery_fs'),
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
