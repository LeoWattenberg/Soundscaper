/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	aggregateMilestone5HandoffMatrix,
	auditMilestone5HandoffMatrixDirectory,
	MILESTONE_5_PACKAGE_CELLS,
} from '../scripts/lib/milestone-5-handoff-matrix.mjs';

const REVISION = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

test('the package matrix validates every target without release qualification state', () => {
	const matrix = aggregateMilestone5HandoffMatrix(MILESTONE_5_PACKAGE_CELLS.map(cell));

	assert.equal(matrix.schemaVersion, 3);
	assert.equal(matrix.kind, 'milestone-5-package-matrix-audit');
	assert.equal(matrix.cellCount, 10);
	assert.equal(matrix.inputsAuthenticated, false);
	assert.equal(matrix.passed, false);
	assert.equal(matrix.status, 'unattributed');
	assert.equal(matrix.packageCount, 10);
	assert.equal(Object.hasOwn(matrix, 'qualificationSourceRevision'), false);
	assert.equal(Object.hasOwn(matrix, 'milestoneReleaseReady'), false);
	assert.equal(Object.hasOwn(matrix, 'milestoneAutomatedReady'), false);
});

test('the package matrix rejects duplicate cells and tampered audit digests', () => {
	const duplicate = MILESTONE_5_PACKAGE_CELLS.map(cell);
	duplicate[1] = structuredClone(duplicate[0]);
	assert.throws(() => aggregateMilestone5HandoffMatrix(duplicate), /unique/iu);

	const tampered = MILESTONE_5_PACKAGE_CELLS.map(cell);
	tampered[0].evidenceSha256 = 'c'.repeat(64);
	assert.throws(() => aggregateMilestone5HandoffMatrix(tampered), /result state/iu);
});

test('serialized package audits must be canonical, complete, and direct', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m5-package-audits-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	for (const identity of MILESTONE_5_PACKAGE_CELLS) {
		await writeFile(
			join(directory, `milestone-5-${identity.productId}-${identity.targetId}.json`),
			`${JSON.stringify(cell(identity), null, '\t')}\n`,
		);
	}
	const audited = await auditMilestone5HandoffMatrixDirectory(directory);
	assert.equal(audited.status, 'unattributed');
	assert.equal(audited.fileDescriptors.length, 10);

	await mkdir(join(directory, 'foreign'));
	await assert.rejects(
		auditMilestone5HandoffMatrixDirectory(directory),
		/missing or unexpected entries/iu,
	);
});

function cell(identity) {
	const evidence = {
		schemaVersion: 1,
		sources: [],
		payloads: [],
		package: { productId: identity.productId, targetId: identity.targetId },
	};
	const packageName = `${identity.productId}-${identity.targetId}.zip`;
	return {
		schemaVersion: 3,
		kind: 'milestone-5-package-audit',
		assessmentScope: { kind: 'package-cell', ...identity },
		sourceRevision: REVISION,
		observedHeadRevision: REVISION,
		sourceRevisionBinding: {
			status: 'authenticated-clean-head',
			sourceRevision: REVISION,
		},
		evidenceAuthenticated: true,
		passed: true,
		status: 'passed',
		evidence,
		evidenceSha256: sha256(JSON.stringify(evidence)),
		failures: [],
		package: {
			status: 'installed-application-closure-audited',
			evidenceSha256: DIGEST,
			productId: identity.productId,
			targetId: identity.targetId,
			applicationVersion: '1.0.0',
			sourceRevision: REVISION,
			runtimeManifest: {
				name: `runtime-manifest-${identity.productId}-${identity.targetId}.json`,
				byteLength: 100,
				sha256: DIGEST,
			},
			packages: [{
				label: 'archive',
				name: packageName,
				byteLength: 1_000,
				sha256: DIGEST,
				content: null,
			}],
			packageCount: 1,
			totalPackageBytes: 1_000,
		},
	};
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
