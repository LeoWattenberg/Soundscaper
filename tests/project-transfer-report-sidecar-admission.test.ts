/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CrossProductHandoffConversionReportV1 } from
	'../src/common/transfer/cross-product-handoff-conversion.ts';
import { createCrossProductHandoffReportSidecar } from
	'../src/common/transfer/cross-product-handoff-report-sidecar.ts';
import { crossProductHandoffRootNames } from
	'../src/common/transfer/cross-product-handoff-root-contract.ts';

const PROJECT_ID = 'reused-project-id';
const ARCHIVE = new TextEncoder().encode('destination archive');

test('a conversion-report sidecar refuses a destination that reuses its source project id', () => {
	const report = conversionReport(PROJECT_ID, PROJECT_ID);
	assert.throws(() => createCrossProductHandoffReportSidecar({
		entryId: PROJECT_ID,
		archive: ARCHIVE,
		report,
	}), /separately identified destination project id/iu);
});

test('live report roots require dense own data indices with no extra authority', () => {
	const valid = conversionReport('source-project', 'destination-project');
	const named = [...valid.roots] as typeof valid.roots & { unsignedAuthority?: unknown };
	named.unsignedAuthority = { attack: true };
	assertRejectedRoots(named);

	const symbolled = [...valid.roots];
	Object.defineProperty(symbolled, Symbol('unsignedAuthority'), { value: true, enumerable: true });
	assertRejectedRoots(symbolled);

	const sparse = [...valid.roots];
	delete sparse[0];
	assertRejectedRoots(sparse);

	let invoked = false;
	const accessor = [...valid.roots];
	Object.defineProperty(accessor, '0', {
		enumerable: true,
		get() { invoked = true; return valid.roots[0]; },
	});
	assertRejectedRoots(accessor);
	assert.equal(invoked, false);
});

function assertRejectedRoots(roots: CrossProductHandoffConversionReportV1['roots']): void {
	const report = { ...conversionReport('source-project', 'destination-project'), roots };
	assert.throws(() => createCrossProductHandoffReportSidecar({
		entryId: 'destination-project', archive: ARCHIVE, report,
	}), /roots.*dense|roots.*data|ordinary array/iu);
}

function conversionReport(
	sourceProjectId: string,
	destinationProjectId: string,
): CrossProductHandoffConversionReportV1 {
	const destinationRoots = new Set(crossProductHandoffRootNames('soundscaper'));
	return {
		kind: 'cross-product-editable-copy-report',
		version: 1,
		invocationId: 'forged-same-id-report',
		refused: false,
		source: {
			schemaFamily: 'framescaper', schemaVersion: 1, projectId: sourceProjectId,
			sha256: '1'.repeat(64),
		},
		destination: {
			schemaFamily: 'soundscaper', schemaVersion: 1, projectId: destinationProjectId,
			sha256: '2'.repeat(64),
		},
		roots: crossProductHandoffRootNames('framescaper').map((root) => ({
			root,
			disposition: destinationRoots.has(root) ? 'copy' : 'omit-with-report',
			reason: destinationRoots.has(root) ? 'Copied.' : 'Omitted.',
			sourceRef: `framescaper:${sourceProjectId}#/${root}`,
			destinationRef: destinationRoots.has(root)
				? `soundscaper:${destinationProjectId}#/${root}` : null,
			sourceSha256: '3'.repeat(64),
			destinationSha256: destinationRoots.has(root) ? '3'.repeat(64) : null,
		})),
	};
}
