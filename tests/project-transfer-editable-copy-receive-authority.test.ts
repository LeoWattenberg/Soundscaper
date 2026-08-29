/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJsonRootSha256, canonicalJsonSha256 } from
	'../src/common/canonical-json-sha256.ts';
import { createCrossProductHandoffLaunchIntent } from
	'../src/common/cross-product-handoff-intent.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { convertCrossProductEditableCopy } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import { createCrossProductHandoffReportSidecar } from
	'../src/common/transfer/cross-product-handoff-report-sidecar.ts';
import {
	CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY,
	createCrossProductHandoffProvenanceFromReport,
	readCrossProductHandoffProvenance,
} from
	'../src/common/transfer/cross-product-handoff-provenance.ts';
import { importProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';

const ARCHIVE = new TextEncoder().encode('destination archive');

test('a sidecar-bound destination must independently be feature-compatible and editable', async () => {
	const source = createSoundscaperProject({
		id: 'receive-authority-source', now: '2026-08-29T12:00:00.000Z',
	});
	const converted = convertCrossProductEditableCopy({
		intent: createCrossProductHandoffLaunchIntent({
			sourceProject: source,
			destinationFamily: 'framescaper',
			invocationId: 'receive-authority-invocation',
			destinationProjectId: 'receive-authority-destination',
		}),
		sourceProject: source,
	});
	const destination = converted.report.destination!;
	const sidecar = createCrossProductHandoffReportSidecar({
		entryId: destination.projectId, archive: ARCHIVE, report: converted.report,
	});
	const rootDigests = Object.fromEntries(converted.report.roots.flatMap((root) => (
		root.destinationSha256 === null ? [] : [[root.root, root.destinationSha256]]
	)));
	const result = await importProjectTransferBundle({
		store: { loadProject: () => null },
		entries: [{
			projectId: destination.projectId, title: 'Destination', fileName: 'Destination.fscape',
			mimeType: 'application/vnd.kw.scape+zip', byteLength: ARCHIVE.byteLength,
			bytes: ARCHIVE, conversionReportSidecar: sidecar,
		}],
		inspectProject: () => ({
			id: destination.projectId, title: 'Destination', ...destination,
			exists: false, projectCanonicalRootSha256: rootDigests,
			projectCanonicalSha256: destination.sha256,
			projectCrossProductHandoffProvenance: readCrossProductHandoffProvenance(converted.project),
			featureRequirementsCompatibility: { compatible: false },
		}),
		importProject: () => assert.fail('an intrinsically read-only destination must not import'),
	});
	assert.equal(result.entries[0].outcome, 'failed');
	assert.equal(result.entries[0].reasonCode, 'archive-identity');
	assert.match(result.entries[0].reason ?? '', /feature|editable|compatible/iu);
	assert.equal(result.entries[0].conversionReport, null);
});

test('a null destination-root binding must prove that the archive omits that root', async () => {
	const source = createSoundscaperProject({
		id: 'null-root-source', now: '2026-08-29T12:00:00.000Z',
	});
	const converted = convertCrossProductEditableCopy({
		intent: createCrossProductHandoffLaunchIntent({
			sourceProject: source, destinationFamily: 'framescaper',
			invocationId: 'null-root-invocation', destinationProjectId: 'null-root-destination',
		}),
		sourceProject: source,
	});
	const roots = converted.report.roots.map((root) => root.root === 'metadata' ? {
		...root,
		disposition: 'omit-with-report' as const,
		reason: 'Forged omission.',
		destinationRef: null,
		destinationSha256: null,
	} : root);
	const claimed = { ...converted.report, roots };
	const project = {
		...converted.project,
		opaqueExtensions: {
			[CROSS_PRODUCT_HANDOFF_PROVENANCE_KEY]: createCrossProductHandoffProvenanceFromReport(claimed),
		},
	};
	const rootDigests = canonicalJsonRootSha256(project);
	const report = {
		...claimed,
		destination: { ...claimed.destination!, sha256: canonicalJsonSha256(project) },
		roots: roots.map((root) => root.destinationSha256 === null
			? root : { ...root, destinationSha256: rootDigests[root.root]! }),
	};
	const sidecar = createCrossProductHandoffReportSidecar({
		entryId: project.id, archive: ARCHIVE, report,
	});
	const result = await importProjectTransferBundle({
		store: { loadProject: () => null },
		entries: [{
			projectId: project.id, title: 'Destination', fileName: 'Destination.fscape',
			mimeType: 'application/vnd.kw.scape+zip', byteLength: ARCHIVE.byteLength,
			bytes: ARCHIVE, conversionReportSidecar: sidecar,
		}],
		inspectProject: () => ({
			id: project.id, title: 'Destination', schemaFamily: 'framescaper', schemaVersion: 1,
			exists: false, projectCanonicalRootSha256: rootDigests,
			projectCanonicalSha256: report.destination.sha256,
			projectCrossProductHandoffProvenance: readCrossProductHandoffProvenance(project),
			featureRequirementsCompatibility: { compatible: true },
		}),
		importProject: () => ({ project }),
	});
	assert.equal(result.entries[0].outcome, 'failed');
	assert.equal(result.entries[0].reasonCode, 'archive-identity');
	assert.equal(result.entries[0].conversionReport, null);
});
