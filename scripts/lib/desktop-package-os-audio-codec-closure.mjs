/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runtime-manifest authority for the codec-only OS addon package subtree. */

import {
	OS_AUDIO_CODEC_NATIVE_ADDON_VERSION, OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME,
	OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME, OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX,
	OS_AUDIO_CODEC_NATIVE_TARGETS,
} from './os-audio-codec-native-payload.mjs';

const SHA256 = /^[a-f\d]{64}$/u;

export function assertDesktopPackageOsAudioCodecClosure({
	runtime, target, requireFile, expectedByPrefix,
}) {
	const summary = runtime.osAudioCodecNative;
	const prefix = `runtime/${OS_AUDIO_CODEC_NATIVE_RUNTIME_PREFIX}/`;
	expectedByPrefix.set(prefix, new Set());
	if (runtime.productId === 'framescaper' && summary !== null) {
		throw new Error('The Framescaper runtime manifest carries OS audio codec native authority.');
	}
	if (summary === null) return;
	if (!OS_AUDIO_CODEC_NATIVE_TARGETS.includes(target)
		|| !exactRecord(summary, [
			'target', 'status', 'payloadManifest', 'payload', 'sourceRevision',
			'buildPlanSha256', 'nativeCanary', 'codeSeal',
		]) || summary.target !== target || summary.status !== 'built'
		|| !exactRecord(summary.payloadManifest, ['id', 'name', 'byteLength', 'sha256'])
		|| !exactRecord(summary.payload, ['name', 'byteLength', 'sha256'])
		|| summary.payloadManifest.id !== `soundscaper-os-audio-codec-native-${OS_AUDIO_CODEC_NATIVE_ADDON_VERSION}`
		|| summary.payloadManifest.name !== OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME
		|| summary.payload.name !== OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME
		|| !SHA256.test(String(summary.sourceRevision))
		|| !SHA256.test(String(summary.buildPlanSha256)) || summary.nativeCanary !== 'passed'
		|| !validCodeSeal(summary.codeSeal, target)) {
		throw new Error(`The desktop runtime manifest has invalid OS audio codec native evidence for ${target}.`);
	}
	const targetPrefix = `${prefix}${target}/`;
	requireFile(`${targetPrefix}${OS_AUDIO_CODEC_NATIVE_MANIFEST_NAME}`, summary.payloadManifest,
		'OS audio codec native manifest', prefix);
	requireFile(`${targetPrefix}${OS_AUDIO_CODEC_NATIVE_PAYLOAD_NAME}`, summary.payload,
		'OS audio codec native payload', prefix);
}

function exactRecord(value, fields) {
	return plainRecord(value)
		&& JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function validCodeSeal(value, target) {
	if (!exactRecord(value, ['mode', 'verificationStatus'])) return false;
	if (target.startsWith('win-')) return value.mode === 'not-applicable'
		&& value.verificationStatus === 'not-applicable';
	return value.mode === 'ad-hoc' && value.verificationStatus === 'passed';
}

function plainRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
