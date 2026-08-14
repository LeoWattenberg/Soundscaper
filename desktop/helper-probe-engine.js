/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The probe engine that runs inside the helper's per-job worker thread. It
 * refuses to execute an engine payload whose bytes do not match the digests
 * the application shipped with, re-verifies the granted file's identity
 * after reopening it, and probes with the same digest-pinned FFmpeg wasm
 * core and the same timing/characteristics parsers the renderer uses — so
 * native-path results are the renderer contract's exact-or-unreported
 * probed truth, never a second opinion.
 */

import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
	buildFfmpegVideoTimingProbeArgs,
	parseFfmpegVideoTimingLogs,
} from '#desktop-runtime/ffmpeg-video-timing-probe';
import {
	isFfmpegSourceCharacteristicsLog,
	parseFfmpegVideoSourceCharacteristics,
} from '#desktop-runtime/ffmpeg-video-source-characteristics';
import { encodeVideoTimingAsset } from '#desktop-runtime/video-timing-asset';

export function validateHelperEngineConfig(value) {
	const record = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
	const descriptors = [record?.coreJavascript, record?.coreWasm].map((descriptor) => {
		if (!descriptor || typeof descriptor !== 'object'
			|| typeof descriptor.path !== 'string' || !descriptor.path
			|| !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength <= 0
			|| typeof descriptor.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(descriptor.sha256)) {
			throw new TypeError('The helper engine config must pin both core files by path, byte length, and digest.');
		}
		return Object.freeze({ path: descriptor.path, byteLength: descriptor.byteLength, sha256: descriptor.sha256 });
	});
	return Object.freeze({ coreJavascript: descriptors[0], coreWasm: descriptors[1] });
}

/** Reads one pinned engine file and fails closed on any byte difference. */
async function readVerifiedEngineFile(descriptor, label) {
	const bytes = await readFile(descriptor.path);
	if (bytes.byteLength !== descriptor.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
		const error = new Error(`The helper ${label} does not match its pinned digest.`);
		error.code = 'HELPER_ENGINE_BINARY_MISMATCH';
		throw error;
	}
	return bytes;
}

export async function probeVideoSourceWithFfmpegCore({ engineConfig, grant }) {
	const config = validateHelperEngineConfig(engineConfig);
	const [coreJavascript, wasmBinary] = await Promise.all([
		readVerifiedEngineFile(config.coreJavascript, 'engine JavaScript'),
		readVerifiedEngineFile(config.coreWasm, 'engine wasm'),
	]);
	const input = await readGrantedMedia(grant);
	const core = await loadFfmpegCore(config.coreJavascript.path, coreJavascript, wasmBinary);
	const logs = [];
	core.setLogger(({ message }) => {
		if (typeof message !== 'string') return;
		if (message.includes('showinfo') || /config in time_base:/u.test(message)
			|| isFfmpegSourceCharacteristicsLog(message)) {
			logs.push(message);
		}
	});
	const inputName = `probe-input${safeExtension(grant.mediaPath)}`;
	core.FS.writeFile(inputName, input);
	const exitCode = core.exec(...buildFfmpegVideoTimingProbeArgs(inputName));
	if (exitCode !== 0) {
		throw new Error(`The probe run exited with FFmpeg status ${String(exitCode)}.`);
	}
	const timing = parseFfmpegVideoTimingLogs(logs);
	const characteristics = parseFfmpegVideoSourceCharacteristics(logs, { rate: timing.nominalRate });
	return Object.freeze({
		timingAsset: encodeVideoTimingAsset(timing),
		nominalRate: { num: timing.nominalRate.num, den: timing.nominalRate.den },
		characteristics,
	});
}

/**
 * Opens the granted path, proves it is still the exact file main granted
 * (device, inode, and declared size), and reads it through that handle so
 * the verified identity cannot be swapped out from under the read.
 */
async function readGrantedMedia(grant) {
	const handle = await open(grant.mediaPath, 'r');
	try {
		const details = await handle.stat();
		if (!details.isFile() || details.dev !== grant.identity.dev || details.ino !== grant.identity.ino
			|| details.size !== grant.mediaBytes) {
			const error = new Error('The granted media file no longer matches its captured identity.');
			error.code = 'HELPER_GRANT_IDENTITY_MISMATCH';
			throw error;
		}
		return await handle.readFile();
	} finally {
		await handle.close();
	}
}

async function loadFfmpegCore(corePath, coreJavascript, wasmBinary) {
	// The pinned core is an Emscripten web/worker build; a Node-style process
	// provides the two globals it expects at module scope. The digest-verified
	// bytes themselves are executed via a data: import and the verified wasm
	// bytes are injected directly, so nothing re-read from disk can diverge
	// from what was verified.
	globalThis.self = globalThis.self ?? globalThis;
	globalThis.location = globalThis.location ?? new URL(pathToFileURL(corePath));
	const module = await import(`data:text/javascript;base64,${coreJavascript.toString('base64')}`);
	const createFFmpegCore = module.default;
	if (typeof createFFmpegCore !== 'function') {
		throw new TypeError('The helper engine payload does not export an FFmpeg core factory.');
	}
	return createFFmpegCore({ wasmBinary });
}

function safeExtension(mediaPath) {
	const match = /\.([A-Za-z0-9]{1,8})$/u.exec(mediaPath);
	return match ? `.${match[1].toLowerCase()}` : '';
}

const { isMainThread, parentPort: threadPort, workerData } = await import('node:worker_threads');
if (!isMainThread && threadPort && workerData) {
	try {
		const result = await probeVideoSourceWithFfmpegCore({
			engineConfig: workerData.engineConfig,
			grant: workerData.grant,
		});
		threadPort.postMessage({ ok: true, result }, [result.timingAsset.buffer]);
	} catch (error) {
		threadPort.postMessage({
			ok: false,
			name: error instanceof Error && error.name ? error.name : 'Error',
			message: error instanceof Error ? error.message : String(error),
			...(typeof error?.code === 'string' ? { code: error.code } : {}),
		});
	}
}
