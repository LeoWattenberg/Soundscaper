/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { extractJob, npmScriptsRunBy } from './helpers/workflow-jobs.js';
import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import productReleaseLines from '../config/product-release-lines.json' with { type: 'json' };
import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';
import {
	desktopReleaseTargetPackageInventory,
	desktopReleaseRuntimeManifestNames,
	desktopTranslationSourceName,
	parseDesktopReleaseAssetArguments,
	regularDesktopReleaseFileNames,
	validateSoundscaperStableProfessionalNativeSummary,
	validateDesktopNativeAddonSummary,
	validateDesktopReleaseInputInventory,
	validateDesktopStableReleaseSelection,
	validateDesktopReleasePackageInventory,
	validateDesktopRuntimeManifests,
} from '../scripts/desktop-release-assets.mjs';

const VERSION = '1.0.0-rc.1';
const PACKAGES = [
	`Soundscaper-${VERSION}-linux-x64.AppImage`,
	`Soundscaper-${VERSION}-linux-amd64.deb`,
	`Soundscaper-${VERSION}-linux-arm64.AppImage`,
	`Soundscaper-${VERSION}-linux-arm64.deb`,
	`Soundscaper-${VERSION}-mac-arm64.dmg`,
	`Soundscaper-${VERSION}-win-x64.exe`,
	`Soundscaper-${VERSION}-win-x64.zip`,
	`Soundscaper-${VERSION}-win-arm64.exe`,
	`Soundscaper-${VERSION}-win-arm64.zip`,
];
const FRAMESCAPER_PACKAGES = PACKAGES
	.map((name) => name.replace('Soundscaper-', 'Framescaper-'));
const DEFERRED_FRAMESCAPER_VERSION = '0.9.0-rc.7';
const DIVERGENT_FRAMESCAPER_PACKAGES = FRAMESCAPER_PACKAGES.map((name) => (
	name.replace(VERSION, DEFERRED_FRAMESCAPER_VERSION)
));
const SOUNDSCAPER_RUNTIME_MANIFESTS = desktopReleaseRuntimeManifestNames(['soundscaper']);

test('target package inventory is the exact shared naming authority', () => {
	const linux = desktopReleaseTargetPackageInventory('framescaper', 'linux-x64', VERSION);
	assert.deepEqual(linux.map(({ label }) => label), [
		'Linux x64 AppImage',
		'Linux x64 Debian package',
	]);
	assert.equal(linux[0].pattern.test(`Framescaper-${VERSION}-linux-x64.AppImage`), true);
	assert.equal(linux[1].pattern.test(`Framescaper-${VERSION}-linux-amd64.deb`), true);
	assert.equal(linux[0].pattern.test(`Soundscaper-${VERSION}-linux-x64.AppImage`), false);
	const windows = desktopReleaseTargetPackageInventory('soundscaper', 'win-arm64', VERSION);
	assert.deepEqual(windows.map(({ label }) => label), [
		'Windows ARM64 installer',
		'Windows ARM64 ZIP',
	]);
	assert.throws(
		() => desktopReleaseTargetPackageInventory('soundscaper', 'mac-x64', VERSION),
		/target/iu,
	);
});

test('Soundscaper release inventory is exact and version-bound', () => {
	assert.doesNotThrow(() => validateDesktopReleasePackageInventory(PACKAGES, VERSION));
	assert.throws(
		() => validateDesktopReleasePackageInventory([...PACKAGES, `Framescaper-${VERSION}-linux-x64.AppImage`], VERSION),
		/Unexpected or duplicate desktop package/iu,
	);
	assert.throws(
		() => validateDesktopReleasePackageInventory(PACKAGES.map((name) => name.replace(VERSION, '0.1.0')), VERSION),
		/Expected exactly one Linux x64 AppImage/iu,
	);
	assert.throws(
		() => validateDesktopReleasePackageInventory([...PACKAGES, `Soundscaper-${VERSION}-linux-x86_64.AppImage`], VERSION),
		/Expected exactly one Linux x64 AppImage/iu,
	);
	for (const name of [`Soundscaper-${VERSION}-win-x64.EXE`, `Soundscaper-${VERSION}-win-x64.msi`]) {
		assert.throws(() => validateDesktopReleasePackageInventory([...PACKAGES, name], VERSION),
			/Unexpected desktop release input/iu);
	}
	for (const name of [
		'ffmpeg-corresponding-source.json',
		'ffmpeg-runtime-manifest.json',
		'ffmpeg-9.0.1.tar.xz',
	]) {
		assert.throws(
			() => validateDesktopReleasePackageInventory([...PACKAGES, name], VERSION),
			/forbidden bundled FFmpeg|Unexpected desktop release input/iu,
		);
	}
});

