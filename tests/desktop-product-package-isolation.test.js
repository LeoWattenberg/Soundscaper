/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	assertDesktopProductPackageIsolation,
	desktopLegacyNativeAddonIncluded,
	desktopProductConfigFiles,
	desktopProductRuntimeFiles,
	desktopProductSourceIncluded,
	soundscaperAssistanceRegistrationSource,
	soundscaperConstantsSource,
	soundscaperDesktopCodecSource,
	soundscaperDesktopSmokeSource,
	soundscaperMainSource,
	soundscaperNativeTierSource,
	soundscaperPreloadSource,
	soundscaperProductIsolationModuleSource,
	soundscaperProjectRuntimeSource,
	soundscaperProtocolSource,
} from '../scripts/lib/desktop-product-package-files.mjs';
import {
	desktopProductRuntimeTransform,
} from '../scripts/lib/desktop-product-runtime-staging.mjs';
import {
	soundscaperAssistanceOnnxRuntimeWorkerSource,
	soundscaperAssistanceRuntimeFamilyHelperSource,
	soundscaperHelperDataPlaneTransferSource,
	soundscaperHelperJobSubcontractSource,
} from '../scripts/lib/desktop-soundscaper-runtime-transforms.mjs';

test('Soundscaper package policy excludes product-owned Framescaper implementation files', () => {
	const candidates = [
		'desktop/application-lifecycle.js',
		'desktop/framescaper-capture-desktop-port.js',
		'desktop/native-services-runtime.js',
		'desktop/openfx-main-service.js',
		'desktop/helper-native-ofx-interact-grant.js',
		'desktop/helper-probe-service.js',
		'desktop/external-ffmpeg-video-operation-service.js',
		'src/common/editor/video-export.js',
		'src/common/editor/assistance/visual-frame-pack-v2.js',
		'src/framescaper/editor-project.js',
		'src/common/editor/scape-project-document.js',
	];
	assert.deepEqual(desktopProductRuntimeFiles('soundscaper', candidates), [
		'desktop/application-lifecycle.js',
		'src/common/editor/video-export.js',
		'src/common/editor/scape-project-document.js',
	]);
	assert.deepEqual(desktopProductRuntimeFiles('framescaper', candidates), candidates);
	assert.equal(desktopProductSourceIncluded(
		'soundscaper', 'framescaper-web-vcr-smoke-session.js',
	), false);
	assert.deepEqual(desktopProductRuntimeFiles('soundscaper', [
		'desktop/soundscaper-capture-session-security.js',
	]), [
		'desktop/soundscaper-capture-session-security.js',
	]);
	assert.doesNotThrow(() => assertDesktopProductPackageIsolation('soundscaper', [
		'desktop/main.mjs',
		'desktop/project-library-runtime/src/common/editor/scape-project-document.js',
	]));
	assert.throws(() => assertDesktopProductPackageIsolation('soundscaper', [
		'desktop/main.mjs',
		'desktop/project-library-runtime/desktop/native-services-runtime.js',
	]), /Framescaper-owned files/iu);
});

test('normal product staging retains the nightly product seam and excludes only launcher files', () => {
	const candidates = [
		'desktop/main.mjs',
		'desktop/nightly-tests-window.mjs',
		'desktop/nightly-tests-assistance-host.mjs',
		'desktop/nightly-tests-assistance.html',
		'desktop/nightly-tests-main.mjs',
		'desktop/nightly-tests-manifest.mjs',
		'desktop/nightly-tests-progress-window.d.mts',
		'desktop/nightly-tests-progress-window.mjs',
		'desktop/nightly-tests-progress-renderer.js',
		'desktop/nightly-tests-progress.html',
		'desktop/nightly-tests-progress.css',
	];
	for (const product of ['framescaper', 'soundscaper']) {
		assert.deepEqual(desktopProductRuntimeFiles(product, candidates), [
			'desktop/main.mjs',
			'desktop/nightly-tests-window.mjs',
		]);
		assert.equal(desktopProductSourceIncluded(product, 'nightly-tests-window.mjs'), true);
		for (const path of candidates.slice(2)) {
			assert.equal(desktopProductSourceIncluded(product, path.replace('desktop/', '')), false);
		}
		assert.doesNotThrow(() => assertDesktopProductPackageIsolation(product, candidates.slice(0, 2)));
		assert.throws(() => assertDesktopProductPackageIsolation(product, candidates),
			/nightly-test harness files/iu);
	}
});

test('normal product staging excludes the retired native realtime helper', () => {
	for (const product of ['framescaper', 'soundscaper']) {
		assert.equal(desktopProductSourceIncluded(
			product, 'native-helper-realtime-job.js',
		), false);
	}
});

