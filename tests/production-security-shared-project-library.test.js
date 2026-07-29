/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('shared desktop project publication is fenced and remains narrowly partial', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const boundary = matrix.boundaries.find(({ id }) => id === 'electron-main-to-shared-project-library');
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'fenced-current-schema-project-catalog-publication',
	);

	assert.ok(boundary);
	assert.deepEqual(boundary.entryPoints, [
		'desktop/project-library-contract.ts',
		'desktop/project-library.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-host.ts',
	]);
	assert.ok(risk);
	assert.ok(matrix.roadmapThreatCoverage['malformed-projects-media'].includes(risk.id));
	assert.ok(matrix.roadmapThreatCoverage['path-capabilities'].includes(risk.id));
	assert.equal(risk.status, 'partial');
	assert.equal(risk.releaseDisposition, 'conditional');
	assert.deepEqual(risk.boundaryIds, ['electron-main-to-shared-project-library']);
	assert.ok(control);
	for (const path of [
		'desktop/project-library-contract.ts',
		'desktop/project-library-persistence.ts',
		'desktop/project-library.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-host.ts',
		'src/common/editor/scape-project-document.ts',
		'tests/desktop-project-library.test.ts',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-handoff.test.ts',
		'tests/desktop-project-library-packaging.test.js',
		'tests/production-security-shared-project-library.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path));
	assert.match(
		control.summary,
		/main-process-only metadata schema 2.*separate opaque library entry ID.*exact schema 9.*bounded byte length.*SHA-256.*immutable revision-and-digest path.*canonical tagged-binary codec.*non-raiseable 256 MiB.*lower-only test seam.*persistence root identity.*private file.*syncs it.*atomically renames it.*reverifies.*before an exact plus-one catalog journal publication.*before staging.*before publication.*transactionally at catalog commit.*serializes commits.*renews its lease while close drains admitted work.*source-free orderly Soundscaper-to-Framescaper-to-Soundscaper handoff.*fencing tokens 1, 2, and 3.*no stale takeover.*full schema-9 domain validation remains the editor activation boundary.*no renderer path or IPC surface/isu,
	);
	assert.deepEqual(
		risk.residualRisks.map(({ id }) => id).sort(),
		[
			'shared-library-editor-media-and-migration-integration',
			'shared-library-orphan-reclamation',
			'shared-library-packaged-platform-durability',
		],
	);
});