test('stable Soundscaper assembly selects exactly nine packages and five runtime manifests', () => {
	const selected = [...PACKAGES, ...SOUNDSCAPER_RUNTIME_MANIFESTS];
	assert.doesNotThrow(() => validateDesktopReleaseInputInventory(
		selected, VERSION, ['soundscaper'],
	));
	assert.equal(PACKAGES.length, 9);
	assert.equal(SOUNDSCAPER_RUNTIME_MANIFESTS.length, 5);
	assert.throws(
		() => validateDesktopReleaseInputInventory(
			selected.slice(0, -1), VERSION, ['soundscaper'],
		),
		/exactly five runtime manifests/iu,
	);
	for (const foreign of [
		`Framescaper-${VERSION}-mac-arm64.dmg`,
		'runtime-manifest-framescaper-mac-arm64.json',
	]) {
		assert.throws(
			() => validateDesktopReleaseInputInventory([...selected, foreign], VERSION, ['soundscaper']),
			/Unexpected|exactly five|selected product/iu,
		);
	}
	assert.deepEqual(
		parseDesktopReleaseAssetArguments(['--product', 'soundscaper']).productIds,
		['soundscaper'],
	);
	assert.throws(() => parseDesktopReleaseAssetArguments([
		'--product', 'soundscaper', '--admission-profile', 'soundscaper-stable-1',
	]), /Unknown desktop release asset option/iu);
	assert.deepEqual(parseDesktopReleaseAssetArguments(['--suite']).productIds,
		['soundscaper', 'framescaper']);
	assert.throws(() => parseDesktopReleaseAssetArguments([]), /requires --product or --suite/iu);
});

test('stable assembly follows the selected release channel without an evidence profile', () => {
	assert.equal(validateDesktopStableReleaseSelection(
		productReleaseLines, ['soundscaper'],
	), false);
	const stable = structuredClone(productReleaseLines);
	stable.products.soundscaper.applicationVersionChannel = 'stable';
	stable.products.soundscaper.releaseChannel = 'stable';
	assert.equal(validateDesktopStableReleaseSelection(stable, ['soundscaper']), true);
	assert.throws(() => validateDesktopStableReleaseSelection(
		stable, ['soundscaper', 'framescaper'],
	), /Soundscaper-only product scope/iu);
});

test('stable Soundscaper assembly refuses incomplete or substituted professional build results', () => {
	const summary = stableProfessionalSummary('mac-arm64');
	assert.doesNotThrow(() => validateSoundscaperStableProfessionalNativeSummary(
		summary, 'mac-arm64', 'runtime-manifest-soundscaper-mac-arm64.json', '1'.repeat(40),
	));
	assert.throws(() => validateSoundscaperStableProfessionalNativeSummary(
		summary, 'mac-arm64', 'runtime-manifest-soundscaper-mac-arm64.json', 'f'.repeat(40),
	), /build source revision.*runtime manifest|runtime manifest.*build source revision/iu);
	const mutations = [
		[(value) => { value.status = 'pending-external'; }, /professional build result/iu],
		[(value) => { value.target = 'linux-x64'; }, /target/iu],
		[(value) => { value.deliveryFilesystem = null; }, /delivery filesystem/iu],
		[(value) => { value.osAudioCodec = null; }, /OS audio codec/iu],
		[(value) => { value.isolation.runtimeClosure[0].path = value.isolation.runtimeClosure[0].path
			.replace('/runtime/', '/foreign/'); },
			/runtime closure/iu],
		[(value) => { value.buildAuthority.sourceRevision = 'f'.repeat(40); },
			/build source revision.*runtime manifest|runtime manifest.*build source revision/iu],
	];
	for (const [mutate, expected] of mutations) {
		const changed = structuredClone(summary);
		mutate(changed);
		assert.throws(
				() => validateSoundscaperStableProfessionalNativeSummary(
					changed, 'mac-arm64', 'runtime-manifest-soundscaper-mac-arm64.json', '1'.repeat(40),
			),
			expected,
		);
	}
	const linux = stableProfessionalSummary('linux-x64');
	linux.osAudioCodec = null;
	assert.doesNotThrow(() => validateSoundscaperStableProfessionalNativeSummary(
		linux, 'linux-x64', 'runtime-manifest-soundscaper-linux-x64.json', '1'.repeat(40),
	));
});

