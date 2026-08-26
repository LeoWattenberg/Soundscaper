/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop composition gives local assistance the authenticated external FFmpeg preference service', async () => {
	const [registration, main] = await Promise.all([
		readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
	]);

	assert.match(registration,
		/import \{ createExternalFfmpegAssistanceShotRuntimeAdapter \} from '\.\/project-library-runtime\/desktop\/assistance-external-ffmpeg-shot-runtime\.js';/u);
	assert.match(registration,
		/createExternalFfmpegAssistanceShotRuntimeAdapter\(\{\s*preferences: externalFfmpegPreferences,?\s*\}\)/u);
	assert.match(registration,
		/createAssistanceOperationService\(\{[\s\S]*?shotDetectionRuntime,[\s\S]*?onProgress,/u);
	assert.match(registration,
		/import \{ ASSISTANCE_WORKFLOW_IPC_CHANNELS, registerAssistanceWorkflowIpc \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-main-ipc\.js';/u);
	assert.match(registration,
		/import \{ AssistanceWorkflowCustody \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-custody\.js';/u);
	assert.match(registration,
		/import \{ createAssistanceWorkflowExecutor \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-executor\.js';/u);
	assert.match(registration,
		/import \{ createAssistanceWorkflowOwnedAudioCutStageRuntime \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-owned-audio-cut-stage-runtime\.js';/u);
	assert.match(registration,
		/import \{ createAssistanceWorkflowOwnedVideoHighlightStageRuntime \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-owned-video-highlight-stage-runtime\.js';/u);
	assert.match(registration,
		/import \{ createAssistanceWorkflowNomicTokenizerResolverV1 \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-nomic-tokenizer-resolver\.js';/u);
	assert.match(registration,
		/createAssistanceWorkflowOwnedAudioCutStageRuntime\(\{[\s\S]*?custody: workflowCustody,[\s\S]*?resolveTokenizer: resolveNomicTokenizer,[\s\S]*?\}\)/u);
	assert.match(registration,
		/createAssistanceWorkflowOwnedVideoHighlightStageRuntime\(\{\s*custody: workflowCustody,?\s*\}\)/u);
	assert.match(registration,
		/deterministicHandlers = Object\.freeze\(\{[\s\S]*?\.\.\.audioCutHandlers,[\s\S]*?\.\.\.videoHighlightHandlers,[\s\S]*?\}\)/u);
	assert.match(registration,
		/const resolveNomicTokenizer = \(request\) => createAssistanceWorkflowNomicTokenizerResolverV1\(\{[\s\S]*?models: createService\(\),[\s\S]*?\}\)\(request\);/u);
	assert.match(registration,
		/createAssistanceWorkflowExecutor\(\{[\s\S]*?resolveCustody:[\s\S]*?runPrimitiveStage:[\s\S]*?deterministicHandlers,/u);
	assert.match(registration,
		/registerAssistanceWorkflowIpc\(\{[\s\S]*?\bon,[\s\S]*?createAssistanceWorkflowService\(\{[\s\S]*?custody: workflowCustody,[\s\S]*?execute: workflowExecute,[\s\S]*?onProgress,[\s\S]*?createTransfers:/u);
	assert.match(registration,
		/createTransfers: \(workflows\) => new AssistanceWorkflowTransfers\(\{[\s\S]*?custody: workflowCustody,[\s\S]*?workflows,[\s\S]*?\}\)/u);
	assert.match(registration, /`Settings: \$\{JSON\.stringify\(request\.settings\)\}`/u);
	assert.equal((registration.match(/new AssistanceStagingRegistry\(/gu) ?? []).length, 1,
		'primitive and aggregate jobs share one authenticated staging authority');
	assert.match(main,
		/registerAssistance\(\{[\s\S]*?externalFfmpegPreferences: externalFfmpegPreferences\.service[\s\S]*?\}\)/u);
});

test('desktop assistance composes lazy runtime families from the truthful shipped supply register', async () => {
	const registration = await readFile(
		new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.match(registration,
		/import \{ createAssistanceRuntimeFamilyDesktopStartup \} from '\.\/project-library-runtime\/desktop\/assistance-runtime-family-startup\.js';/u);
	assert.match(registration,
		/createAssistanceRuntimeFamilyDesktopStartup\(\{[\s\S]*?helperPath:[\s\S]*?assistance-runtime-family-helper-process\.js[\s\S]*?fork:[\s\S]*?totalMemoryBytes:[\s\S]*?availableMemoryBytes:/u);
	assert.match(registration,
		/import assistanceRuntimeFamilySupply from '\.\.\/config\/assistance-runtime-family-supply-candidates\.json' with \{ type: 'json' \};/u);
	assert.match(registration,
		/createAssistanceRuntimeFamilyDesktopStartup\(\{[\s\S]*?manifests: assistanceRuntimeFamilySupply\.manifests,/u);
	assert.match(registration,
		/createAssistanceOperationService\(\{[\s\S]*?additionalRuntime: runtimeFamilies\.operations,[\s\S]*?onProgress,/u);
	assert.match(registration, /runtimeFamilies\.dispose\(\)/u);
});
