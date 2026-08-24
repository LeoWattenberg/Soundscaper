/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const ELECTRON_EVIDENCE = [
	'electron-builder.config.cjs',
	'config/electron-alternate-ffmpeg-manifest.json',
	'scripts/lib/electron-alternate-ffmpeg.mjs',
	'tests/desktop-electron-alternate-ffmpeg.test.js',
	'tests/production-security-desktop-codec-policy.test.js',
];

test('desktop codec security separates Electron framework, application, and external FFmpeg', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));
	const helperPayload = control(risks, 'native-helper-processes', 'verified-helper-engine-payload');
	const packageIntegrity = control(risks, 'runtime-supply-chain', 'desktop-fuse-and-package-integrity');

	assertEvidence(helperPayload, ELECTRON_EVIDENCE);
	assert.match(
		helperPayload.summary,
		/application supplies no FFmpeg helper engine.*application-supplied FFmpeg.*libav.*WebAssembly.*stock Electron 43\.1\.1.*proprietary codec support.*alternate framework library.*omit proprietary codec support.*electron-alternate-ffmpeg-manifest\.json.*not passed to the helper or audio broker.*not a Soundscaper codec-provider tier.*no bundled compressed-codec or operating-system execution factory.*first-party PCM container readers.*user-installed external FFmpeg.*distinct from the packaged framework library.*without copying.*complete codec inventory.*patent clearance/iu,
	);
	assertEvidence(packageIntegrity, [
		'.github/workflows/desktop-preview.yml',
		...ELECTRON_EVIDENCE,
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
		/application-codec policy.*renderer composition.*beforePack.*afterPack.*reject application-supplied FFmpeg.*libav.*WebAssembly.*static FFmpeg host.*downloadAlternateFFmpeg.*stock Electron 43\.1\.1.*proprietary codec support.*alternate framework library.*omit proprietary codec support.*afterPack verifies.*linux-x64.*linux-arm64.*mac-arm64.*win-x64.*win-arm64.*no mac-x64 target.*not a Soundscaper codec-provider tier.*patent clearance.*User-installed external FFmpeg.*distinct.*never copied/iu,
	);
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
