/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const inventoryUrl = new URL('../config/milestone-2-closure.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const securityMatrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

const GATE_IDS = [
	'm2-gate-bounded-pipelines',
	'm2-gate-cache-cleanup',
	'm2-gate-crash-safe-publication',
	'm2-gate-electron-concurrency',
	'm2-gate-feature-compatibility',
	'm2-gate-mixed-media-handoff',
];

const ITEM_IDS = [
	'm2-browser-durability-matrix',
	'm2-cache-root-safety',
	'm2-compatibility-affected-objects',
	'm2-compatibility-bypass',
	'm2-compatibility-fallback-roles',
	'm2-compatibility-future-archive',
	'm2-compatibility-less-capable-roundtrip',
	'm2-electron-lease-matrix',
	'm2-handoff-packaged-roundtrip',
	'm2-linked-media-lifecycle',
	'm2-managed-capacity-admission',
	'm2-media-relationship-roundtrip',
	'm2-opfs-worker-boundary',
	'm2-pipeline-resource-qualification',
	'm2-pipeline-route-qualification',
	'm2-publication-fault-matrix',
];

test('milestone 2 has one frozen finite closure inventory', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));

	assert.equal(inventory.schemaVersion, 1);
	assert.equal(inventory.scopeRevision, 2);
	assert.equal(inventory.milestone, '2');
	assert.equal(inventory.frozenAt, '2026-08-08');
	assert.equal(inventory.revisedAt, '2026-08-09');
	assert.equal(inventory.expansionPolicy.newCapabilitiesDisposition, 'milestone-3-or-later');
	assert.equal(
		inventory.expansionPolicy.scopeChangeRequires,
		'scope-revision-and-explicit-user-approval',
	);
	assert.deepEqual(inventory.gates.map(({ id }) => id).sort(), GATE_IDS);
	assert.deepEqual(inventory.items.map(({ id }) => id).sort(), ITEM_IDS);

	const gateIds = new Set(GATE_IDS);
	for (const item of inventory.items) {
		assert.ok(gateIds.has(item.gateId), `${item.id} has an unknown gate`);
		assert.match(item.status, /^(?:implemented|partial|planned)$/u, item.id);
		assert.ok(Array.isArray(item.acceptance) && item.acceptance.length > 0, item.id);
		assert.ok(Array.isArray(item.ownerRefs) && item.ownerRefs.length > 0, item.id);
		for (const reference of item.ownerRefs) {
			await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
		}
		if (item.completedWorkflowIds) {
			assert.ok(Array.isArray(item.workflowIds), `${item.id} completed workflows need a workflow set`);
			assert.ok(item.completedWorkflowIds.every((id) => item.workflowIds.includes(id)), item.id);
		}
	}

	const packagedHandoff = inventory.items.find(
		({ id }) => id === 'm2-handoff-packaged-roundtrip',
	);
	assert.deepEqual(packagedHandoff.completedWorkflowIds, [
		'web-soundscaper-to-framescaper-to-soundscaper-scape',
		'web-framescaper-to-soundscaper-to-framescaper-scape',
		'electron-soundscaper-to-framescaper-to-soundscaper-library',
		'electron-framescaper-to-soundscaper-to-framescaper-library',
	]);
	assert.equal(packagedHandoff.status, 'implemented');

	for (const gate of inventory.gates) {
		assert.ok(Array.isArray(gate.itemIds) && gate.itemIds.length > 0, gate.id);
		const gateItems = inventory.items.filter(({ gateId }) => gateId === gate.id);
		assert.deepEqual(gate.itemIds, gateItems.map(({ id }) => id),
			`${gate.id} must own its exact ordered item set`);
		assert.equal(
			gate.status,
			gateItems.every(({ status }) => status === 'implemented') ? 'implemented' :
				gateItems.some(({ status }) => status !== 'planned') ? 'partial' : 'planned',
			`${gate.id} status must reflect its items`,
		);
	}
});

