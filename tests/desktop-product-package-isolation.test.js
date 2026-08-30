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
	soundscaperConstantsSource,
	soundscaperDesktopCodecSource,
	soundscaperMainSource,
	soundscaperNativeTierSource,
	soundscaperPreloadSource,
	soundscaperProductIsolationModuleSource,
	soundscaperProjectRuntimeSource,
	soundscaperProtocolSource,
} from '../scripts/lib/desktop-product-package-files.mjs';

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
	assert.equal(desktopProductSourceIncluded('soundscaper', 'display-capture.js'), false);
	assert.doesNotThrow(() => assertDesktopProductPackageIsolation('soundscaper', [
		'desktop/main.mjs',
		'desktop/project-library-runtime/src/common/editor/scape-project-document.js',
	]));
	assert.throws(() => assertDesktopProductPackageIsolation('soundscaper', [
		'desktop/main.mjs',
		'desktop/project-library-runtime/desktop/native-services-runtime.js',
	]), /Framescaper-owned files/iu);
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
	const stagedNativeTier = soundscaperNativeTierSource(nativeTier);
	const stagedPreload = soundscaperPreloadSource(preload);
	const stagedProjectRuntime = soundscaperProjectRuntimeSource(projectRuntime);
	const stagedProtocol = soundscaperProtocolSource(protocol);
	assert.doesNotMatch(stagedMain, /from '\.\/framescaper-|createFramescaper|startFramescaper/u);
	assert.doesNotMatch(stagedMain, /desktopCapturer/u);
	assert.doesNotMatch(stagedPreload,
		/framescaperDesktop|framescaper:v1:|FRAMESCAPER_WEB_VCR_|chooseLinkedVideo|DesktopVideo/u);
	assert.doesNotMatch(stagedProjectRuntime,
		/project-library-runtime\/desktop\/framescaper-|FramescaperDesktopProjectLibrary/u);
	assert.doesNotMatch(stagedConstants,
		/framescaper:v1:|FRAMESCAPER_WEB_VCR_|chooseLinkedVideo|desktopVideoCodec/u);
	assert.doesNotMatch(stagedCodec, /registerDesktopVideoCodecs|registerVideoCodecs/u);
	assert.doesNotMatch(stagedNativeTier, /registerDesktopHelperProbe/u);
	assert.doesNotMatch(stagedProtocol, /FRAMESCAPER_CAPTURE_POLICY|productId === 'framescaper'/u);
	assert.doesNotMatch(stagedProtocol, /display-capture=\(self\)/u);
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
