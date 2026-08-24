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
const WAVPACK_EVIDENCE = [
	'src/common/editor/wavpack/source-manifest.json',
	'src/common/editor/wavpack/NOTICE.md',
	'docs/desktop-codec-provider-plan.md',
	'src/common/editor/desktop-wavpack-codec-profile.ts',
	'scripts/audit-wavpack-wasm.mjs',
	'scripts/lib/desktop-bundled-wavpack-runtime.mjs',
	'desktop/bundled-wavpack-audio-codec-runtime.ts',
	'desktop/bundled-wavpack-stream.ts',
	'tests/desktop-bundled-wavpack-audio-codec-runtime.test.ts',
	'tests/desktop-audio-codec-runtime-staging.test.js',
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
	assertEvidence(helperPayload, WAVPACK_EVIDENCE);
	assertEvidence(helperPayload, [
		'src/common/editor/controller/desktop-audio-export-capability.ts',
		'tests/audio-editor-desktop-export-capability.test.ts',
		'tests/audio-editor-desktop-export-codec-model.test.ts',
		'tests/audio-editor-desktop-export-dialog-capability.test.js',
	]);
	assert.match(
		helperPayload.summary,
		/application supplies no FFmpeg helper engine.*application-supplied FFmpeg.*libav.*WebAssembly.*stock Electron 43\.1\.1.*proprietary codec support.*alternate framework library.*omit proprietary codec support.*electron-alternate-ffmpeg-manifest\.json.*not passed to the helper or audio broker.*not a Soundscaper codec-provider tier/iu,
	);
	assert.match(
		helperPayload.summary,
		/exactly one bundled compressed-codec runtime.*145,537-byte WavPack 5\.9\.0 WebAssembly.*c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908.*linux-x64.*linux-arm64.*mac-arm64.*win-x64.*win-arm64.*never mac-x64.*float32.*compression level 2.*exact bytes.*encode\/parse\/decode canary.*strict.*checksum.*output bounds.*stock WavPack 5\.9\.0 decoder witness.*No other bundled.*no operating-system execution factory.*user-installed external FFmpeg.*exact reviewed slice.*patent clearance/iu,
	);
	assertEvidence(packageIntegrity, [
		'.github/workflows/desktop-preview.yml',
		...ELECTRON_EVIDENCE,
		...WAVPACK_EVIDENCE,
		'scripts/lib/desktop-codec-policy.mjs',
		'scripts/lib/desktop-renderer-codec-audit.mjs',
		'scripts/desktop-prepare.mjs',
		'scripts/desktop-before-pack.mjs',
		'scripts/desktop-after-pack.mjs',
		'scripts/desktop-release-assets.mjs',
		'tests/desktop-packaged-ffmpeg-runtime.test.js',
		'tests/desktop-release-package-inventory.test.js',
	]);
	assert.match(
		packageIntegrity.summary,
		/application-codec policy.*renderer composition.*reject application-supplied FFmpeg.*libav.*WebAssembly.*static FFmpeg host.*one admitted non-FFmpeg compressed-codec payload.*WavPack 5\.9\.0 WebAssembly.*exact regular 145,537-byte file.*c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908.*no other codec WASM.*downloadAlternateFFmpeg.*stock Electron 43\.1\.1.*proprietary codec support.*alternate framework library.*omit proprietary codec support.*afterPack verifies.*linux-x64.*linux-arm64.*mac-arm64.*win-x64.*win-arm64.*no mac-x64 target.*WavPack.*no patent-clearance.*not a Soundscaper codec-provider tier.*User-installed external FFmpeg.*distinct.*never copied/iu,
	);
	assert.match(
		plan,
		/Implementation status.*first bundled compressed-codec slice is implemented.*WavPack 5\.9\.0.*145,537-byte.*c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908.*compression level 2.*shared profile constant.*pre-render export.*capability gate.*desktop dialog/isu,
	);
	assert.match(
		plan,
		/regular-file.*during staging.*startup.*byte length and digest.*encode\/parse\/decode canary.*strict bounded parser/isu,
	);
	assert.match(
		plan,
		/stock WavPack 5\.9\.0.*b7f8cd1d8e1a00374f618587eb2c5872fcd250d8686c9cbda0b46e00003ea40f.*All other bundled.*operating-system.*fail\s+closed.*not patent\s+clearance/isu,
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