test('roadmap references only the frozen milestone-2 closure scope', async () => {
	const [inventory, roadmap] = await Promise.all([
		readFile(inventoryUrl, 'utf8').then(JSON.parse),
		readFile(roadmapUrl, 'utf8'),
	]);
	const milestone = roadmap.slice(
		roadmap.indexOf('## 2. Shared platform, storage, and media foundation'),
		roadmap.indexOf('## 3. Parallel editorial foundations'),
	);
	const openItems = milestone.slice(
		milestone.indexOf('### Open closure items, in priority order'),
		milestone.indexOf('### Explicitly deferred or outside milestone 2'),
	);

	assert.match(milestone, /config\/milestone-2-closure\.json/iu);
	for (const { id } of [...inventory.gates, ...inventory.items]) {
		assert.match(milestone, new RegExp(`\\b${id}\\b`, 'u'), id);
	}
	assert.deepEqual(
		[...openItems.matchAll(/^- `(m2-[a-z0-9-]+)`$/gmu)].map(([, id]) => id).sort(),
		inventory.items.filter(({ status }) => status !== 'implemented').map(({ id }) => id).sort(),
		'roadmap open-item bullets must exactly match the unfinished inventory',
	);
	for (const gate of inventory.gates) {
		assert.match(
			milestone,
			new RegExp(`\\| \`${gate.id}\` \\| \\*\\*${gate.status}\\*\\* \\|`, 'iu'),
			`${gate.id} roadmap status`,
		);
	}
	for (const pattern of [
		/\b(?:other|broader|generic|remaining)\b/iu,
		/broader linked and unmanaged-original lifecycles/iu,
		/other final-delivery paths/iu,
		/where required/iu,
		/generic per-feature bypass/iu,
		/arbitrary future-schema/iu,
		/every maintained publication path/iu,
		/remaining media relationships are stable/iu,
		/required generic surface/iu,
	]) assert.doesNotMatch(milestone, pattern);
});

test('every managed-capacity ID has an exact authoritative control binding', async () => {
	const [inventory, securityMatrix] = await Promise.all([
		readFile(inventoryUrl, 'utf8').then(JSON.parse),
		readFile(securityMatrixUrl, 'utf8').then(JSON.parse),
	]);
	const item = inventory.items.find(({ id }) => id === 'm2-managed-capacity-admission');
	assert.ok(item);
	assert.deepEqual(item.capacityBindings, [
		{
			id: 'project-document-bytes',
			controlId: 'point-in-time-managed-media-publication-capacity-admission',
			admissionBranches: ['project-document-root'],
		},
		{
			id: 'managed-catalog-row-count',
			controlId: 'point-in-time-managed-media-publication-capacity-admission',
			admissionBranches: ['managed-media-catalog'],
		},
		{
			id: 'managed-catalog-metadata-bytes',
			controlId: 'point-in-time-managed-media-publication-capacity-admission',
			admissionBranches: ['managed-media-catalog'],
		},
		{
			id: 'managed-body-declared-bytes',
			controlId: 'point-in-time-managed-media-publication-capacity-admission',
			admissionBranches: ['managed-media-body-reservation'],
		},
		{
			id: 'destination-statfs-available-bytes',
			controlId: 'point-in-time-managed-media-publication-capacity-admission',
			admissionBranches: ['managed-media-root', 'project-document-root'],
		},
		{
			id: 'desktop-save-target-available-bytes',
			controlId: 'aggregate-save-capacity-and-disk-admission',
			admissionBranches: ['desktop-save-target'],
		},
	]);
	assert.deepEqual(item.capacityBindings.map(({ id }) => id), item.capacityIds);
	const registeredIds = collectIds(securityMatrix);
	for (const binding of item.capacityBindings) {
		assert.ok(registeredIds.has(binding.controlId), `${binding.id} has an unknown control`);
		assert.ok(binding.admissionBranches.length > 0, `${binding.id} has no admission branch`);
	}
});

function collectIds(value, result = new Set()) {
	if (Array.isArray(value)) {
		for (const item of value) collectIds(item, result);
		return result;
	}
	if (value && typeof value === 'object') {
		if (typeof value.id === 'string') result.add(value.id);
		for (const item of Object.values(value)) collectIds(item, result);
	}
	return result;
}
