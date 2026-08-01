/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface SecurityEvidence {
	readonly kind: string;
	readonly path: string;
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: readonly SecurityEvidence[];
}

interface SecurityResidual {
	readonly id: string;
	readonly exposure: string;
	readonly requiredControl: string;
	readonly ownerMilestone: string;
	readonly acceptanceCriteria: readonly string[];
}

interface SecurityRisk {
	readonly id: string;
	readonly status: string;
	readonly currentControls: readonly SecurityControl[];
	readonly residualRisks: readonly SecurityResidual[];
}

interface SecurityMatrix {
	readonly modelDocument: string;
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'scripts/lib/offline-application-shell.mjs' },
	{ kind: 'implementation', path: 'scripts/lib/offline-service-worker.mjs' },
	{ kind: 'implementation', path: 'src/common/offline/application-shell.ts' },
	{ kind: 'implementation', path: 'src/common/offline/ffmpeg-runtime-cache.ts' },
	{ kind: 'implementation', path: 'src/common/offline/browser-runtime-store.ts' },
	{ kind: 'implementation', path: 'src/common/offline/browser-ffmpeg-runtime.ts' },
	{ kind: 'implementation', path: 'src/common/editor/ffmpeg.js' },
	{ kind: 'implementation', path: 'src/common/editor/ui/dialogs/OfflineRuntimePreferencePanel.tsx' },
	{ kind: 'test', path: 'tests/offline-application-shell-build.test.js' },
	{ kind: 'test', path: 'tests/offline-service-worker.test.js' },
	{ kind: 'test', path: 'tests/offline-ffmpeg-runtime-cache.test.ts' },
	{ kind: 'test', path: 'tests/offline-browser-runtime-store.test.ts' },
	{ kind: 'test', path: 'tests/browser/offline-application-shell.spec.js' },
	{ kind: 'test', path: 'tests/browser/offline-ffmpeg-runtime-download.spec.js' },
	{ kind: 'test', path: 'tests/browser/offline-ffmpeg-runtime-service-worker.spec.js' },
] as const;

test('the offline application shell and explicit runtime cache remain narrowly evidenced', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8')) as SecurityMatrix;
	const supplyChain = matrix.risks.find(({ id }) => id === 'runtime-supply-chain');
	assert.ok(supplyChain, 'runtime-supply-chain risk is required');
	assert.equal(supplyChain.status, 'partial');

	const control = supplyChain.currentControls.find(
		({ id }) => id === 'verified-web-offline-shell-and-runtime-cache',
	);
	assert.ok(control, 'verified Web offline-shell and runtime-cache control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			control.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`offline control needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
	assert.match(control.summary, /4,?096 assets.*25 MiB.*256 MiB.*SHA-256/isu);
	assert.match(control.summary, /readiness last.*failed installation.*candidate/isu);
	assert.match(control.summary, /claims clients before retiring.*older.*shell/isu);
	assert.match(control.summary, /explicit FFmpeg runtime download.*no runtime download.*implicitly/isu);
	assert.match(control.summary, /64 KiB.*512 KiB.*64 MiB.*65 MiB.*4 MiB/isu);
	assert.match(control.summary, /pinned production origin.*content-addressed.*release/isu);
	assert.match(control.summary, /complete files.*active-state.*prior complete release/isu);
	assert.match(control.summary, /Web Locks.*serializ.*commit/isu);
	assert.match(control.summary, /state-committed.*active.*previous.*eligible/isu);
	assert.match(control.summary, /cached.*stream.*byte.*SHA-256/isu);
	assert.match(control.summary, /Content-Encoding.*decoded.*authoritative/isu);
	assert.match(control.summary, /installed release.*network fallback/isu);

	const residual = supplyChain.residualRisks.find(
		({ id }) => id === 'served-external-runtime-authentication',
	);
	assert.ok(residual, 'served runtime-authentication residual is required');
	assert.equal(residual.ownerMilestone, '2');
	assert.match(residual.exposure, /consumer-side consistency.*not.*authenticity root/isu);
	assert.match(residual.exposure, /compromised asset host.*self-consistent release/isu);
	assert.match(residual.exposure, /conditional-create.*read-back/isu);
	assert.match(residual.exposure, /0\.12\.10.*without proving agreement/isu);
	assert.doesNotMatch(residual.exposure, /separate tabs.*not globally serialized/isu);
	assert.match(residual.exposure, /Web Locks.*cooperat.*(?:older|noncooperating).*CacheStorage.*quota/isu);
	assert.match(residual.requiredControl, /reviewed policy.*authenticate.*conditional.*remote reads/isu);
	assert.ok(residual.acceptanceCriteria.length > 0);

	const threatModel = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/Web Core — Implemented \(provisional\):.*installable verified application\s+shell/isu,
		'roadmap must retain the concise offline-shell status',
	);
	const name = 'production threat model';
	const scope = offlineThreatModelScope(threatModel);
	assert.match(scope, /4,?096.*25 MiB.*256 MiB.*SHA-256/isu, `${name} must retain shell bounds`);
	assert.match(scope, /readiness.*last.*failed.*candidate/isu, `${name} must retain shell commit ordering`);
	assert.match(scope, /explicit.*FFmpeg.*(?:user action|download)/isu, `${name} must retain explicit runtime installation`);
	assert.match(scope, /64 KiB.*512 KiB.*64 MiB.*65 MiB.*4 MiB/isu, `${name} must retain runtime bounds`);
	assert.match(scope, /previous.*complete release/isu, `${name} must retain runtime rollback`);
	assert.match(scope, /Web Locks.*serializ/isu, `${name} must retain serialized runtime publication`);
	assert.match(scope, /state-committed.*active.*previous/isu, `${name} must retain committed-only runtime serving`);
	assert.match(scope, /cached.*(?:body|response).*SHA-256/isu, `${name} must retain cached-body verification`);
	assert.match(scope, /compromised asset host.*self-consistent release/isu, `${name} must retain the authenticity residual`);
	assert.match(scope, /conditional.*read[- ]back/isu, `${name} must retain publisher gaps`);
	assert.match(scope, /multi-tab.*unqualified/isu, `${name} must retain the actual-browser multi-tab gap`);
	assert.match(scope, /CacheStorage.*(?:quota|eviction)/isu, `${name} must retain storage-pressure scope`);
});

function offlineThreatModelScope(documentation: string): string {
	const marker = /The Web application shell now has a separate verified availability boundary/iu.exec(documentation);
	assert.ok(marker, 'threat model must document the offline application shell');
	return documentation.slice(marker.index, marker.index + 7_000);
}
