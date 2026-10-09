/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { AraBridge } from '../src/common/editor/ara-contract.ts';

import { validateMilestone5PackagePayloadBinding }
	from '../scripts/lib/milestone-5-package-payload-binding.mjs';
import { validateFramescaperProfessionalNativeSummary }
	from '../scripts/lib/soundscaper-professional-native-stable-summary.mjs';
import { bundleDesktopMainPreload, retainDesktopRuntimeClosureAfterBundling }
	from '../scripts/lib/desktop-product-runtime-staging.mjs';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';
import { desktopProductRuntimeFiles } from '../scripts/lib/desktop-product-package-files.mjs';
import { DESKTOP_ARA_RUNTIME_FILES } from '../scripts/lib/desktop-ara-runtime-files.mjs';
import sourceRegister from '../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };
import { soundscaperProfessionalNativeSourceIdsForTarget }
	from '../scripts/lib/soundscaper-professional-native-build-result-contract.mjs';
import { assertDesktopProfessionalNativeNoticeClosure, soundscaperProfessionalNativeNoticeSummary }
	from '../scripts/lib/soundscaper-professional-native-notices.mjs';

const DIGEST = 'a'.repeat(64);
const REVISION = '1'.repeat(40);
const INPUT = 'config/soundscaper-professional-native-payload-manifest.json';

function fixture() {
	const root = 'native/soundscaper-professional-host/prebuilt/linux-x64/';
	const artifact = (name: string) => ({ path: `${root}${name}`, byteLength: 31, sha256: DIGEST });
	const pluginPeer = artifact('soundscaper_professional_peer');
	const target = {
		id: 'linux-x64', status: 'built', blockedBy: null,
		toolchainIdentity: 'fixture-cmake-toolchain',
		sourceAuthentication: { schemaVersion: 1, status: 'authenticated', sources: [] },
		payload: artifact('soundscaper_professional.node'),
		osAudioCodec: null,
		buildResult: artifact('soundscaper-professional-native-build-result.json'),
		pluginPeer,
		deliveryFilesystem: artifact('soundscaper_delivery_fs'),
		isolation: {
			launcher: artifact('milestone5-native-isolation-launcher'),
			sandboxProfile: artifact('native-isolation-profile-v1.json'),
			brokerPolicy: artifact('native-isolation-broker-v1.json'),
			entrypointPath: pluginPeer.path,
			runtimeClosure: [artifact('runtime/libfixture.so')],
		},
	};
	const professional = {
		hostingScope: 'audio-plugin-host', target: target.id, targetSource: 'declared',
		status: target.status, blockedBy: null,
		payloadManifest: { id: 'professional', byteLength: 11, sha256: DIGEST },
		sourceAuthentication: target.sourceAuthentication, toolchainIdentity: target.toolchainIdentity,
		buildAuthority: { sourceRevision: REVISION, buildPlanSha256: DIGEST },
		payload: null, osAudioCodec: null, deliveryFilesystem: null,
		buildResult: target.buildResult, pluginPeer: target.pluginPeer, isolation: target.isolation,
	};
	return { professional, target };
}

test('Framescaper releases admit the authenticated audio plug-in peer and refuse device or delivery scope', () => {
	const { professional } = fixture();
	const validate = (summary: unknown, revision = REVISION) =>
		validateFramescaperProfessionalNativeSummary(summary, 'linux-x64', 'framescaper fixture', revision);
	assert.doesNotThrow(() => validate(professional));
	assert.throws(() => validate(professional, 'f'.repeat(40)), /source revision/u);
	assert.throws(() => validate({ ...professional, payload: { name: 'addon.node' } }), /device or delivery/u);
	assert.throws(() => validate({ ...professional, deliveryFilesystem: professional.pluginPeer }), /device or delivery/u);
	assert.throws(() => validate({ ...professional, hostingScope: 'all-native-services' }), /scope/u);
	assert.doesNotThrow(() => validate(null));
});