test('Soundscaper config closure excludes both Framescaper native payload authorities', () => {
	const soundscaper = desktopProductConfigFiles('soundscaper');
	assert.ok(soundscaper.includes('config/soundscaper-professional-native-payload-manifest.json'));
	assert.ok(soundscaper.includes('config/soundscaper-professional-native-notices.json'));
	assert.equal(soundscaper.some((path) => path.includes('framescaper-')), false);
	const framescaper = desktopProductConfigFiles('framescaper');
	assert.ok(framescaper.includes('config/framescaper-media-host-payload-manifest.json'));
	assert.ok(framescaper.includes('config/framescaper-openfx-host-payload-manifest.json'));
});

test('Soundscaper desktop validation retains the shared source-characteristics contract', () => {
	assert.equal(desktopProductRuntimeTransform(
		'soundscaper',
		'src/common/editor/source-characteristics-v14.js',
	), undefined);
	assert.deepEqual(desktopProductRuntimeFiles('soundscaper', [
		'src/common/editor/source-characteristics-v14.js',
		'src/common/editor/video-source-characteristics.js',
	]), [
		'src/common/editor/source-characteristics-v14.js',
		'src/common/editor/video-source-characteristics.js',
	]);
});

test('Soundscaper packaged helper transforms retain Vamp analysis and its RPC port', async () => {
	const subcontractSource = soundscaperHelperJobSubcontractSource(
		"const kinds = ['probe-video-source', 'ofx-host'];\n",
	);
	const subcontract = await importSource(subcontractSource);
	assert.deepEqual([...subcontract.HELPER_JOB_KINDS], [
		'audio-device', 'plugin-scan', 'plugin-host', 'plugin-analyze', 'assistance-speech',
	]);
	assert.equal(subcontract.helperJobSubcontractVersion('plugin-analyze'), 1);

	const transfersSource = soundscaperHelperDataPlaneTransferSource(`
import { isHelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.js';
export function packagedPortCount(kind, grant) { return nativeBindings(kind, grant).length; }
function nativeBindings(kind, grant) {
\tif (kind === 'audio-device' || kind === 'plugin-host' || kind === 'plugin-analyze') {
\t\treturn grant.persistentPort ? [grant.persistentPort] : [];
\t}
\treturn [];
}
function streamBindings(inputs) { return inputs; }
`);
	const transfers = await importSource(transfersSource);
	assert.equal(transfers.packagedPortCount('plugin-analyze', {
		persistentPort: { streamId: 'ab'.repeat(20) },
	}), 1);
});

