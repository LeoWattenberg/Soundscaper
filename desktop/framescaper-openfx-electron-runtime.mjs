/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron-only spawn authority for authenticated OpenFX utility processes. */

import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import {
	startFramescaperOpenFxRuntime,
} from './project-library-runtime/desktop/framescaper-openfx-runtime.js';

export async function startFramescaperOpenFxElectronRuntime(options = {}) {
	const desktopRoot = import.meta.dirname;
	const children = new Map();
	const runtime = await startFramescaperOpenFxRuntime({
		location: {
			applicationRoot: dirname(desktopRoot),
			packaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			externalRuntimeRoot: app.isPackaged
				? join(process.resourcesPath, 'runtime')
				: join(dirname(desktopRoot), '..', 'runtime'),
			platform: process.platform,
			arch: process.arch,
		},
		...(options.maximumRuntimeProcesses === undefined
			? {} : { maximumRuntimeProcesses: options.maximumRuntimeProcesses }),
		spawnHelper(descriptor, mode, pluginFingerprint, processIdentity) {
			const child = utilityProcess.fork(
				join(desktopRoot, 'openfx-helper-process.js'),
				[`--framescaper-openfx-config=${JSON.stringify({
					descriptor, mode, pluginFingerprint,
				})}`],
				{ serviceName: mode === 'scanner'
					? 'framescaper-openfx-scanner'
					: 'framescaper-openfx-fingerprint-runtime' },
			);
			children.set(processIdentity, child);
			child.once('exit', () => {
				if (children.get(processIdentity) === child) children.delete(processIdentity);
			});
			return Object.freeze({
				postMessage: (message, transfer = []) => child.postMessage(message, transfer),
				onMessage: (listener) => child.on('message', listener),
				onExit: (listener) => child.on('exit', (code) => listener(code ?? null)),
				kill: () => child.kill(),
			});
		},
		sampleRss(_mode, _pluginFingerprint, processIdentity) {
			const pid = children.get(processIdentity)?.pid;
			if (!pid) return null;
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
	});
	return runtime;
}
