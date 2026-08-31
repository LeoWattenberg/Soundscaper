/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runtime selection of the separately built professional Soundscaper addon. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import {
	parseSoundscaperProfessionalNativeBuildAuthority,
} from './soundscaper-professional-native-build-authority.mjs';

export const PROFESSIONAL_NATIVE_MANIFEST_PATH =
	'config/soundscaper-professional-native-payload-manifest.json';
const NATIVE_SOURCE_MANIFEST_PATH = 'config/milestone-5-native-source-acquisitions.json';
export const PROFESSIONAL_NATIVE_RUNTIME_PREFIX = 'native/soundscaper-professional-host';
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const SHA256 = /^[a-f\d]{64}$/u;
const TARGET_FIELDS = Object.freeze([
	'id', 'status', 'blockedBy', 'toolchainIdentity', 'sourceAuthentication',
	'buildResult', 'payload', 'osAudioCodec', 'pluginPeer', 'deliveryFilesystem', 'isolation',
]);

export async function describeSoundscaperProfessionalNativePayload(location, readFileImpl = readFile) {
	const target = runtimeTarget(location.platform ?? process.platform, location.arch ?? process.arch);
	if (!target) return unavailable('unsupported-platform', 'This platform is not a professional native target.');
	let manifest;
	try {
		const [manifestBytes, sourceBytes] = await Promise.all([
			readFileImpl(join(location.applicationRoot, PROFESSIONAL_NATIVE_MANIFEST_PATH)),
			readFileImpl(join(location.applicationRoot, NATIVE_SOURCE_MANIFEST_PATH)),
		]);
		manifest = JSON.parse(String(manifestBytes));
		validateManifest(manifest, JSON.parse(String(sourceBytes)));
	} catch (error) {
		return unavailable('manifest-unreadable', errorMessage(error));
	}
	const selected = manifest.targets.find((entry) => entry.id === target);
	if (!selected || selected.status !== 'built' || selected.payload === null) {
		return unavailable('payload-pending-external', selected?.blockedBy ?? 'No payload is built for this target.');
	}
	let payload;
	let osAudioCodec;
	let buildResult;
	let buildAuthority;
	let pluginPeer;
	let deliveryFilesystem;
	let isolation;
	let entrypoint;
	try {
		payload = await runtimeArtifact(location, manifest, target, selected.payload, readFileImpl);
		buildResult = await runtimeArtifact(location, manifest, target,
			selected.buildResult, readFileImpl, (bytes) => {
				buildAuthority = parseSoundscaperProfessionalNativeBuildAuthority(bytes, target);
			});
		osAudioCodec = selected.osAudioCodec === null ? null
			: await runtimeArtifact(location, manifest, target, selected.osAudioCodec, readFileImpl);
		pluginPeer = await runtimeArtifact(location, manifest, target, selected.pluginPeer, readFileImpl);
		deliveryFilesystem = await runtimeArtifact(
			location, manifest, target, selected.deliveryFilesystem, readFileImpl,
		);
		const runtimeClosure = Object.freeze(await Promise.all(selected.isolation.runtimeClosure.map((entry) =>
			runtimeArtifact(location, manifest, target, entry, readFileImpl))));
		entrypoint = selected.isolation.entrypointPath === selected.pluginPeer.path ? pluginPeer
			: runtimeClosure[selected.isolation.runtimeClosure.findIndex(({ path }) =>
				path === selected.isolation.entrypointPath)];
		isolation = Object.freeze({
			launcher: await runtimeArtifact(location, manifest, target, selected.isolation.launcher, readFileImpl),
			sandboxProfile: await runtimeArtifact(location, manifest, target,
				selected.isolation.sandboxProfile, readFileImpl),
			brokerPolicy: await runtimeArtifact(location, manifest, target,
				selected.isolation.brokerPolicy, readFileImpl),
			runtimeClosure,
		});
	} catch (error) { return unavailable('payload-digest-mismatch', errorMessage(error)); }
	return Object.freeze({ status: 'available', descriptor: Object.freeze({
		target, path: payload.path, byteLength: payload.byteLength, sha256: payload.sha256,
		addonVersion: manifest.addon.version, napiVersion: manifest.addon.napiVersion,
		toolchainIdentity: selected.toolchainIdentity, sourceAudit: selected.sourceAuthentication,
		buildResult, buildAuthority, osAudioCodec, deliveryFilesystem,
		pluginPeer, isolation: Object.freeze({ ...isolation, entrypoint }),
	}) });
}

