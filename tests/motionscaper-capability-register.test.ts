/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PRODUCT_IDS, PRODUCT_PROFILES } from '../src/common/products.js';
import { renderCapabilityReference } from '../scripts/lib/docs-reference/capabilities.mjs';
import { renderPlatformReference } from '../scripts/lib/docs-reference/platforms.mjs';
import { loadReferenceSources, renderReferenceDocuments } from '../scripts/lib/docs-reference-generator.mjs';

interface ProductClaim {
	profileEvidence: string;
	release: { softwareStatus: string; channel: string; candidateVersion: string; stableTarget: null | string };
	applicationFeatures: Record<string, boolean>;
	platforms: Record<string, { status: string; evidence: string[] }>;
	importFamilies: string[];
	exportFamilies: string[];
	projectFeatures: Record<string, boolean>;
	projectSchemaIdentity: { schemaFamily: string; schemaVersion: number; evidence: string[] };
	development?: { status: string; summary: string; qualificationSummary: string; evidence: string[] };
}
interface Inventory {
	products: Record<string, ProductClaim>;
	projectSchemaBaselines: { schemaFamily: string; schemaVersion: number; status: string }[];
	platformTiers: string[];
	browserTargets: Record<string, { automated: boolean }>;
	desktopTargets: { os: string; architecture: string; packageGate: string }[];
}
async function inventory(): Promise<Inventory> {
	return JSON.parse(await readFile(new URL('../config/production-capabilities.json', import.meta.url), 'utf8')) as Inventory;
}

test('Motion development claims match its independent profile without extending frozen family-v1 baselines', async () => {
	const register = await inventory();
	assert.deepEqual(Object.keys(register.products).sort(), [...PRODUCT_IDS].sort());
	const motion = register.products.motionscaper; assert.ok(motion);
	assert.equal(motion.profileEvidence, 'src/motionscaper/product.js');
	assert.deepEqual(motion.projectFeatures, PRODUCT_PROFILES.motionscaper.capabilities);
	assert.deepEqual(motion.applicationFeatures, PRODUCT_PROFILES.motionscaper.applicationFeatures);
	assert.deepEqual(motion.importFamilies, PRODUCT_PROFILES.motionscaper.importChoices);
	assert.deepEqual(motion.exportFamilies, PRODUCT_PROFILES.motionscaper.exportChoices);
	assert.deepEqual(motion.release, { softwareStatus: 'pre-release', channel: 'candidate', candidateVersion: '0.1.0-alpha.1', stableTarget: null });
	assert.equal(motion.projectSchemaIdentity.schemaFamily, 'motionscaper'); assert.equal(motion.projectSchemaIdentity.schemaVersion, 1);
	assert.deepEqual(register.projectSchemaBaselines.map(({ schemaFamily, schemaVersion, status }) => [schemaFamily, schemaVersion, status]), [
		['soundscaper', 1, 'rc-baseline'], ['framescaper', 1, 'rc-baseline'],
	]);
});

test('Motion qualification remains partial and every registered claim resolves to maintained evidence', async () => {
	const register = await inventory(), motion = register.products.motionscaper; assert.ok(motion);
	assert.deepEqual(Object.keys(motion.platforms), register.platformTiers);
	assert.ok(Object.values(motion.platforms).every(({ status }) => status === 'partial'));
	const development = motion.development; assert.ok(development); assert.equal(development.status, 'in-progress');
	assert.match(development.summary, /separate motion workspace/u);
	assert.match(development.qualificationSummary, /Chromium/u); assert.match(development.qualificationSummary, /Linux x64/u);
	assert.match(development.qualificationSummary, /installed After Effects/u); assert.match(development.qualificationSummary, /remain unqualified/u);
	const paths = [motion.profileEvidence, ...motion.projectSchemaIdentity.evidence, ...development.evidence,
		...Object.values(motion.platforms).flatMap(({ evidence }) => evidence)];
	for (const path of new Set(paths)) await access(new URL(`../${path}`, import.meta.url));
});

test('generated references describe Motion workspace ownership and its own platform qualification', async () => {
	const register = await inventory(), development = register.products.motionscaper?.development; assert.ok(development);
	const products = PRODUCT_IDS.map(id => PRODUCT_PROFILES[id]);
	const capabilities = renderCapabilityReference({ products, capabilities: register });
	assert.ok(capabilities.includes(development.summary)); assert.ok(capabilities.includes(development.qualificationSummary));
	assert.match(capabilities, /Motionscaper development workspace/u); assert.match(capabilities, /Shared editor capabilities/u);
	const platforms = renderPlatformReference({ capabilities: register, packageTargets: { win: ['nsis', 'zip'], mac: ['dmg', 'zip'], linux: ['AppImage', 'deb'] } });
	assert.ok(platforms.includes(development.qualificationSummary));
	assert.match(platforms, /Motionscaper development qualification/u);
});

test('Motion never inherits Audacity commands, Nyquist plug-ins or shared workspace layouts in generated references', async () => {
	const documents = renderReferenceDocuments(await loadReferenceSources(fileURLToPath(new URL('../', import.meta.url))));
	for (const name of ['commands.md', 'nyquist-plugins.md', 'workspaces.md']) {
		const document = documents.get(name); assert.ok(document);
		assert.doesNotMatch(document, /Motionscaper/u, name);
	}
});