test('Soundscaper runtime-family transforms retain audio and text adapters only', () => {
	const helper = soundscaperAssistanceRuntimeFamilyHelperSource(`
import { createAssistanceWhisperCppWorkerSpawnerV1, } from "./assistance-whisper-cpp-worker.js";
import { createAssistanceLlamaCppWorkerSpawnerV1, } from "./assistance-llama-cpp-worker.js";
export function createAssistanceRuntimeFamilyHelperProcessV1(options) {
    if (options.spawnLlamaWorker !== undefined
        && typeof options.spawnLlamaWorker !== 'function') {
        throw new TypeError('The llama.cpp worker-process port is invalid.');
    }
    const spawnThreadWorker = createThread({
        workerEntry: options.workerEntry
            ?? new URL('./assistance-runtime-family-inference-worker.js', import.meta.url),
    });
    const spawnWhisperWorker = options.spawnWhisperWorker
        ?? createAssistanceWhisperCppWorkerSpawnerV1();
    const spawnLlamaWorker = options.spawnLlamaWorker
        ?? createAssistanceLlamaCppWorkerSpawnerV1();
    return createAssistanceRuntimeFamilyUtilityWorker({
        spawnWorker: (job, runOptions) => {
            if (job.familyId === 'whisper-cpp')
                return spawnWhisperWorker(job, runOptions);
            if (job.familyId === 'llama-cpp' && job.task === 'editorial-generation') {
                return spawnLlamaWorker(job, runOptions);
            }
            return spawnThreadWorker(job, runOptions);
        },
    });
}
`);
	assert.match(helper, /assistance-whisper-cpp-worker\.js/u);
	assert.match(helper, /assistance-runtime-family-inference-worker\.js/u);
	assert.doesNotMatch(helper, /llama|editorial-generation/iu);

	const onnx = soundscaperAssistanceOnnxRuntimeWorkerSource(`
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { reviewAssistanceFramePackV1, } from "../src/common/editor/assistance/binary-formats-v1.js";
import { runAssistanceTransNetV2FrameSourceOnnxAdapterV1, } from "../src/common/editor/assistance/transnetv2-onnx-adapter-v1.js";
import { AssistanceRuntimeFamilyAdapterUnavailableError, } from "./assistance-runtime-family-worker-entry.js";
import { createAssistanceOnnxAudioRuntimeWorkerAdapterV1, } from "./assistance-onnx-audio-runtime-worker.js";
import { createAssistanceOnnxDereverbWorkerAdapterV1, } from "./assistance-onnx-dereverb-worker.js";
import { createAssistanceOnnxEnhancementSeparationWorkerAdapterV1, } from "./assistance-onnx-enhancement-separation-worker.js";
import { createAssistanceOnnxTextEmbeddingWorkerAdapterV1, } from "./assistance-onnx-text-embedding-worker.js";
import { createAssistanceOnnxWordAlignmentWorkerAdapterV1, } from "./assistance-onnx-word-alignment-worker.js";
import { createAssistanceOnnxOcrWorkerAdapterV1, } from "./assistance-onnx-ocr-worker.js";
import { createAssistanceOnnxSaliencyWorkerAdapterV1, } from "./assistance-onnx-saliency-worker.js";
import { createAssistanceOnnxSiglip2WorkerAdapterV1, } from "./assistance-onnx-siglip2-worker.js";
import { createAssistanceOnnxSubjectWorkerAdapterV1, } from "./assistance-onnx-subject-worker.js";
const TRANSNET_INPUT_NAMES = Object.freeze(['frames']);
export function createAssistanceOnnxRuntimeWorkerAdapterV1() {
    const executeAudio = createAssistanceOnnxAudioRuntimeWorkerAdapterV1(loadOnnxRuntime);
    const executeEnhancementSeparation = createAssistanceOnnxEnhancementSeparationWorkerAdapterV1(loadOnnxRuntime);
    const executeDereverb = createAssistanceOnnxDereverbWorkerAdapterV1(loadOnnxRuntime);
    const executeTextEmbedding = createAssistanceOnnxTextEmbeddingWorkerAdapterV1(loadOnnxRuntime);
    const executeWordAlignment = createAssistanceOnnxWordAlignmentWorkerAdapterV1(loadOnnxRuntime);
    const executeSiglip2 = createAssistanceOnnxSiglip2WorkerAdapterV1(loadOnnxRuntime);
    const executeOcr = createAssistanceOnnxOcrWorkerAdapterV1(loadOnnxRuntime);
    const executeSubjects = createAssistanceOnnxSubjectWorkerAdapterV1(loadOnnxRuntime);
    const executeSaliency = createAssistanceOnnxSaliencyWorkerAdapterV1(loadOnnxRuntime);
    return async (context) => {
        if (context.grant.task === 'word-alignment') return executeWordAlignment(context);
        if (context.grant.task === 'speech-enhancement' || context.grant.task === 'source-separation') return executeEnhancementSeparation(context);
        if (context.grant.task === 'dereverberation') return executeDereverb(context);
        if (context.grant.task === 'shot-detection') return executeTransNetV2(context, loadOnnxRuntime);
        if (context.grant.task === 'audio-tagging' || context.grant.task === 'beat-tracking') return executeAudio(context);
        if (context.grant.task === 'text-embedding') return executeTextEmbedding(context);
        if (context.grant.task === 'image-text-embedding') return executeSiglip2(context);
        if (context.grant.task === 'optical-character-recognition') return executeOcr(context);
        if (context.grant.task === 'subject-detection') return executeSubjects(context);
        if (context.grant.task === 'saliency-detection') return executeSaliency(context);
        throw new AssistanceRuntimeFamilyAdapterUnavailableError();
    };
}
async function executeTransNetV2() { return reviewAssistanceFramePackV1(); }
async function loadOnnxRuntime(entrypoint) { return pathToFileURL(entrypoint); }
`);
	for (const task of [
		'word-alignment', 'speech-enhancement', 'source-separation', 'dereverberation',
		'audio-tagging', 'beat-tracking', 'text-embedding',
	]) assert.match(onnx, new RegExp(`['"]${task}['"]`, 'u'));
	assert.doesNotMatch(onnx,
		/shot-detection|image-text-embedding|optical-character-recognition|subject-detection|saliency-detection/iu);
	assert.doesNotMatch(onnx, /assistance-onnx-(?:ocr|saliency|siglip2|subject)-worker/u);
});

test('Stable Soundscaper excludes the legacy development native-addon fixture', () => {
	const stable = { applicationVersionChannel: 'stable', releaseChannel: 'stable' };
	assert.equal(desktopLegacyNativeAddonIncluded('soundscaper', stable), false);
	assert.equal(desktopProductConfigFiles('soundscaper', stable)
		.includes('config/native-addon-payload-manifest.json'), false);
	assert.equal(desktopLegacyNativeAddonIncluded('soundscaper', {
		applicationVersionChannel: 'candidate', releaseChannel: 'candidate',
	}), true);
	assert.equal(desktopLegacyNativeAddonIncluded('framescaper', stable), true);
});