export function createSoundscaperProfessionalNativeVerifier(location, readFileImpl) {
	return async () => {
		const result = await describeSoundscaperProfessionalNativePayload(location, readFileImpl);
		if (result.status !== 'available') {
			throw new Error(`The professional native payload is unavailable (${result.reason}): ${result.detail}`);
		}
		return result.descriptor;
	};
}

function validateManifest(value, sourceRegister) {
	if (value?.schemaVersion !== 1 || value.id !== 'soundscaper-professional-native-host-1.0.0'
		|| value.addon?.payloadName !== 'soundscaper_professional.node'
		|| value.addon?.napiVersion !== 8 || value.addon?.license !== 'AGPL-3.0-only'
		|| value.pluginPeer?.payloadName !== 'soundscaper_professional_peer'
		|| value.pluginPeer?.protocol !== 'M5F1' || value.pluginPeer?.license !== 'AGPL-3.0-only'
		|| value.deliveryFilesystem?.payloadName !== 'soundscaper_delivery_fs'
		|| value.deliveryFilesystem?.protocol !== 'SDF1'
		|| value.deliveryFilesystem?.license !== 'AGPL-3.0-only'
		|| value.isolation?.launcherName !== 'milestone5-native-isolation-launcher'
		|| value.isolation?.profileName !== 'native-isolation-profile-v1.json'
		|| value.isolation?.brokerPolicyName !== 'native-isolation-broker-v1.json'
		|| value.isolation?.runtimeDirectory !== 'runtime'
		|| value.staging?.runtimePrefix !== PROFESSIONAL_NATIVE_RUNTIME_PREFIX
		|| !Array.isArray(value.targets) || value.targets.length !== TARGETS.length
		|| !TARGETS.every((id) => value.targets.filter((entry) => entry.id === id).length === 1)) {
		throw new TypeError('The professional native payload manifest is invalid.');
	}
	for (const target of value.targets) {
		if (!exactKeys(target, TARGET_FIELDS)) {
			throw new TypeError(`The professional native ${String(target?.id)} target record is not closed.`);
		}
		if (target.status !== 'built' && target.status !== 'pending-external') {
			throw new TypeError(`The professional native ${String(target.id)} status is invalid.`);
		}
		if (target.status === 'built' && (target.blockedBy !== null
			|| typeof target.toolchainIdentity !== 'string' || !target.payload
			|| !Number.isSafeInteger(target.payload.byteLength) || target.payload.byteLength < 1
			|| !SHA256.test(String(target.payload.sha256))
			|| !validArtifact(target.buildResult,
				`native/soundscaper-professional-host/prebuilt/${target.id}/soundscaper-professional-native-build-result.json`)
				|| (target.id.startsWith('linux-') ? target.osAudioCodec !== null
					: !validArtifact(target.osAudioCodec,
						`native/soundscaper-professional-host/prebuilt/${target.id}/soundscaper_os_audio_codec.node`))
				|| !validArtifact(target.deliveryFilesystem,
					`native/soundscaper-professional-host/prebuilt/${target.id}/soundscaper_delivery_fs${target.id.startsWith('win-') ? '.exe' : ''}`)
			|| !validIsolation(target, value)
				|| !validSourceAuthentication(target.sourceAuthentication, target.id, sourceRegister))) {
			throw new TypeError(`The professional native ${String(target.id)} built record is invalid.`);
		}
		if (target.status === 'pending-external'
			&& (target.sourceAuthentication !== null || target.buildResult !== null || target.payload !== null
					|| target.osAudioCodec !== null || target.pluginPeer !== null
					|| target.deliveryFilesystem !== null || target.isolation !== null)) {
			throw new TypeError(`The pending professional native ${String(target.id)} target cannot claim source authentication.`);
		}
	}
}

