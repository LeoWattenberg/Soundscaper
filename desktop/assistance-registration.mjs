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
import { isAbsolute, join, resolve } from 'node:path';

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
import { ASSISTANCE_OPERATION_IPC_CHANNELS, registerAssistanceOperationIpc } from './project-library-runtime/desktop/assistance-operation-main-ipc.js';
import { createAssistanceOperationService } from './project-library-runtime/desktop/assistance-operation-service.js';
import { AssistanceStagingRegistry } from './project-library-runtime/desktop/assistance-staging-registry.js';

/**
 * The service is built on first use, so a user who never opens assistance pays
 * no filesystem access, catalog validation, or runtime probe for it.
 */
function nativeDirectory(result) {
	if (!result || result.canceled === true) return null;
	if (!Array.isArray(result.filePaths) || result.filePaths.length !== 1
		|| typeof result.filePaths[0] !== 'string' || !isAbsolute(result.filePaths[0])
		|| result.filePaths[0].length > 4_096 || result.filePaths[0].includes('\0')) {
		throw new TypeError('The assistance directory selection result is invalid.');
	}
	return resolve(result.filePaths[0]);
}

async function chooseDirectory(dialog, window, title) {
	const options = {
		title,
		properties: ['openDirectory', 'createDirectory'],
	};
	return nativeDirectory(await (window
		? dialog.showOpenDialog(window, options)
		: dialog.showOpenDialog(options)));
}

async function confirmOperation(dialog, window, request) {
	const selection = request.selectionFence;
	const options = {
		type: 'question',
		title: 'Local Assistance consent',
		message: 'Process this exact media selection locally?',
		detail: [
			`Operation: ${request.operation}`,
			`Selected range: ${selection.sourceStartFrame}–${selection.sourceEndFrame} frames`,
			`Timeline items: ${selection.occurrenceIds.length}`,
			`Model: ${request.models.map(({ modelId, version }) => `${modelId} ${version}`).join(', ') || 'none'}`,
		].join('\n'),
		buttons: ['Run locally', 'Cancel'],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	};
	const result = await (window
		? dialog.showMessageBox(window, options)
		: dialog.showMessageBox(options));
	return result?.response === 0;
}

export function registerAssistance({
	channels, handle, on, sendToRenderer, app, settings, dialog, windowFor,
}) {
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
	let service = null;
	const createService = () => {
		service ??= assistanceServiceFrom({
			userDataPath: app.getPath('userData'),
			settingsDirectory: settings.snapshot().modelsDirectory,
			catalog: assistanceCatalog,
			licensingMatrix,
			runtime,
			totalMemoryBytes: totalmem(),
			persistModelsDirectory: (directory) => settings.setModelsDirectory(directory),
		});
		return service;
	};
	registerAssistanceIpc({
		channels,
		handle,
		sendToRenderer,
		choosePreseedDirectory: () => chooseDirectory(
			dialog, windowFor(), 'Choose offline local-model files',
		),
		chooseRelocationDirectory: async () => {
			const parent = await chooseDirectory(
				dialog, windowFor(), 'Choose parent folder for local-model storage',
			);
			return parent === null ? null : join(parent, 'Soundscaper Local Models');
		},
		createService,
	});
	const operationIpc = registerAssistanceOperationIpc({
		channels: ASSISTANCE_OPERATION_IPC_CHANNELS,
		handle,
		on,
		sendToRenderer,
		createOperations: (onProgress) => createAssistanceOperationService({
			registry: new AssistanceStagingRegistry({
				root: resolve(join(app.getPath('userData'), 'assistance-staging-v1')),
			}),
			models: createService(),
			runtime,
			voiceActivityRuntime: runtime,
			onProgress,
		}),
		confirmOperation: (request) => confirmOperation(dialog, windowFor(), request),
	});
	return Object.freeze({ dispose: async () => { await operationIpc.dispose(); runtime.dispose(); } });
}
