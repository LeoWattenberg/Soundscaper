/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Assembles the assistance subsystem and registers it on the main process.
 *
 * The composition root stays a list of registrations rather than the place
 * each subsystem's dependencies are gathered, so everything assistance needs —
 * its catalog, runtime supply, licensing register, and speech adapter — is
 * assembled here and main names the subsystem once.
 */

import { constants as osConstants, freemem, setPriority, totalmem } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { powerMonitor, utilityProcess } from 'electron/main';

import assistanceCatalog from '../config/local-model-catalog.json' with { type: 'json' };
import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import assistanceRuntimeFamilySupply from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import licensingMatrix from '../config/production-licensing-matrix.json' with { type: 'json' };
import {
	assistanceNativeRuntimeTargetId,
	verifyAssistanceNativeRuntimePayload,
} from './assistance-native-runtime-payload.mjs';
import { createAssistanceHelperRuntimeAdapter } from './project-library-runtime/desktop/assistance-helper-runtime.js';
import { createAssistanceJobHost } from './project-library-runtime/desktop/assistance-job-host.js';
import { assistanceServiceFrom, registerAssistanceIpc } from './project-library-runtime/desktop/assistance-main-ipc.js';
import { createExternalFfmpegAssistanceShotRuntimeAdapter } from './project-library-runtime/desktop/assistance-external-ffmpeg-shot-runtime.js';
import { createExternalFfmpegAssistanceVideoMaterializer } from './project-library-runtime/desktop/assistance-external-ffmpeg-video-materializer.js';
import { ASSISTANCE_OPERATION_IPC_CHANNELS, registerAssistanceOperationIpc } from './project-library-runtime/desktop/assistance-operation-main-ipc.js';
import { createAssistanceOperationService } from './project-library-runtime/desktop/assistance-operation-service.js';
import { applyAssistanceBackgroundPriority, normalizeAssistanceThermalState } from './project-library-runtime/desktop/assistance-power-etiquette-v1.js';
import { createAssistanceRuntimeFamilyDesktopStartup } from './project-library-runtime/desktop/assistance-runtime-family-startup.js';
import { createAssistanceSemanticQueryExecutorV1 } from './project-library-runtime/desktop/assistance-semantic-query-executor.js';
import { AssistanceWorkflowCustody } from './project-library-runtime/desktop/assistance-workflow-custody.js';
import { createAssistanceWorkflowExecutor } from './project-library-runtime/desktop/assistance-workflow-executor.js';
import { ASSISTANCE_WORKFLOW_IPC_CHANNELS, registerAssistanceWorkflowIpc } from './project-library-runtime/desktop/assistance-workflow-main-ipc.js';
import { createAssistanceWorkflowNomicTokenizerResolverV1 } from './project-library-runtime/desktop/assistance-workflow-nomic-tokenizer-resolver.js';
import { createAssistanceWorkflowOperationStageRuntime } from './project-library-runtime/desktop/assistance-workflow-operation-stage-runtime.js';
import { createAssistanceWorkflowOwnedAudioCutStageRuntime } from './project-library-runtime/desktop/assistance-workflow-owned-audio-cut-stage-runtime.js';
import { createAssistanceWorkflowOwnedVideoHighlightStageRuntime } from './project-library-runtime/desktop/assistance-workflow-owned-video-highlight-stage-runtime.js';
import { createAssistanceWorkflowService } from './project-library-runtime/desktop/assistance-workflow-service.js';
import { AssistanceWorkflowTransfers } from './project-library-runtime/desktop/assistance-workflow-transfers.js';
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

async function confirmWorkflow(dialog, window, request, stages) {
	const options = {
		type: 'question',
		title: 'Local Assistance consent',
		message: 'Run this exact Local Assistance workflow?',
		detail: [
			`Workflow: ${request.workflowId}`,
			`Stages: ${stages.map(({ stageId }) => stageId).join(', ')}`,
			`Settings: ${JSON.stringify(request.settings)}`,
			`Selected ranges: ${request.fence.sourceRanges.map((range) =>
				`${range.mediaKind} ${range.sourceStartFrame}–${range.sourceEndFrame}`).join(', ')}`,
			`Timeline items: ${request.fence.sourceRanges.reduce((count, range) =>
				count + range.occurrenceIds.length, 0)}`,
			`Models: ${request.models.map(({ stageId, modelId, version }) =>
				`${stageId}: ${modelId} ${version}`).join(', ') || 'none'}`,
			`Outputs: ${request.outputs.map(({ stageId, slotId }) => `${stageId}: ${slotId}`).join(', ')}`,
		].join('\n'),
		buttons: ['Run workflow locally', 'Cancel'],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
	};
	const result = await (window
		? dialog.showMessageBox(window, options)
		: dialog.showMessageBox(options));
	return result?.response === 0;
}

const POWER_ETIQUETTE_EVENTS = Object.freeze(['on-ac', 'on-battery', 'thermal-state-change']);

/**
 * Optional inference is background work. It runs below the editor's scheduling
 * priority, and the runtime-family router holds new jobs while the machine is on
 * battery or reports serious thermal pressure.
 */
