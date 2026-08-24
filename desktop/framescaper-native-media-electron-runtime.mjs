/* SPDX-License-Identifier: AGPL-3.0-only */

/** Electron process seams for the authenticated Framescaper native-media pool. */

import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import {
	startFramescaperNativeMediaRuntime,
} from './project-library-runtime/desktop/native-media-runtime.js';
import { createFramescaperMediaReviewPayloadPorts } from './framescaper-media-review-policy.mjs';

export async function startFramescaperNativeMediaElectronRuntime(options = {}) {
	const desktopRoot = import.meta.dirname;
	const applicationRoot = dirname(desktopRoot);
	const location = Object.freeze({
		applicationRoot,
		packaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
		externalRuntimeRoot: app.isPackaged
			? join(process.resourcesPath, 'runtime')
			: join(dirname(desktopRoot), '..', 'runtime'),
		platform: process.platform,
		arch: process.arch,
	});
	const children = new Map();
	const runtime = await startFramescaperNativeMediaRuntime({
		location,
		...(options.enabled === undefined ? {} : { enabled: options.enabled }),
		payloadPorts: createFramescaperMediaReviewPayloadPorts({
			applicationRoot,
			packaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			platform: process.platform,
			arch: process.arch,
		}),
		...(options.size === undefined ? {} : { size: options.size }),
		...(options.v14 === undefined ? {} : { v14: options.v14 }),
		spawnHelper(descriptor, index) {
			const helperConfig = Object.freeze({
				location,
				expected: Object.freeze({
					target: descriptor.target, runtime: descriptor.runtime,
					path: descriptor.path, byteLength: descriptor.byteLength,
					sha256: descriptor.sha256, hostVersion: descriptor.hostVersion,
					ffmpegVersion: descriptor.ffmpegVersion, identity: descriptor.identity,
				}),
			});
			const child = utilityProcess.fork(
				join(desktopRoot, 'native-media-helper-process.js'),
				[`--framescaper-media-host-config=${JSON.stringify(helperConfig)}`],
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
