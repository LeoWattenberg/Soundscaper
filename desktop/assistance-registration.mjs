/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Assembles the assistance subsystem and registers it on the main process.
 *
 * The composition root stays a list of registrations rather than the place
 * each subsystem's dependencies are gathered, so everything assistance needs —
 * its catalog, the licensing register it is validated against, and the speech
 * runtime adapter — is assembled here and main names the subsystem once.
 */

import { totalmem } from 'node:os';
import { join } from 'node:path';

import { utilityProcess } from 'electron/main';

import assistanceCatalog from '../config/local-model-catalog.json' with { type: 'json' };
import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import licensingMatrix from '../config/production-licensing-matrix.json' with { type: 'json' };
import {
	assistanceNativeRuntimeTargetId,
	verifyAssistanceNativeRuntimePayload,
} from './assistance-native-runtime-payload.mjs';
import { createAssistanceHelperRuntimeAdapter } from './project-library-runtime/desktop/assistance-helper-runtime.js';
import { createAssistanceJobHost } from './project-library-runtime/desktop/assistance-job-host.js';
import { assistanceServiceFrom, registerAssistanceIpc } from './project-library-runtime/desktop/assistance-main-ipc.js';

/**
 * The service is built on first use, so a user who never opens assistance pays
 * no filesystem access, catalog validation, or runtime probe for it.
 */
export function registerAssistance({ channels, handle, sendToRenderer, app, settings }) {
	let child = null;
	const runtimeRoot = join(process.resourcesPath, 'runtime');
	const targetId = assistanceNativeRuntimeTargetId({ platform: process.platform, arch: process.arch });
	const host = createAssistanceJobHost({
		// The executable closure stays outside the asar, so main authenticates every
		// pinned byte immediately before the helper is spawned. The inference worker
		// repeats the audit before it imports the native module.
		verifyBinary: async () => {
			await verifyAssistanceNativeRuntimePayload({
				manifest: assistanceNativeRuntimeManifest,
				targetId,
				outputRoot: runtimeRoot,
			});
		},
		spawn: () => {
			const forked = utilityProcess.fork(
				join(import.meta.dirname, 'assistance-helper-process.js'),
				[],
				{
					serviceName: 'soundscaper-assistance-speech-helper',
					env: {
						...process.env,
						SOUNDSCAPER_ASSISTANCE_RUNTIME_ROOT: runtimeRoot,
						SOUNDSCAPER_ASSISTANCE_RUNTIME_TARGET: targetId,
					},
				},
			);
			child = forked;
			return Object.freeze({
				postMessage: (message, transfer = []) => forked.postMessage(message, transfer),
				onMessage: (listener) => forked.on('message', listener),
				onExit: (listener) => forked.on('exit', (code) => listener(code ?? null)),
				kill: () => forked.kill(),
			});
		},
		sampleRss: () => {
			const pid = child?.pid;
			if (!pid) return null;
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
	});
	const runtime = createAssistanceHelperRuntimeAdapter({ host });
	registerAssistanceIpc({
		channels,
		handle,
		sendToRenderer,
		createService: () => assistanceServiceFrom({
			userDataPath: app.getPath('userData'),
			settingsDirectory: settings.snapshot().modelsDirectory,
			catalog: assistanceCatalog,
			licensingMatrix,
			runtime,
			totalMemoryBytes: totalmem(),
		}),
	});
	return Object.freeze({ dispose: () => runtime.dispose() });
}
