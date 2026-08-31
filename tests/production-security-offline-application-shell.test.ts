/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'document', path: 'public/_headers' },
	{ kind: 'implementation', path: 'scripts/lib/offline-application-shell.mjs' },
	{ kind: 'implementation', path: 'scripts/lib/offline-shell-worker.mjs' },
	{ kind: 'implementation', path: 'scripts/lib/offline-service-worker.mjs' },
	{ kind: 'implementation', path: 'scripts/lib/browser-bundle-codec-audit.mjs' },
	{ kind: 'implementation', path: 'src/common/offline/application-shell.ts' },
	{ kind: 'implementation', path: 'src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx' },
	{ kind: 'test', path: 'tests/offline-application-shell-build.test.js' },
	{ kind: 'test', path: 'tests/offline-service-worker.test.js' },
	{ kind: 'test', path: 'tests/offline-service-worker-runtime-fetch.test.js' },
	{ kind: 'test', path: 'tests/offline-application-shell-registration.test.ts' },
	{ kind: 'test', path: 'tests/browser-bundle-codec-audit.test.js' },
	{ kind: 'test', path: 'tests/browser/offline-application-shell.spec.js' },
	{ kind: 'test', path: 'tests/browser/offline-ffmpeg-runtime-download.spec.js' },
] as const;

test('the offline application shell explicitly excludes an FFmpeg runtime cache', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const supplyChain = matrix.risks.find(({ id }: { id: string }) => id === 'runtime-supply-chain');
	assert.ok(supplyChain);
	const control = supplyChain.currentControls.find(
		({ id }: { id: string }) => id === 'verified-web-offline-shell-and-runtime-cache',
	);
	assert.ok(control);
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			control.evidence.some(
				({ kind, path }: { kind: string; path: string }) => (
					kind === expected.kind && path === expected.path
				),
			),
			`offline control needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
	for (const obsolete of [
		'src/common/offline/ffmpeg-runtime-cache.ts',
		'src/common/offline/browser-runtime-store.ts',
		'src/common/offline/browser-ffmpeg-runtime.ts',
		'src/common/editor/ui/dialogs/OfflineRuntimePreferencePanel.tsx',
	]) assert.equal(control.evidence.some(({ path }: { path: string }) => path === obsolete), false);

	assert.match(control.summary, /schema v2.*verified allowlist.*Soundscaper\/Framescaper/isu);
	assert.match(control.summary, /4,?096.*25 MiB.*4 MiB per descriptor.*256 MiB.*SHA-256/isu);
	assert.match(control.summary, /register after readiness\/idle.*without blocking/isu);
	assert.match(control.summary, /four requests.*4 MiB.*readiness last.*failed candidate/isu);
	assert.match(control.summary, /offline boundary is application shell only/isu);
	assert.match(
		control.summary,
		/UI has no FFmpeg installer.*service worker has no FFmpeg fetch\/cache\/serve path.*old runtime URLs bypass.*bundle audit rejects/isu,
	);
	assert.match(
		control.summary,
		/Dedicated audio WASMs.*WebCodecs\/Mediabunny chunks.*ordinary digest-bound build assets.*not a mutable external runtime/isu,
	);

	assert.equal(
		matrix.publicationFaultVerification.paths.some(
			({ id }: { id: string }) => id === 'offline-runtime-cache',
		),
		false,
	);
	const residual = supplyChain.residualRisks.find(
		({ id }: { id: string }) => id === 'served-external-runtime-authentication',
	);
	assert.ok(residual);
	assert.match(residual.exposure, /development-only legacy audit machinery.*no production browser consumes/isu);
	assert.match(residual.exposure, /blocked by the bundle audit.*explicit architecture change/isu);

	const threatModel = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(roadmap, /installable verified application\s+shell/isu);
	const scope = offlineThreatModelScope(threatModel);
	assert.match(scope, /4,?096.*25 MiB.*256 MiB.*SHA-256/isu);
	assert.match(scope, /readiness.*last.*failed.*candidate/isu);
	assert.match(scope, /no FFmpeg.*(?:installer|runtime).*no.*fetch.*cache.*serve/isu);
	assert.match(scope, /ordinary\s+digest-bound application assets/isu);
	assert.doesNotMatch(scope, /explicit Web FFmpeg download follows/iu);
	assert.doesNotMatch(scope, /retains one previous complete release/iu);
});

function offlineThreatModelScope(documentation: string): string {
	const marker = /The Web application shell now has a separate verified availability boundary/iu.exec(documentation);
	assert.ok(marker, 'threat model must document the offline application shell');
	return documentation.slice(marker.index, marker.index + 5_000);
}
