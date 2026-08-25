/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const planUrl = new URL('../docs/desktop-codec-provider-plan.md', import.meta.url);
const ELECTRON_EVIDENCE = [
	'electron-builder.config.cjs',
	'config/electron-alternate-ffmpeg-manifest.json',
	'scripts/lib/electron-alternate-ffmpeg.mjs',
	'tests/desktop-electron-alternate-ffmpeg.test.js',
	'tests/production-security-desktop-codec-policy.test.js',
];
const BUNDLED_CODEC_EVIDENCE = [
	'src/common/editor/flac/source-manifest.json',
	'src/common/editor/opus/source-manifest.json',
	'src/common/editor/vorbis/source-manifest.json',
	'src/common/editor/wavpack/source-manifest.json',
	'src/common/editor/mpg123/source-manifest.json',
	'src/common/editor/lame/source-manifest.json',
	'src/common/editor/twolame/source-manifest.json',
	'src/common/editor/wavpack/NOTICE.md',
	'docs/desktop-codec-provider-plan.md',
	'src/common/editor/desktop-wavpack-codec-profile.ts',
	'scripts/audit-flac-wasm.mjs',
	'scripts/audit-opus-wasm.mjs',
	'scripts/audit-vorbis-wasm.mjs',
	'scripts/audit-wavpack-wasm.mjs',
	'scripts/audit-mpg123-wasm.mjs',
	'scripts/audit-lame-wasm.mjs',
	'scripts/audit-twolame-wasm.mjs',
	'scripts/lib/desktop-bundled-audio-runtime.mjs',
	'desktop/bundled-flac-audio-codec-runtime.ts',
	'desktop/bundled-opus-audio-codec-runtime.ts',
	'desktop/bundled-vorbis-audio-codec-runtime.ts',
	'desktop/bundled-wavpack-audio-codec-runtime.ts',
	'desktop/bundled-wavpack-stream.ts',
	'desktop/bundled-mpg123-audio-codec-runtime.ts',
	'desktop/bundled-lame-audio-codec-runtime.ts',
	'desktop/bundled-twolame-audio-codec-runtime.ts',
	'tests/desktop-bundled-flac-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-opus-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-vorbis-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-wavpack-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-mpg123-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-lame-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-twolame-audio-codec-runtime.test.ts',
	'tests/desktop-audio-codec-runtime-staging.test.js',
];
const OS_CODEC_EVIDENCE = [
	'native/os-audio-codec-host/CMakeLists.txt',
	'native/os-audio-codec-host/src/node_api_bridge.cpp',
	'desktop/os-audio-codec-runtime.ts',
	'desktop/os-audio-codec-canary-adapter.ts',
	'desktop/os-audio-codec-native-payload.mjs',
	'scripts/build-os-audio-codec-host.mjs',
	'scripts/ci-build-os-audio-codec-host.mjs',
	'scripts/lib/os-audio-codec-host-build.mjs',
	'scripts/lib/os-audio-codec-host-ci.mjs',
	'scripts/lib/os-audio-codec-native-payload.mjs',
	'scripts/lib/desktop-os-audio-codec-native-staging.mjs',
	'scripts/lib/desktop-os-audio-codec-native-package-verification.mjs',
	'scripts/lib/desktop-package-os-audio-codec-closure.mjs',
	'tests/desktop-os-audio-codec-runtime.test.ts',
	'tests/os-audio-codec-host-build.test.js',
	'tests/os-audio-codec-host-ci.test.js',
	'tests/os-audio-codec-native-payload.test.js',
	'tests/desktop-packaged-os-audio-codec-native.test.js',
];
const EXTERNAL_CODEC_EVIDENCE = [
	'desktop/external-ffmpeg-audio-operation-runner.ts',
	'desktop/external-ffmpeg-installer.ts',
	'src/common/editor/ui/dialogs/DesktopFfmpegPreferencePanel.tsx',
	'tests/desktop-external-ffmpeg-audio-operation-runner.test.ts',
	'tests/desktop-external-ffmpeg-installer.test.ts',
];