test('Soundscaper staged entry sources have no callable Framescaper product surface', async () => {
	const [codec, constants, main, nativeTier, preload, projectRuntime, protocol] = await Promise.all([
		readFile('desktop/desktop-codec-main-integration.mjs', 'utf8'),
		readFile('desktop/constants.js', 'utf8'),
		readFile('desktop/main.mjs', 'utf8'),
		readFile('desktop/native-tier-registration.mjs', 'utf8'),
		readFile('desktop/preload.mjs', 'utf8'),
		readFile('desktop/project-library-product-runtime.js', 'utf8'),
		readFile('desktop/protocol.js', 'utf8'),
	]);
	const stagedCodec = soundscaperDesktopCodecSource(codec);
	const stagedConstants = soundscaperConstantsSource(constants);
	const stagedMain = soundscaperMainSource(main);
	assert.match(stagedMain, /registerDesktopMcpMain/u);
	assert.doesNotMatch(main, /registerDesktopMcpMain/u);
	const stagedNativeTier = soundscaperNativeTierSource(nativeTier);
	const stagedPreload = soundscaperPreloadSource(preload);
	const stagedProjectRuntime = soundscaperProjectRuntimeSource(projectRuntime);
	const stagedProtocol = soundscaperProtocolSource(protocol);
	assert.doesNotMatch(stagedMain, /from '\.\/framescaper-|createFramescaper|startFramescaper/u);
	assert.match(stagedMain, /desktopCapturer/u);
	assert.doesNotMatch(stagedPreload,
		/framescaperDesktop|framescaper:v1:|FRAMESCAPER_WEB_VCR_|chooseLinkedVideo|DesktopVideo/u);
	assert.doesNotMatch(stagedProjectRuntime,
		/project-library-runtime\/desktop\/framescaper-|FramescaperDesktopProjectLibrary/u);
	assert.doesNotMatch(stagedConstants,
		/framescaper:v1:|FRAMESCAPER_WEB_VCR_|chooseLinkedVideo|desktopVideoCodec/u);
	assert.doesNotMatch(stagedCodec, /registerDesktopVideoCodecs|registerVideoCodecs/u);
	assert.doesNotMatch(stagedNativeTier, /registerDesktopHelperProbe/u);
	assert.doesNotMatch(stagedProtocol, /FRAMESCAPER_CAPTURE_POLICY|productId === 'framescaper'/u);
	assert.match(stagedProtocol, /display-capture=\(self\)/u);
	assert.match(soundscaperProductIsolationModuleSource(),
		/project-library-runtime\/desktop\/soundscaper-capture-session-security\.js/u);
	assert.doesNotMatch(soundscaperProductIsolationModuleSource(), /framescaper/iu);
	assert.doesNotThrow(() => assertDesktopProductPackageIsolation(
		'soundscaper',
		['desktop/main.mjs', 'desktop/preload.mjs'],
		new Map([
			['desktop/main.mjs', stagedMain],
			['desktop/preload.mjs', stagedPreload],
		]),
	));
});

test('Soundscaper staged entry transforms accept Windows CRLF checkouts', async () => {
	const entries = [
		['desktop/assistance-registration.mjs', soundscaperAssistanceRegistrationSource],
		['desktop/main.mjs', soundscaperMainSource],
		['desktop/native-tier-registration.mjs', soundscaperNativeTierSource],
		['desktop/constants.js', soundscaperConstantsSource],
		['desktop/desktop-codec-main-integration.mjs', soundscaperDesktopCodecSource],
		['desktop/project-library-product-runtime.js', soundscaperProjectRuntimeSource],
		['desktop/protocol.js', soundscaperProtocolSource],
		['desktop/desktop-smoke.js', soundscaperDesktopSmokeSource],
		['desktop/preload.mjs', soundscaperPreloadSource],
	];
	for (const [path, transform] of entries) {
		const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
		assert.doesNotMatch(transform(source), /\r/u, path);
	}
});

test('Soundscaper package audit rejects callable bridge and native-service markers', () => {
	for (const marker of [
		"contextBridge.exposeInMainWorld('framescaperDesktop', bridge)",
		"ipcRenderer.invoke('framescaper:v1:native-services:capabilities')",
		'FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE',
	]) {
		assert.throws(() => assertDesktopProductPackageIsolation(
			'soundscaper',
			['desktop/preload.mjs'],
			new Map([['desktop/preload.mjs', marker]]),
		), /callable Framescaper marker/iu);
	}
});

function importSource(source) {
	return import(`data:text/javascript,${encodeURIComponent(source)}`);
}