test('the stable release channel activates professional-native refusal in the assembler', () => {
	const summary = stableProfessionalSummary('linux-x64');
	const manifest = {
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: {
			productId: 'soundscaper', target: { platform: 'linux', arch: 'x64' },
			sourceRevision: '1'.repeat(40),
			applicationVersionChannel: 'stable', releaseChannel: 'stable',
			desktopCodecPolicy: DESKTOP_CODEC_POLICY,
			assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(
				assistanceNativeRuntimeManifest, 'linux-x64',
			),
			nativeAddons: null,
			soundscaperProfessionalNative: summary,
			framescaperNativeHosts: null,
		},
	};
	assert.doesNotThrow(() => validateDesktopRuntimeManifests(
		[manifest], ['soundscaper'], undefined, { stableSoundscaper: true },
	));
	const harness = structuredClone(manifest);
	harness.value.nativeHarnessPreparation = true;
	assert.throws(() => validateDesktopRuntimeManifests(
		[harness], ['soundscaper'], undefined, { stableSoundscaper: true },
	), /non-publishable native self-test harness/iu);
	for (const field of ['applicationVersionChannel', 'releaseChannel']) {
		const wrongChannel = structuredClone(manifest);
		wrongChannel.value[field] = 'candidate';
		assert.throws(() => validateDesktopRuntimeManifests(
			[wrongChannel], ['soundscaper'], undefined,
			{ stableSoundscaper: true },
		), /stable release channel/iu);
	}
	const pending = structuredClone(manifest);
	pending.value.soundscaperProfessionalNative.status = 'pending-external';
	pending.value.soundscaperProfessionalNative.blockedBy = 'external target build required';
	assert.throws(() => validateDesktopRuntimeManifests(
		[pending], ['soundscaper'], undefined, { stableSoundscaper: true },
	), /professional build result/iu);
	const preview = structuredClone(pending);
	preview.value.applicationVersionChannel = 'candidate';
	preview.value.releaseChannel = 'candidate';
	preview.value.nativeAddons = {
		target: 'linux-x64', targetSource: 'declared', status: 'built', blockedBy: null,
		payload: { name: 'soundscaper_helper.node', byteLength: 1, sha256: 'a'.repeat(64) },
	};
	assert.doesNotThrow(() => validateDesktopRuntimeManifests([preview], ['soundscaper']));
});

test('stable Soundscaper assembly rejects the legacy development addon summary', () => {
	const manifest = {
		name: 'runtime-manifest-soundscaper-linux-x64.json',
		value: { productId: 'soundscaper', nativeAddons: null },
	};
	assert.doesNotThrow(() => validateDesktopNativeAddonSummary(
		manifest, 'linux-x64', { stableSoundscaper: true },
	));
	manifest.value.nativeAddons = {
		target: 'linux-x64', targetSource: 'declared', status: 'built',
		blockedBy: null, payload: { name: 'soundscaper_helper.node' },
	};
	assert.throws(() => validateDesktopNativeAddonSummary(
		manifest, 'linux-x64', { stableSoundscaper: true },
	), /legacy development native addon/iu);
});

test('suite release inventory requires exact packages for both desktop products', () => {
	const suite = [...PACKAGES, ...FRAMESCAPER_PACKAGES];
	assert.doesNotThrow(() => validateDesktopReleasePackageInventory(
		suite,
		VERSION,
		['soundscaper', 'framescaper'],
	));
	assert.throws(
		() => validateDesktopReleasePackageInventory(
			suite.filter((name) => name !== `Framescaper-${VERSION}-mac-arm64.dmg`),
			VERSION,
			['soundscaper', 'framescaper'],
		),
		/Framescaper macOS Apple silicon DMG/iu,
	);
});

test('suite release inventory binds each independent product version', () => {
	const versions = new Map([
		['soundscaper', VERSION],
		['framescaper', DEFERRED_FRAMESCAPER_VERSION],
	]);
	const suite = [...PACKAGES, ...DIVERGENT_FRAMESCAPER_PACKAGES];
	assert.doesNotThrow(() => validateDesktopReleasePackageInventory(
		suite,
		versions,
		['soundscaper', 'framescaper'],
	));
	assert.doesNotThrow(() => validateDesktopReleaseInputInventory(
		[
			...suite,
			...desktopReleaseRuntimeManifestNames(['soundscaper', 'framescaper']),
		],
		versions,
		['soundscaper', 'framescaper'],
	));
	assert.throws(
		() => validateDesktopReleasePackageInventory(
			[...PACKAGES, ...FRAMESCAPER_PACKAGES],
			versions,
			['soundscaper', 'framescaper'],
		),
		/Framescaper Linux x64 AppImage/iu,
	);
});

test('release roots reject symbolic or non-regular entries', () => {
	assert.throws(() => regularDesktopReleaseFileNames([{
		name: 'THIRD_PARTY_LICENSES.md', isFile: () => false, isSymbolicLink: () => true,
	}]), /not a regular file.*THIRD_PARTY_LICENSES/iu);
});

