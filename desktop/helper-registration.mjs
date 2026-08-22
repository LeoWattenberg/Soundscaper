/* SPDX-License-Identifier: AGPL-3.0-only */

/** Assembles the native probe helper subsystem and registers it on main. */

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import { DesktopHelperProbeService } from './project-library-runtime/desktop/helper-probe-service.js';
import { HelperSupervisor } from './project-library-runtime/desktop/helper-supervisor.js';

/**
 * The helper's engine payload is the digest-pinned FFmpeg core the
 * application already ships: the pins are read from the asar-protected
 * manifest copy, and the bytes on disk are re-verified against them before
 * every spawn, so no unverified byte executes from a helper path.
 */
async function resolveEngineConfig({ desktopRoot, packaged, resourcesPath }) {
	const applicationRoot = dirname(desktopRoot);
	const manifest = JSON.parse(await readFile(join(applicationRoot, 'config/ffmpeg-runtime-manifest.json'), 'utf8'));
	const files = new Map((manifest.runtime?.files ?? []).map((file) => [file.name, file]));
	const engineRoot = packaged
		? join(resourcesPath, 'runtime/ffmpeg', manifest.package.version)
		: join(applicationRoot, 'node_modules/@ffmpeg/core/dist/esm');
	const descriptor = (name) => {
		const pinned = files.get(name);
		if (!pinned) throw new Error(`The runtime manifest does not pin ${name}.`);
		return Object.freeze({ path: join(engineRoot, name), byteLength: pinned.byteLength, sha256: pinned.sha256 });
	};
	return Object.freeze({
		coreJavascript: descriptor('ffmpeg-core.js'),
		coreWasm: descriptor('ffmpeg-core.wasm'),
	});
}

async function verifyEngineDescriptor(descriptor, label) {
	const bytes = await readFile(descriptor.path);
	if (bytes.byteLength !== descriptor.byteLength
		|| createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
		throw new Error(`The ${label} on disk does not match its pinned digest.`);
	}
}

export function registerDesktopHelperProbe({ channels, handle, ownerFor, readCapabilities, settings, desktopRoot, packaged, resourcesPath }) {
	let channel = null;
	const engineConfigPromise = resolveEngineConfig({ desktopRoot, packaged, resourcesPath });
	const supervisor = new HelperSupervisor({
		verifyBinary: async () => {
			const engineConfig = await engineConfigPromise;
			await verifyEngineDescriptor(engineConfig.coreJavascript, 'helper engine JavaScript');
			await verifyEngineDescriptor(engineConfig.coreWasm, 'helper engine wasm');
		},
		spawn: async () => {
			const engineConfig = await engineConfigPromise;
			const child = utilityProcess.fork(
				join(desktopRoot, 'helper-probe-process.js'),
				[`--helper-engine-config=${JSON.stringify(engineConfig)}`],
				{ serviceName: 'soundscaper-probe-helper' },
			);
			channel = child;
			return Object.freeze({
				postMessage: (message, transfer = []) => child.postMessage(message, transfer),
				onMessage: (listener) => child.on('message', listener),
				onExit: (listener) => child.on('exit', (code) => listener(code ?? null)),
				kill: () => child.kill(),
			});
		},
		mintJobId: () => randomBytes(20).toString('hex'),
		sampleRss: () => {
			const pid = channel?.pid;
			if (!pid) return null;
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
	});
	const service = new DesktopHelperProbeService({
		supervisor,
		grants: readCapabilities,
		isEnabled: () => settings.snapshot().nativeProbeHelperEnabled === true,
		mintProbeId: () => randomBytes(20).toString('hex'),
	});
	handle(channels.helperProbeAvailability, () => service.availability());
	handle(channels.helperProbeBegin, (event, value) =>
		service.beginProbe({ owner: ownerFor(event), capabilityId: String(value?.capabilityId || '') }));
	handle(channels.helperProbeAwait, (event, value) =>
		service.awaitProbe({ owner: ownerFor(event), probeId: String(value?.probeId || '') }));
	handle(channels.helperProbeCancel, (event, value) =>
		service.cancelProbe({ owner: ownerFor(event), probeId: String(value?.probeId || '') }));
	return service;
}