test('desktop codec security separates Electron framework, application, and external FFmpeg', async () => {
	const [matrixText, plan] = await Promise.all([
		readFile(matrixUrl, 'utf8'),
		readFile(planUrl, 'utf8'),
	]);
	const matrix = JSON.parse(matrixText);
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));
	const helperPayload = control(risks, 'native-helper-processes', 'verified-helper-engine-payload');
	const packageIntegrity = control(risks, 'runtime-supply-chain', 'desktop-fuse-and-package-integrity');

	assertEvidence(helperPayload, ELECTRON_EVIDENCE);
	assertEvidence(helperPayload, BUNDLED_CODEC_EVIDENCE);
	assertEvidence(helperPayload, OS_CODEC_EVIDENCE);
	assertEvidence(helperPayload, EXTERNAL_CODEC_EVIDENCE);
	assertEvidence(helperPayload, [
		'src/common/editor/controller/desktop-audio-export-capability.ts',
		'tests/audio-editor-desktop-export-capability.test.ts',
		'tests/audio-editor-desktop-export-codec-model.test.ts',
		'tests/audio-editor-desktop-export-dialog-capability.test.js',
	]);
	assert.match(
		helperPayload.summary,
		/application supplies no FFmpeg helper engine.*application-supplied FFmpeg.*libav.*FFmpeg WebAssembly.*alternate Chromium libffmpeg.*framework exception.*never a Soundscaper provider tier/iu,
	);
	assert.match(
		helperPayload.summary,
		/seven exact reviewed compressed-audio WebAssembly payloads.*linux-x64.*linux-arm64.*mac-arm64.*win-x64.*win-arm64.*never mac-x64.*153,044-byte libFLAC 1\.5\.0.*385,789-byte libopus 1\.6\.1.*523,227-byte libvorbis 1\.3\.7.*145,537-byte WavPack 5\.9\.0.*172,329-byte mpg123 1\.33\.7.*212,205-byte LAME 4\.0.*146,820-byte TwoLAME 0\.4\.0.*exact settings.*libsndfile is not bundled/iu,
	);
	assert.match(
		helperPayload.summary,
		/32 MiB input.*128 MiB output.*whole buffers.*synchronous WASM.*cannot be interrupted.*aggregate copies.*RSS.*Media Foundation.*AudioToolbox.*target-native.*mac-arm64.*win-x64.*win-arm64.*native canar.*signed.*exact.*manifest.*payload.*Linux.*no uniform OS tier/iu,
	);
	assert.match(
		helperPayload.summary,
		/user-installed FFmpeg\/ffprobe 4\.4 through 9\.x.*Edit > Preferences > General.*WinGet\/Homebrew.*do not close hash-before-path-spawn TOCTOU.*impose an OS RSS\/CPU sandbox.*malicious selected executable.*network authority.*null timing.*audio-only.*no WebM\/AV1 payload.*five-target AV1 evidence.*fail closed.*neither patent clearance nor non-infringement/iu,
	);
	assertEvidence(packageIntegrity, [
		'.github/workflows/desktop-preview.yml',
		...ELECTRON_EVIDENCE,
		...BUNDLED_CODEC_EVIDENCE,
		'scripts/lib/desktop-codec-policy.mjs',
		'scripts/lib/desktop-renderer-codec-audit.mjs',
		'scripts/lib/desktop-bundled-codec-notices.mjs',
		'scripts/desktop-prepare.mjs',
		'scripts/desktop-before-pack.mjs',
		'scripts/desktop-after-pack.mjs',
		'scripts/desktop-release-assets.mjs',
		'scripts/lib/desktop-os-audio-codec-native-package-verification.mjs',
		'scripts/lib/desktop-package-os-audio-codec-closure.mjs',
		'tests/desktop-packaged-ffmpeg-runtime.test.js',
		'tests/desktop-packaged-os-audio-codec-native.test.js',
		'tests/desktop-bundled-codec-notices.test.js',
		'tests/desktop-release-package-inventory.test.js',
	]);
	assert.match(
		packageIntegrity.summary,
		/application-codec policy.*reject application-supplied FFmpeg.*libav.*FFmpeg WebAssembly.*static FFmpeg host.*WebM\/AV1 payloads.*exactly seven reviewed compressed-audio WASM files.*libFLAC.*libopus.*libvorbis.*WavPack.*mpg123.*LAME.*TwoLAME.*exact-length.*SHA-256.*undeclared codec WASM.*target-native.*OS codec.*mac-arm64.*win-x64.*win-arm64.*signed.*exact.*manifest.*payload.*no mac-x64.*downloadAlternateFFmpeg.*linux-x64.*linux-arm64.*mac-arm64.*win-x64.*win-arm64.*no mac-x64 target.*neither patent clearance nor non-infringement.*user-installed external FFmpeg.*WinGet\/Homebrew.*never copied/iu,
	);
	assert.match(
		plan,
		/Implementation status.*seven\s+reviewed compressed-audio WebAssembly payloads.*libFLAC 1\.5\.0.*libopus 1\.6\.1.*libvorbis 1\.3\.7.*WavPack 5\.9\.0.*mpg123 1\.33\.7.*LAME 4\.0.*TwoLAME 0\.4\.0/isu,
	);
	assert.match(
		plan,
		/libsndfile is intentionally not added.*32 MiB.*128 MiB.*synchronous WASM.*Cancellation.*cannot interrupt.*WASM invocation/isu,
	);
	assert.match(
		plan,
		/Media Foundation.*AudioToolbox.*target-native.*mac-arm64.*win-x64.*win-arm64.*native codec canar.*sign.*package.*Linux.*no uniform OS tier.*FFmpeg CLI.*4\.4 through 9\.x.*Edit > Preferences > General.*BtbN\.FFmpeg\.GPL\.8\.1.*brew install ffmpeg/isu,
	);
	assert.match(
		plan,
		/WebM\/AV1 execution tier is not implemented.*dav1d.*SVT-AV1.*libaom.*no libwebm\/libvpx\/dav1d\/SVT-AV1\/libaom\s+payload.*audio operations only.*fail.*closed/isu,
	);
	assert.match(
		plan,
		/time-of-check\/time-of-use.*no operating-\s*system RSS or CPU sandbox.*malicious user-selected executable/isu,
	);
	assert.doesNotMatch(plan, /patent[- ]free/iu);
});

function control(risks, riskId, controlId) {
	const found = risks.get(riskId)?.currentControls.find(({ id }) => id === controlId);
	assert.ok(found, `${riskId} must retain ${controlId}`);
	return found;
}

function assertEvidence(controlValue, paths) {
	for (const path of paths) {
		assert.ok(controlValue.evidence.some((item) => item.path === path), `${controlValue.id} needs ${path}`);
	}
}