test('translation source output is bound to a positive release ID and release path', () => {
	const descriptor = {
		path: 'releases/123/source/audacity-translations.zip',
		byteLength: 1,
		sha256: '0'.repeat(64),
	};
	assert.equal(desktopTranslationSourceName('123', descriptor), 'Audacity-translations-123-source.zip');
	assert.throws(() => desktopTranslationSourceName('../../../escape', descriptor), /release ID is invalid/iu);
	assert.throws(
		() => desktopTranslationSourceName('124', descriptor),
		/path does not match its release/iu,
	);
	assert.throws(() => desktopTranslationSourceName('123', {
		...descriptor,
		path: 'releases/123/source/%2e%2e/%2e%2e/999/source/evil.zip',
	}), /path does not match its release/iu);
});

test('desktop preview workflow retains only the no-FFmpeg stage manifest', async () => {
	const workflow = await readFile(resolve(import.meta.dirname, '../.github/workflows/desktop-preview.yml'), 'utf8');
	assert.match(workflow, /cp \.desktop-build\/stage-manifest\.json/u);
	assert.doesNotMatch(workflow, /cp desktop\/ffmpeg-corresponding-source\.json/u);
	const targetRows = [...workflow.matchAll(/platform:\s*(linux|mac|win)\s+arch:\s*(x64|arm64)/gu)]
		.map((match) => `${match[1]}-${match[2]}`);
	assert.deepEqual([...new Set(targetRows)].sort(), [
		'linux-arm64', 'linux-x64', 'mac-arm64', 'win-arm64', 'win-x64',
	]);
	assert.doesNotMatch(workflow, /platform:\s*mac,\s*arch:\s*x64/u);
});

// The assembler validates the selected product release matrix and fetches the
// corresponding sources the AGPL obligation depends on.
test('the desktop nightly assembles the release inventory rather than leaving it to a tag', async () => {
	const workflow = await readFile(resolve(import.meta.dirname, '../.github/workflows/desktop-preview.yml'), 'utf8');
	const packageMetadata = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'));
	const job = extractJob(workflow, 'release-inventory');
	assert.equal(packageMetadata.scripts['desktop:release-assets'], 'node scripts/desktop-release-assets.mjs');
	assert.equal(packageMetadata.scripts['desktop:release-assets:soundscaper'],
		'node scripts/desktop-release-assets.mjs --product soundscaper');
	assert.ok(npmScriptsRunBy(job).has('desktop:release-assets'));
	assert.match(job, /pattern: nightly-\$\{\{ needs\.quality\.outputs\.release-product-pattern \}\}-\*/u,
		'the job must collect every target in the resolved product scope');
	assert.match(job, /merge-multiple: true/u, 'the targets must land in one release directory');
	assert.match(job, /needs: \[quality, package\]/u, 'the assembler needs the resolved scope and packages');
	assert.match(job,
		/npm run desktop:release-assets -- \$\{\{ needs\.quality\.outputs\.release-assembler-arguments \}\}/u,
		'the assembler must receive the resolved product scope');
});

function stableProfessionalSummary(target) {
	const digest = 'a'.repeat(64);
	const root = `native/soundscaper-professional-host/prebuilt/${target}`;
	const artifact = (name, byteLength = 31) => ({
		path: `${root}/${name}`, byteLength, sha256: digest,
	});
	const payload = { name: 'soundscaper_professional.node', byteLength: 71, sha256: digest };
	const buildResult = artifact('soundscaper-professional-native-build-result.json', 101);
	const pluginPeer = artifact(
		target.startsWith('win-') ? 'soundscaper_professional_peer.exe' : 'soundscaper_professional_peer', 72,
	);
	const deliveryFilesystem = artifact(
		target.startsWith('win-') ? 'soundscaper_delivery_fs.exe' : 'soundscaper_delivery_fs', 73,
	);
	const osAudioCodec = target.startsWith('linux-')
		? null : artifact('soundscaper_os_audio_codec.node', 74);
	const launcher = artifact(target.startsWith('win-')
		? 'milestone5-native-isolation-launcher.exe' : 'milestone5-native-isolation-launcher', 75);
	const sandboxProfile = artifact('native-isolation-profile-v1.json', 76);
	const brokerPolicy = artifact('native-isolation-broker-v1.json', 77);
	const runtimeClosure = [artifact('runtime/libprofessional-runtime.dylib', 78)];
	const sourceAuthentication = {
		schemaVersion: 1, status: 'authenticated', sources: [{ id: 'electron-node-api-headers' }],
	};
	const buildAuthority = { sourceRevision: '1'.repeat(40), buildPlanSha256: '2'.repeat(64) };
	return {
		target, targetSource: 'declared', status: 'built', blockedBy: null,
		payloadManifest: { id: 'soundscaper-professional-native-host-1.0.0', byteLength: 401, sha256: digest },
		toolchainIdentity: 'fixture-cmake-toolchain',
		sourceAuthentication,
		buildAuthority,
		payload, buildResult, osAudioCodec, pluginPeer, deliveryFilesystem,
		isolation: {
			launcher, sandboxProfile, brokerPolicy, entrypointPath: pluginPeer.path, runtimeClosure,
		},
	};
}
