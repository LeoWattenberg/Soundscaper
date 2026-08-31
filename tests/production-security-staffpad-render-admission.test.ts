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

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/clip-time-pitch-render-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/clip-time-pitch-cache.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/parameters.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/client.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/worker.js' },
	{ kind: 'implementation', path: 'src/common/editor/staffpad/runtime.js' },
	{ kind: 'document', path: 'src/common/editor/staffpad/source-manifest.json' },
	{ kind: 'test', path: 'tests/audio-editor-clip-time-pitch-render-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-clip-time-pitch-cache.test.js' },
	{ kind: 'audit', path: 'scripts/audit-staffpad-wasm.mjs' },
] as const;

test('StaffPad clip-cache render admission remains narrowly evidenced and documented', async () => {
	const matrixText = await readFile(matrixUrl, 'utf8');
	const matrix = JSON.parse(matrixText) as SecurityMatrix;
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	assert.ok(cancellation, 'long-job-cancellation risk is required');
	assert.equal(cancellation.status, 'partial');

	const admission = cancellation.currentControls.find(
		({ id }) => id === 'serialized-staffpad-clip-render-admission',
	);
	assert.ok(admission, 'serialized StaffPad clip render admission control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`StaffPad render admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
	assert.match(admission.summary, /non-raiseable 256 MiB.*useful-binary.*lower-only/isu);
	assert.match(admission.summary, /full source.*first phase.*one input.*borrowed.*reverse.*two/isu);
	assert.match(admission.summary, /64 MiB.*WASM.*one bounded chunk/isu);
	assert.match(admission.summary, /serializ(?:e|es|ed|ation).*distinct.*render/isu);
	assert.match(admission.summary, /before.*quota.*source load.*worker.*writer/isu);
	assert.match(admission.summary, /queued.*abort.*never (?:starts|loads|renders)/isu);
	assert.match(admission.summary, /exact.*(?:job|plan).*deduplicat/isu);

	const residual = cancellation.residualRisks.find(
		({ id }) => id === 'render-worker-resident-set-accounting',
	);
	assert.ok(residual, 'render and worker resident-set residual is required');
	assert.equal(residual.ownerMilestone, '2');
	assert.match(residual.exposure, /useful-binary.*not.*browser heap.*RSS.*GC/isu);
	assert.match(residual.exposure, /other render paths/iu);
	assert.match(
		residual.exposure,
		/selected V27 editorial video proxies.*exact job-local body-capacity admission/isu,
	);
	assert.match(
		residual.exposure,
		/V27 owns menu-reached generation.*original-authoritative delivery refusal/isu,
	);
	assert.match(
		residual.exposure,
		/controls still provide no pre-encode end-to-end working-set.*product-wide qualification/isu,
	);
	assert.match(residual.requiredControl, /end-to-end.*browser.*worker.*renderer.*RSS/isu);
	assert.match(
		residual.requiredControl,
		/format-aware pre-encode maximum for genuine editorial video proxies/iu,
	);
	assert.ok(residual.acceptanceCriteria.length > 0);

	const threatModel = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const name = 'production threat model';
	assert.match(
		threatModel,
		/StaffPad.*clip[- ]cache.*non-raiseable 256 MiB.*useful-binary/isu,
		`${name} must state the narrow StaffPad useful-binary ceiling`,
	);
	assert.match(
		threatModel,
		/serializ(?:e|es|ed|ation).*distinct.*render.*before.*(?:source load|source loader).*worker.*writer/isu,
		`${name} must state the distinct-render serialization boundary`,
	);
	assert.match(
		threatModel,
		/browser heap.*(?:whole-process|renderer|process).*RSS.*GC/isu,
		`${name} must retain browser heap, RSS, and GC as residuals`,
	);
	assert.match(
		threatModel,
		/other render paths.*dedicated audio-codec\s+WebAssembly.*WebCodecs.*Mediabunny/isu,
		`${name} must retain other render paths as residuals`,
	);
	assert.match(
		threatModel,
		/selected Framescaper V27 activation\s+candidate locally implements.*general editorial proxy lifecycle.*Optional owner QA may record\s+observations but does not gate or activate either route.*Neither.*pre-encode end-to-end working-set.*process-RSS.*GC-headroom coverage/isu,
		`${name} must separate optional owner QA from the proxy lifecycle's unverified resource behavior`,
	);
});