function assistancePowerEtiquette() {
	return Object.freeze({
		observe: () => Object.freeze({
			onBatteryPower: powerMonitor.isOnBatteryPower() === true,
			thermalState: normalizeAssistanceThermalState(
				typeof powerMonitor.getCurrentThermalState === 'function'
					? powerMonitor.getCurrentThermalState() : 'unknown',
			),
		}),
		subscribe: (listener) => {
			for (const event of POWER_ETIQUETTE_EVENTS) powerMonitor.on(event, listener);
			return () => {
				for (const event of POWER_ETIQUETTE_EVENTS) powerMonitor.off(event, listener);
			};
		},
	});
}

function assistanceBackgroundPriority(pid) {
	applyAssistanceBackgroundPriority(pid, setPriority, osConstants.priority.PRIORITY_BELOW_NORMAL);
}

export function registerAssistance({
	channels, handle, on, sendToRenderer, app, settings, dialog, windowFor,
	externalFfmpegPreferences,
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
			assistanceBackgroundPriority(forked.pid);
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
	const shotDetectionRuntime = createExternalFfmpegAssistanceShotRuntimeAdapter({
		preferences: externalFfmpegPreferences,
	});
	const runtimeFamilies = createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot,
		manifests: assistanceRuntimeFamilySupply.manifests,
		helperPath: join(
			import.meta.dirname,
			'project-library-runtime',
			'desktop',
			'assistance-runtime-family-helper-process.js',
		),
		fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
		sampleRss: (pid) => {
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
		applyBackgroundPriority: assistanceBackgroundPriority,
		powerEtiquette: assistancePowerEtiquette(),
		totalMemoryBytes: totalmem,
		availableMemoryBytes: freemem,
	});
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
	const staging = new AssistanceStagingRegistry({
		root: resolve(join(app.getPath('userData'), 'assistance-staging-v1')),
	});
	let semanticQueryExecutor = null;
	const semanticQuery = Object.freeze({ embed: (request) => {
		semanticQueryExecutor ??= createAssistanceSemanticQueryExecutorV1({
			registry: staging, models: createService(), runtime: runtimeFamilies.operations,
		});
		return semanticQueryExecutor.embed(request);
	} });
	let operations = null;
	let publishOperationProgress = null;
	const resolveOperations = (onProgress = null) => {
		if (onProgress) publishOperationProgress = onProgress;
		operations ??= createAssistanceOperationService({
			registry: staging,
			models: createService(),
			runtime,
			voiceActivityRuntime: runtime,
			diarizationRuntime: runtime,
			shotDetectionRuntime,
			additionalRuntime: runtimeFamilies.operations,
			onProgress: (progress) => publishOperationProgress?.(progress),
		});
		return operations;
	};
	const operationIpc = registerAssistanceOperationIpc({
		channels: ASSISTANCE_OPERATION_IPC_CHANNELS,
		handle,
		on,
		sendToRenderer,
		createOperations: (onProgress) => resolveOperations(onProgress),
		confirmOperation: (request) => confirmOperation(dialog, windowFor(), request),
	});
	const workflowCustody = new AssistanceWorkflowCustody({ staging });
	const workflowPrimitive = createAssistanceWorkflowOperationStageRuntime({
		operations: Object.freeze({
			executeStaged: (request, signal) => resolveOperations().executeStaged(request, signal),
		}),
		custody: workflowCustody,
	});
	const resolveNomicTokenizer = (request) => createAssistanceWorkflowNomicTokenizerResolverV1({
		models: createService(),
	})(request);
	const audioCutHandlers = createAssistanceWorkflowOwnedAudioCutStageRuntime({
		custody: workflowCustody,
		resolveTokenizer: resolveNomicTokenizer,
	});
	const videoMaterializer = createExternalFfmpegAssistanceVideoMaterializer({
		preferences: externalFfmpegPreferences,
	});
	const videoHighlightHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
		custody: workflowCustody,
		materializer: videoMaterializer,
	});
	const deterministicHandlers = Object.freeze({
		...audioCutHandlers,
		...videoHighlightHandlers,
	});
	const workflowExecute = createAssistanceWorkflowExecutor({
		resolveCustody: (stage) => workflowCustody.resolveStage(stage),
		runPrimitiveStage: workflowPrimitive,
		deterministicHandlers,
	});
	const workflowIpc = registerAssistanceWorkflowIpc({
		channels: ASSISTANCE_WORKFLOW_IPC_CHANNELS,
		handle,
		on,
		sendToRenderer,
		createWorkflows: (onProgress) => createAssistanceWorkflowService({
			custody: workflowCustody,
			execute: workflowExecute,
			onProgress,
		}),
		createTransfers: (workflows) => new AssistanceWorkflowTransfers({
			custody: workflowCustody,
			workflows,
		}),
		confirmWorkflow: (request, stages) => confirmWorkflow(dialog, windowFor(), request, stages),
	});
	return Object.freeze({ semanticQuery, dispose: async () => {
		await workflowIpc.dispose();
		await operationIpc.dispose();
		await operations?.dispose();
		runtimeFamilies.dispose();
		runtime.dispose();
	} });
}
