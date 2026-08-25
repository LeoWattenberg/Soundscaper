/* SPDX-License-Identifier: AGPL-3.0-only */

/** Desktop-build handoff for the target-built Media Foundation/AudioToolbox addon. */

import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	OS_AUDIO_CODEC_NATIVE_TARGETS,
	osAudioCodecNativePayloadOutputRoot,
	stageVerifiedOsAudioCodecNativePayload,
	verifyOsAudioCodecNativeBuildResult,
} from './os-audio-codec-native-payload.mjs';

const DESKTOP_TARGETS = new Set([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
]);
const MAXIMUM_RESULT_BYTES = 256 * 1024;

export function resolveDesktopOsAudioCodecNativeRequirement(value) {
	if (value === undefined || value === null || value === '' || value === 'false') return false;
	if (value === 'true') return true;
	throw new TypeError('The OS audio codec native release requirement is invalid.');
}

export async function prepareDesktopOsAudioCodecNativeRelease({
	buildResultPath, target, required,
}) {
	const selectedTarget = desktopTarget(target);
	if (typeof required !== 'boolean') {
		throw new TypeError('The OS audio codec native required flag is invalid.');
	}
	const supported = OS_AUDIO_CODEC_NATIVE_TARGETS.includes(selectedTarget);
	if (!supported) {
		if (buildResultPath !== null && buildResultPath !== undefined && buildResultPath !== '') {
			throw new TypeError('Linux desktop targets cannot stage an operating-system audio codec payload.');
		}
		return null;
	}
	if (buildResultPath === null || buildResultPath === undefined || buildResultPath === '') {
		if (required) {
			throw new Error(`Desktop packaging for ${selectedTarget} requires a target-built OS audio codec payload.`);
		}
		return null;
	}
	const resultPath = absolutePath(buildResultPath, 'build-result path');
	const bytes = await readCanonicalResult(resultPath);
	let build;
	try { build = JSON.parse(String(bytes)); }
	catch (error) { throw new Error('The OS audio codec native build result is not valid JSON.', { cause: error }); }
	if (!bytes.equals(Buffer.from(`${JSON.stringify(build, null, 2)}\n`))) {
		throw new TypeError('The OS audio codec native build result is not canonical JSON.');
	}
	return verifyOsAudioCodecNativeBuildResult({
		build,
		target: selectedTarget,
		sourceRevision: build?.sourceRevision,
		buildPlanSha256: build?.buildPlanSha256,
	});
}

export async function stageDesktopOsAudioCodecNativeRelease({ release, runtimeRoot }) {
	const outputRoot = osAudioCodecNativePayloadOutputRoot(
		absolutePath(runtimeRoot, 'runtime root'), release,
	);
	return stageVerifiedOsAudioCodecNativePayload({ release, outputRoot });
}

async function readCanonicalResult(path) {
	const first = await lstat(path);
	if (!first.isFile() || first.isSymbolicLink() || await realpath(path) !== path
		|| !Number.isSafeInteger(Number(first.size)) || Number(first.size) < 2
		|| Number(first.size) > MAXIMUM_RESULT_BYTES) {
		throw new Error('The OS audio codec native build result is not one bounded canonical regular file.');
	}
	const bytes = await readFile(path);
	const second = await lstat(path);
	if (!second.isFile() || second.isSymbolicLink()
		|| Number(first.dev) !== Number(second.dev) || Number(first.ino) !== Number(second.ino)
		|| Number(first.size) !== Number(second.size) || Number(first.mtimeMs) !== Number(second.mtimeMs)
		|| bytes.byteLength !== Number(first.size)) {
		throw new Error('The OS audio codec native build result changed while it was reopened.');
	}
	return bytes;
}

function desktopTarget(value) {
	if (typeof value !== 'string' || !DESKTOP_TARGETS.has(value)) {
		throw new TypeError(`Unsupported desktop OS audio codec target ${String(value)}.`);
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0') || Buffer.byteLength(value) > 4_096) {
		throw new TypeError(`The OS audio codec native ${label} is invalid.`);
	}
	return value;
}
