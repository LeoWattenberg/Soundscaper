/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron process seams for the authenticated Framescaper native-media pool. */

import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import {
	startFramescaperNativeMediaRuntime,
} from './project-library-runtime/desktop/native-media-runtime.js';

export async function startFramescaperNativeMediaElectronRuntime(options = {}) {
	const desktopRoot = import.meta.dirname;
	const children = new Map();
	const runtime = await startFramescaperNativeMediaRuntime({
		location: {
			applicationRoot: dirname(desktopRoot),
			packaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			platform: process.platform,
			arch: process.arch,
		},
		...(options.size === undefined ? {} : { size: options.size }),
		spawnHelper(descriptor, index) {
			const child = utilityProcess.fork(
				join(desktopRoot, 'native-media-helper-process.js'),
				[`--framescaper-media-host-config=${JSON.stringify(descriptor)}`],
				{ serviceName: `framescaper-native-media-${String(index + 1)}` },
			);
			children.set(index, child);
			child.once('exit', () => { if (children.get(index) === child) children.delete(index); });
			return Object.freeze({
				postMessage: (message, transfer = []) => child.postMessage(message, transfer),
				onMessage: (listener) => child.on('message', listener),
				onExit: (listener) => child.on('exit', (code) => listener(code ?? null)),
				kill: () => child.kill(),
			});
		},
		sampleRss(index) {
			const pid = children.get(index)?.pid;
			if (!pid) return null;
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
	});
	return runtime;
}