test('Framescaper package binding authenticates the peer, receipt and isolation against the independent payload audit', () => {
	const { professional, target } = fixture();
	const empty = { id: 'empty', targets: [{ id: 'linux-x64', status: 'ci-generated', blockedBy: null, payload: null }] };
	const packageAudit = {
		productId: 'framescaper', targetId: 'linux-x64', runtimeManifest: { value: {
			soundscaperProfessionalNative: professional,
			framescaperNativeHosts: { target: 'linux-x64', mediaHost: {
				payloadManifest: { id: 'empty', sha256: DIGEST }, status: 'ci-generated', blockedBy: null, payloads: [],
			}, openFxHost: {
				payloadManifest: { id: 'empty', sha256: DIGEST }, status: 'ci-generated', blockedBy: null, payloads: [],
			} },
		} },
	};
	const payloadAudit = {
		manifests: { soundscaperProfessional: { id: 'professional', targets: [target] }, mediaHost: empty, openFxHost: empty },
		inputDigests: { [INPUT]: { byteLength: 11, sha256: DIGEST }, media: { sha256: DIGEST }, openfx: { sha256: DIGEST } },
	};
	const inputPaths = { soundscaperProfessionalPayload: INPUT, mediaHostPayload: 'media', openFxHostPayload: 'openfx' };
	const validate = (audit: typeof packageAudit) => validateMilestone5PackagePayloadBinding(
		audit, payloadAudit, inputPaths, { payloadProducts: ['framescaper'] },
	);
	assert.doesNotThrow(() => validate(packageAudit));
	for (const field of ['pluginPeer', 'buildResult'] as const) {
		const changed = structuredClone(packageAudit);
		changed.runtimeManifest.value.soundscaperProfessionalNative[field].sha256 = 'b'.repeat(64);
		assert.throws(() => validate(changed), /professional native.*closure/u);
	}
	const changed = structuredClone(packageAudit);
	changed.runtimeManifest.value.soundscaperProfessionalNative.isolation.runtimeClosure[0]!.sha256 = 'b'.repeat(64);
	assert.throws(() => validate(changed), /professional native.*closure/u);
});

