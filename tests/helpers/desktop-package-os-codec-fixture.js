/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { DESKTOP_CODEC_POLICY } from '../../scripts/lib/desktop-codec-policy.mjs';

const REVISION = 'a'.repeat(40);

export async function osCodecPackageTree(context, target) {
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
		applicationVersion: '1.0.0-rc.1',
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

export async function addOsCodecPayload(fixture, target) {
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
	await writeFile(fixture.runtimeManifestPath,
		`${JSON.stringify(fixture.runtimeManifest, null, 2)}\n`);
}
