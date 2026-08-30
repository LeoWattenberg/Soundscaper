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
		/import \{ createExternalFfmpegAssistanceVideoMaterializer \} from '\.\/project-library-runtime\/desktop\/assistance-external-ffmpeg-video-materializer\.js';/u);
	assert.match(registration,
		/import \{ createAssistanceWorkflowNomicTokenizerResolverV1 \} from '\.\/project-library-runtime\/desktop\/assistance-workflow-nomic-tokenizer-resolver\.js';/u);
	assert.match(registration,
		/createAssistanceWorkflowOwnedAudioCutStageRuntime\(\{[\s\S]*?custody: workflowCustody,[\s\S]*?resolveTokenizer: resolveNomicTokenizer,[\s\S]*?\}\)/u);
	assert.match(registration,
		/createAssistanceWorkflowOwnedVideoHighlightStageRuntime\(\{[\s\S]*?custody: workflowCustody,[\s\S]*?materializer: videoMaterializer,[\s\S]*?\}\)/u);
	assert.match(registration,
		/createExternalFfmpegAssistanceVideoMaterializer\(\{\s*preferences: externalFfmpegPreferences,?\s*\}\)/u);
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

test('indexed search receives one lazy installed-only runtime query executor', async () => {
	const [registration, main] = await Promise.all([
		readFile(new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(registration,
		/import \{ createAssistanceSemanticQueryExecutorV1 \} from '\.\/project-library-runtime\/desktop\/assistance-semantic-query-executor\.js';/u);
	assert.match(registration,
		/semanticQueryExecutor \?\?= createAssistanceSemanticQueryExecutorV1\(\{\s*registry: staging, models: createService\(\), runtime: runtimeFamilies\.operations,/u);
	assert.match(registration, /return Object\.freeze\(\{ semanticQuery, dispose:/u);
	assert.match(main,
		/registerAssistanceSemanticSearchMainIpc\(\{[^}]*query: assistance\.semanticQuery/u);
	assert.ok(main.indexOf("name: 'assistance semantic search'")
		< main.indexOf("name: 'assistance'"),
		'assistance query cancellation must drain before its shared runtime families');
});

test('every assistance helper is composed as background work the machine can pause', async () => {
	const registration = await readFile(
		new URL('../desktop/assistance-registration.mjs', import.meta.url), 'utf8');
	assert.match(registration,
		/import \{ applyAssistanceBackgroundPriority, normalizeAssistanceThermalState \} from '\.\/project-library-runtime\/desktop\/assistance-power-etiquette-v1\.js';/u);
	assert.match(registration, /import \{ powerMonitor, utilityProcess \} from 'electron\/main';/u);
	assert.match(registration,
		/applyAssistanceBackgroundPriority\(pid, setPriority, osConstants\.priority\.PRIORITY_BELOW_NORMAL\)/u);
	assert.match(registration,
		/onBatteryPower: powerMonitor\.isOnBatteryPower\(\) === true,[\s\S]*?thermalState: normalizeAssistanceThermalState\(/u);
	assert.match(registration,
		/POWER_ETIQUETTE_EVENTS = Object\.freeze\(\['on-ac', 'on-battery', 'thermal-state-change'\]\)/u,
		'the port must re-evaluate a hold on both power and thermal transitions');
	assert.match(registration,
		/for \(const event of POWER_ETIQUETTE_EVENTS\) powerMonitor\.off\(event, listener\);/u,
		'a released hold must remove exactly the listeners it added');
	assert.match(registration,
		/child = forked;\s*forked\.once\('spawn', \(\) => \{[\s\S]*?assistanceBackgroundPriority\(forked\.pid\);[\s\S]*?\}\);/u,
		'the Sherpa speech helper drops priority only after Electron publishes its pid');
	assert.match(registration,
		/createAssistanceRuntimeFamilyDesktopStartup\(\{[\s\S]*?applyBackgroundPriority: assistanceBackgroundPriority,[\s\S]*?powerEtiquette: assistancePowerEtiquette\(\),/u);
});

test('the staged desktop runtime carries the assistance power etiquette module', async () => {
	const configuration = JSON.parse(await readFile(
		new URL('../tsconfig.desktop-runtime.json', import.meta.url), 'utf8'));
	assert.ok(configuration.include.includes('desktop/assistance-power-etiquette-v1.ts'),
		'the composition root imports it from the staged runtime, so it must be emitted there');
});