function validSourceAuthentication(value, target, sourceRegister) {
	const ids = ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk',
		...(target.startsWith('win-') ? ['asio-sdk'] : []),
		...(target.startsWith('linux-') ? ['lv2'] : [])];
	return value?.schemaVersion === 1 && value.status === 'authenticated'
		&& Array.isArray(value.sources) && value.sources.length === ids.length
		&& ids.every((id) => value.sources.filter((source) => source?.id === id).length === 1)
		&& value.sources.every((source) => {
			const pinned = Array.isArray(sourceRegister?.sources)
				? sourceRegister.sources.filter((entry) => entry?.id === source.id) : [];
			return pinned.length === 1 && source.authenticationStatus === 'authenticated'
			&& Number.isSafeInteger(source.archiveEvidence?.byteLength) && source.archiveEvidence.byteLength > 0
			&& SHA256.test(String(source.archiveEvidence?.sha256))
			&& source.extractedTreeEvidence?.algorithm === 'framescaper-portable-source-tree-sha256-v1'
			&& Number.isSafeInteger(source.extractedTreeEvidence?.fileCount)
			&& source.extractedTreeEvidence.fileCount > 0
			&& SHA256.test(String(source.extractedTreeEvidence?.sha256))
			&& source.archiveEvidence.byteLength === pinned[0].archive?.byteLength
			&& source.archiveEvidence.sha256 === pinned[0].archive?.sha256
			&& source.extractedTreeEvidence.algorithm === pinned[0].extractedTree?.algorithm
			&& source.extractedTreeEvidence.fileCount === pinned[0].extractedTree?.fileCount
			&& source.extractedTreeEvidence.sha256 === pinned[0].extractedTree?.sha256;
		});
}

function validIsolation(target, manifest) {
	const root = `native/soundscaper-professional-host/prebuilt/${target.id}`;
	if (!validArtifact(target.pluginPeer,
		`${root}/${targetExecutableName(manifest.pluginPeer.payloadName, target.id)}`)
		|| !exactKeys(target.isolation,
			['launcher', 'sandboxProfile', 'brokerPolicy', 'entrypointPath', 'runtimeClosure'])
		|| !validArtifact(target.isolation.launcher,
			`${root}/${targetExecutableName(manifest.isolation.launcherName, target.id)}`)
		|| !validArtifact(target.isolation.sandboxProfile, `${root}/${manifest.isolation.profileName}`)
		|| !validArtifact(target.isolation.brokerPolicy, `${root}/${manifest.isolation.brokerPolicyName}`)
		|| !Array.isArray(target.isolation.runtimeClosure) || target.isolation.runtimeClosure.length > 128) return false;
	const prefix = `${root}/${manifest.isolation.runtimeDirectory}/`;
	const paths = target.isolation.runtimeClosure.map(({ path }) => path);
	return paths.length === new Set(paths).size
		&& target.isolation.runtimeClosure.every((entry) => validArtifact(entry) && entry.path.startsWith(prefix))
		&& (target.isolation.entrypointPath === target.pluginPeer.path
			|| paths.includes(target.isolation.entrypointPath));
}

function validArtifact(value, path = null) {
	return exactKeys(value, ['path', 'byteLength', 'sha256'])
		&& typeof value.path === 'string' && !value.path.split('/').includes('..')
		&& (path === null || value.path === path)
		&& Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && SHA256.test(String(value.sha256));
}

function exactKeys(value, fields) {
	return !!value && typeof value === 'object' && !Array.isArray(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function targetExecutableName(name, target) {
	return `${name}${target.startsWith('win-') ? '.exe' : ''}`;
}

async function runtimeArtifact(location, manifest, target, descriptor, readFileImpl, inspect = null) {
	const prefix = `native/soundscaper-professional-host/prebuilt/${target}/`;
	if (!descriptor.path.startsWith(prefix)) throw new Error('A professional native artifact escaped its target root.');
	const path = location.packaged
		? join(location.resourcesPath, 'runtime', manifest.staging.runtimePrefix, target,
			descriptor.path.slice(prefix.length))
		: join(location.applicationRoot, descriptor.path);
	const [bytes, metadata, canonical] = await Promise.all([
		readFileImpl(path), lstat(path, { bigint: true }), realpath(path),
	]);
	if (!metadata.isFile() || metadata.isSymbolicLink() || canonical !== path
		|| bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256) {
		throw new Error(`The professional native artifact at ${path} failed exact authentication.`);
	}
	if (inspect !== null) inspect(bytes);
	return Object.freeze({
		path, byteLength: descriptor.byteLength, sha256: descriptor.sha256,
		identity: Object.freeze({
			dev: BigInt.asUintN(64, metadata.dev).toString(10),
			ino: BigInt.asUintN(64, metadata.ino).toString(10),
		}),
	});
}

function runtimeTarget(platform, arch) {
	const id = platform === 'darwin' ? `mac-${arch}` : platform === 'win32' ? `win-${arch}` : `${platform}-${arch}`;
	return TARGETS.includes(id) ? id : null;
}
function unavailable(reason, detail) { return Object.freeze({ status: 'unavailable', reason, detail }); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
