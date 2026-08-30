/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRIES,
	PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRY_BYTES,
} from '../src/common/transfer/project-transfer-bundle-admission.ts';

const matrix = JSON.parse(
	await readFile(new URL('../config/production-security-matrix.json', import.meta.url), 'utf8'),
);
const closure = JSON.parse(
	await readFile(new URL('../config/milestone-2-closure.json', import.meta.url), 'utf8'),
);
const threatModel = await readFile(
	new URL('../docs/production-threat-model.md', import.meta.url), 'utf8',
);

const BOUNDARY_ID = 'browser-origin-to-peer-project-store';
const RISK_ID = 'cross-origin-project-transfer';
const CONTROL_ID = 'origin-authenticated-bounded-project-transfer';
const ROUTE_ID = 'project-transfer-browser-blob';
const FAULT_PATH_ID = 'web-cross-origin-project-transfer-import';

test('cross-origin project transfer owns a bounded authenticated security boundary', async () => {
	const boundary = matrix.boundaries.find(({ id }: { id: string }) => id === BOUNDARY_ID);
	const risk = matrix.risks.find(({ id }: { id: string }) => id === RISK_ID);
	const control = risk?.currentControls.find(({ id }: { id: string }) => id === CONTROL_ID);

	assert.ok(boundary);
	assert.equal(boundary.from, 'Soundscaper or Framescaper transfer origin and manual archive picker');
	assert.equal(boundary.to, 'The peer origin transfer page and its product-family project stores');
	for (const path of [
		'src/common/transfer/transfer-window-port.ts',
		'src/common/transfer/project-transfer-handshake.ts',
		'src/common/transfer/transfer-manual-import.ts',
		'src/common/transfer/project-transfer-bundle-admission.ts',
		'src/common/transfer/cross-product-handoff-report-sidecar.ts',
	]) {
		assert.ok(boundary.entryPoints.includes(path), path);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}
	assert.ok(risk);
	assert.deepEqual(risk.boundaryIds, [BOUNDARY_ID]);
	assert.equal(risk.status, 'partial');
	assert.equal(risk.releaseDisposition, 'conditional');
	assert.ok(control);
	assert.match(control.summary,
		/exact origin.*window identity.*versioned.*session.*512 entries.*512 MiB.*SharedArrayBuffer.*one archive/isu);
	assert.ok(control.evidence.some(({ kind }: { kind: string }) => kind === 'implementation'));
	assert.ok(control.evidence.some(({ kind }: { kind: string }) => kind === 'test'));
});

test('project transfer download and import are closed milestone-2 publication rows', () => {
	const route = matrix.publicationRouteQualification.routes.find(
		({ id }: { id: string }) => id === ROUTE_ID,
	);
	assert.deepEqual(route, {
		id: ROUTE_ID,
		publicationMode: 'browser-blob',
		finalRendererBlob: true,
		maximumBytes: PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRY_BYTES,
		controlId: CONTROL_ID,
	});
	assert.equal(PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRIES, 512);
	const routeItem = closure.items.find(({ id }: { id: string }) => id === 'm2-pipeline-route-qualification');
	assert.ok(routeItem.routeIds.includes(ROUTE_ID));

	const faultPath = matrix.publicationFaultQualification.paths.find(
		({ id }: { id: string }) => id === FAULT_PATH_ID,
	);
	const faultItem = closure.items.find(({ id }: { id: string }) => id === 'm2-publication-fault-matrix');
	assert.ok(faultPath);
	assert.deepEqual(Object.keys(faultPath.faults), faultItem.faultIds);
	assert.ok(faultItem.publicationPathIds.includes(FAULT_PATH_ID));
});

test('the threat model publishes the transfer boundary and register scope', () => {
	for (const identity of [BOUNDARY_ID, RISK_ID, CONTROL_ID, ROUTE_ID, FAULT_PATH_ID]) {
		assert.match(threatModel, new RegExp(`\\b${identity}\\b`, 'u'), identity);
	}
	assert.match(threatModel, /16 route IDs.*five retained\s+browser-Blob fallbacks/isu);
	assert.match(threatModel, /fifteen publication paths\s+crossed with eight fault classes, one hundred twenty cells/isu);
});
