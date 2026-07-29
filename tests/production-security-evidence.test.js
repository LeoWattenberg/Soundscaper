/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const EVIDENCE_KINDS = ['implementation', 'test', 'workflow', 'audit', 'document'];

test('security claims point to checked-in implementation and verification evidence', async () => {
	const matrix = await readMatrix();
	const boundaries = new Map(matrix.boundaries.map((boundary) => [boundary.id, boundary]));
	assert.equal(boundaries.size, matrix.boundaries.length, 'boundary IDs must be unique');

	const evidence = [];
	for (const boundary of matrix.boundaries) {
		assert.match(boundary.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		assert.ok(boundary.entryPoints.length > 0, `${boundary.id} needs an entry point or explicit fence`);
		evidence.push(...boundary.evidence);
	}
	for (const risk of matrix.risks) {
		for (const boundaryId of risk.boundaryIds) assert.ok(boundaries.has(boundaryId), `${risk.id} references ${boundaryId}`);
		for (const control of risk.currentControls) {
			assert.match(control.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
			assert.ok(control.summary.length > 0, `${risk.id}/${control.id} needs a summary`);
			assert.ok(control.evidence.length > 0, `${risk.id}/${control.id} needs evidence`);
			evidence.push(...control.evidence);
		}
	}

	for (const item of evidence) {
		assert.ok(EVIDENCE_KINDS.includes(item.kind), `invalid evidence kind ${item.kind}`);
		assert.ok(item.path !== matrix.modelDocument, 'the threat model is not implementation evidence');
		assert.notEqual(item.path, 'roadmap.md', 'the roadmap is not implementation evidence');
		await assert.doesNotReject(
			access(new URL(`../${item.path.split('#')[0]}`, import.meta.url)),
			`Missing security evidence: ${item.path}`,
		);
	}
});

test('threat-model documentation defines the limits of enforced controls', async () => {
	const matrix = await readMatrix();
	const documentationUrl = new URL(`../${matrix.modelDocument}`, import.meta.url);
	const documentation = await readFile(documentationUrl, 'utf8');

	for (const risk of matrix.risks) assert.match(documentation, new RegExp(`\\b${risk.id}\\b`, 'u'));
	assert.match(documentation, /enforced does not mean risk-free/iu);
	assert.match(documentation, /workers? provide fault isolation, not an operating-system security boundary/iu);
	assert.match(documentation, /native plug-ins? execute arbitrary code with the user account's authority/iu);
	assert.match(documentation, /local operating-system compromise is out of scope/iu);
	assert.match(
		documentation,
		/desktop-read-path-capabilities.*enforced for the current bounded materialization surface.*512 MiB.*preload.*renderer materializer.*exact declared `Content-Length`.*emitted-byte.*final `Blob`-size.*response body stream.*16 MiB.*platform media-chunk limit.*caller-supplied `AbortSignal`.*stalled body read.*exact reason.*never calls `response\.blob\(\)`.*scoped descriptor.*protocol request abort.*whole `Blob`.*not decoder amplification or whole-process RSS.*larger range-backed reads.*fail admission/isu,
	);
	assert.match(
		documentation,
		/bounded desktop materializer.*forwards a supplied signal.*releases its capability on abort.*open.*import orchestration does not consistently own or provide that signal/isu,
	);
});

test('desktop save admission evidence pins product-wide capacity before staging', async () => {
	const matrix = await readMatrix();
	const desktopWrite = matrix.risks.find(({ id }) => id === 'desktop-write-path-capabilities');
	assert.ok(desktopWrite);
	assert.equal(desktopWrite.status, 'partial');
	assert.equal(desktopWrite.releaseDisposition, 'conditional');

	const admission = desktopWrite.currentControls.find(
		({ id }) => id === 'aggregate-save-capacity-and-disk-admission',
	);
	assert.ok(admission);
	assert.match(
		admission.summary,
		/16 outstanding product-wide targets.*4 pending or live sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously.*before the first await.*lower-only.*bigint `statfs`.*available.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged/iu,
	);
	for (const path of [
		'desktop/constants.js',
		'desktop/preload.mjs',
		'desktop/save-targets.js',
		'tests/desktop-save-capacity.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(admission.evidence.some((item) => item.path === path));

	assert.equal(desktopWrite.residualRisks.some(
		({ id }) => id === 'write-capacity-and-disk-admission',
	), false);
	assert.ok(desktopWrite.residualRisks.some(
		({ id }) => id === 'in-flight-write-cancellation',
	));

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/desktop-write-path-capabilities.*partial.*16 outstanding product-wide save targets.*4 pending or live save sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously before the first await.*lower-only.*BigInt `statfs`.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged.*active chunk.*parent-directory/isu,
	);

	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/Electron Enhanced — In progress:.*16 outstanding product-wide save targets.*4\s+pending or live save sessions.*65 GiB per-save and aggregate admitted\s+bytes.*BigInt `statfs`.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup\s+failure.*charged/isu,
	);
});

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}