test('both product sandbox preloads bundle ARA validation without an ESM runtime loader', async (context) => {
	const temporary = await mkdtemp(join(tmpdir(), 'scape-ara-preload-'));
	context.after(() => rm(temporary, { recursive: true, force: true }));
	for (const product of ['soundscaper', 'framescaper']) {
		assert.deepEqual(desktopProductRuntimeFiles(product, DESKTOP_ARA_RUNTIME_FILES), DESKTOP_ARA_RUNTIME_FILES);
		const root = join(temporary, product);
		const modulePath = join(root, 'project-library-runtime/desktop/ara-preload.js');
		await mkdir(join(root, 'project-library-runtime/desktop'), { recursive: true });
		await build({ entryPoints: ['desktop/ara-preload.ts'], outfile: modulePath,
			bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
		await writeFile(join(root, 'preload.mjs'), [
			"import { createAraPreloadBridge } from './project-library-runtime/desktop/ara-preload.js';",
			"const { contextBridge, ipcRenderer } = require('electron');",
			"contextBridge.exposeInMainWorld('ara', createAraPreloadBridge((channel, value) => ipcRenderer.invoke(channel, value)));",
		].join('\n'));
		await bundleDesktopMainPreload(root);
		assert.deepEqual(await retainDesktopRuntimeClosureAfterBundling({ applicationRoot: root,
			applicationFiles: ['preload.mjs'], compiledRoot: join(root, 'project-library-runtime'),
			completeFiles: ['desktop/ara-preload.js'], stagedFiles: ['desktop/ara-preload.js'],
			productId: product, runtimePackageImports: {},
		}), []);
		await assert.rejects(readFile(modulePath), { code: 'ENOENT' });
		const source = await readFile(join(root, 'preload.mjs'), 'utf8');
		assert.doesNotMatch(source, /\bimport\s|\brequire\(["']\.\//u);
		let bridge: AraBridge | null = null;
		const calls: unknown[] = [];
		vm.runInNewContext(source, { Object, require: (specifier: string) => {
			assert.equal(specifier, 'electron');
			return { contextBridge: { exposeInMainWorld: (_name: string, value: AraBridge) => { bridge = value; } },
				ipcRenderer: { invoke: (channel: string, value: unknown) => { calls.push([channel, value]); return Promise.resolve(true); } } };
		} });
		assert.ok(bridge);
		const exposed: AraBridge = bridge;
		assert.equal(await exposed.bind({ sessionId: 'ara-session-1' }), true);
		assert.equal(calls.length, 1);
		await assert.rejects(exposed.bind({ sessionId: '' }), /identifier/u);
		assert.equal(calls.length, 1);
	}
});

test('desktop preview builds real ARA peers and retains the same authenticated overlay for package re-audits', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	assert.match(extractJob(workflow, 'professional-native-source'), /--source ara-api --source ara-library/u);
	assert.match(extractJob(workflow, 'professional-native-build'), /uses: \.\/\.github\/workflows\/soundscaper-professional-native-build\.yml/u);
	const packageJob = extractJob(workflow, 'package');
	assert.match(packageJob, /needs: \[[^\]]*professional-native-build/u);
	for (const job of [packageJob, extractJob(workflow, 'milestone-5-package-audit-summary')]) {
		assert.match(job, /pattern: soundscaper-professional-native-build-result-\*/u);
		assert.match(job, /--result-directory="\$RUNNER_TEMP\/soundscaper-professional-native-build-results"/u);
		for (const [name, directory] of [
			['SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT', 'soundscaper-professional-native-source-cache'],
			['SOUNDSCAPER_M5_NATIVE_BUILD_RESULT_ROOT', 'soundscaper-professional-native-build-results'],
		] as const) {
			const binding = `printf '${name}=%s/${directory}\\n' "$RUNNER_TEMP" >> "$GITHUB_ENV"`;
			assert.ok(job.includes(binding), `${name} must persist the authenticated runner root for subsequent steps`);
			assert.ok(job.indexOf(binding) < job.indexOf('node scripts/stage-soundscaper-professional-native-build-result.mjs'),
				`${name} must be available before staging the authenticated overlay`);
		}
	}
	const release = extractJob(workflow, 'release-inventory');
	assert.match(release, /SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT:/u);
	assert.match(release, /path: release\/desktop\//u);
	assert.match(release, /path: release\/desktop-ci\/\*\.json/u);
});

test('built preview audio hosts in both products require the same pinned ARA license notices', () => {
	const sourceAuthentication = { schemaVersion: 1, status: 'authenticated',
		sources: soundscaperProfessionalNativeSourceIdsForTarget('linux-x64').map((id: string) => {
			const source = sourceRegister.sources.find((entry) => entry.id === id)!;
			return { id, authenticationStatus: 'authenticated',
				archiveEvidence: { byteLength: source.archive.byteLength, sha256: source.archive.sha256 },
				extractedTreeEvidence: source.extractedTree };
		}) };
	const notices = soundscaperProfessionalNativeNoticeSummary({ target: 'linux-x64', sourceAuthentication });
	for (const productId of ['soundscaper', 'framescaper']) {
		const files: string[] = [];
		const professional = { status: 'built', hostingScope: 'audio-plugin-host', sourceAuthentication };
		const options = { runtime: { productId, applicationVersionChannel: 'nightly', releaseChannel: 'nightly',
			desktopNotices: { professionalNative: notices } }, professional, target: 'linux-x64',
			expectedByPrefix: new Map(), requireFile: (path: string) => { files.push(path); } };
		assert.deepEqual(assertDesktopProfessionalNativeNoticeClosure(options), notices);
		assert.ok(files.includes('licenses/professional-native/ARA-API-Apache-2.0.txt'));
		assert.ok(files.includes('licenses/professional-native/ARA-Library-Apache-2.0.txt'));
		assert.throws(() => assertDesktopProfessionalNativeNoticeClosure({ ...options,
			runtime: { ...options.runtime, desktopNotices: { professionalNative: null } },
		}), /notice authority/u);
	}
});
