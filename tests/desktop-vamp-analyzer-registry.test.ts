/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VampAnalyzerDescriptor } from '../desktop/vamp-analyzer-contract.ts';
import {
	DesktopVampAnalyzerRegistry,
	VampAnalyzerRegistryError,
	type VampAnalyzerLibraryObservation,
	vampAnalyzerIdFor,
	vampAnalyzerInstallationIdFor,
} from '../desktop/vamp-analyzer-registry.ts';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function rawDescriptor(identifier = 'com.example.onsets'): VampAnalyzerDescriptor {
	return {
		kind: 'analyzer', format: 'vamp', identifier, name: 'Onsets', description: '', maker: 'Example',
		copyright: '', pluginVersion: 1, vampApiVersion: 2, inputDomain: 'time',
		minimumChannels: 1, maximumChannels: 2, preferredStepSize: 512, preferredBlockSize: 1_024,
		parameters: [], programs: [], outputs: [{
			identifier: 'onsets', name: 'Onsets', description: '', unit: '', binCount: 0,
			binNames: [], extents: null, quantizeStep: null, sampleType: 'variable-sample-rate',
			sampleRate: null, hasDuration: false,
		}],
	};
}

function observation(overrides: Partial<VampAnalyzerLibraryObservation> = {}): VampAnalyzerLibraryObservation {
	return {
		kind: 'analyzer-library', format: 'vamp', libraryPath: '/usr/lib/vamp/example.so',
		libraryBytes: 4_096, librarySha256: DIGEST_A, identity: { dev: 7, ino: 11 },
		platform: 'linux', architecture: 'x64', compatibility: 'compatible',
		descriptors: [rawDescriptor()], ...overrides,
	};
}

function recorded(registry: DesktopVampAnalyzerRegistry, value = observation()) {
	const result = registry.recordLibrary(value);
	assert.equal(result.status, 'recorded', JSON.stringify(result));
	if (result.status !== 'recorded') throw new Error('unreachable');
	return result.analyzers[0]!;
}

function strings(value: unknown, result: string[] = []): string[] {
	if (typeof value === 'string') result.push(value);
	else if (Array.isArray(value)) for (const item of value) strings(item, result);
	else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, result);
	return result;
}

test('registry exposes stable analyzer and digest installation identities without paths', () => {
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const first = recorded(registry);
	assert.equal(first.analyzerId, vampAnalyzerIdFor('com.example.onsets'));
	assert.equal(first.installationId, vampAnalyzerInstallationIdFor(DIGEST_A, 'com.example.onsets'));
	assert.ok(strings(registry.describe()).every((value) => !value.includes('/usr/lib')));
	assert.equal(registry.describe().entries[0]?.kind, 'analyzer');
	assert.equal(registry.describe().entries[0]?.format, 'vamp');

	const moved = recorded(registry, observation({ libraryPath: '/opt/vamp/example.so' }));
	assert.equal(moved.installationId, first.installationId);
	assert.equal(registry.describe().entries[0]?.installations.length, 1);
	registry.allow(first.installationId);
	const grant = registry.executionGrantFor(first.installationId);
	assert.equal(grant.kind, 'vamp-analyzer');
	assert.equal(grant.libraryPath, '/opt/vamp/example.so');
	assert.equal(grant.librarySha256, DIGEST_A);
	assert.deepEqual(grant.identity, { dev: 7, ino: 11 });
	assert.equal(grant.descriptor.kind, 'analyzer');
});

test('changed bytes require explicit allowance and a stable-ID collision requires selection', () => {
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const first = recorded(registry);
	registry.allow(first.installationId);
	const changed = recorded(registry, observation({
		libraryPath: '/opt/vamp/example.so', librarySha256: DIGEST_B, identity: { dev: 8, ino: 12 },
	}));
	assert.equal(changed.allowanceRequired, true);
	assert.equal(changed.selectionRequired, true);
	assert.throws(() => registry.executionGrantFor(first.installationId), (error: unknown) =>
		error instanceof VampAnalyzerRegistryError && error.code === 'identity-collision');

	registry.select(changed.installationId);
	assert.throws(() => registry.executionGrantFor(changed.installationId), (error: unknown) =>
		error instanceof VampAnalyzerRegistryError && error.code === 'allowance-required');
	registry.allow(changed.installationId);
	assert.equal(registry.executionGrantFor(changed.installationId).librarySha256, DIGEST_B);
});

test('one digest cannot change its analyzer set and quarantine is consulted at admission and execution', () => {
	const quarantined = new Set<string>();
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: (digest) => quarantined.has(digest) });
	recorded(registry);
	const changedSet = registry.recordLibrary(observation({
		descriptors: [rawDescriptor('com.example.different')],
	}));
	assert.equal(changedSet.status, 'rejected');
	if (changedSet.status === 'rejected') assert.equal(changedSet.reason, 'identity-change');

	const allowed = registry.describe().entries[0]?.installations[0]?.installationId;
	assert.ok(allowed);
	registry.allow(allowed);
	quarantined.add(DIGEST_A);
	assert.throws(() => registry.executionGrantFor(allowed), (error: unknown) =>
		error instanceof VampAnalyzerRegistryError && error.code === 'quarantined');
	const rejected = registry.recordLibrary(observation());
	assert.equal(rejected.status, 'rejected');
	if (rejected.status === 'rejected') assert.equal(rejected.reason, 'quarantined');
});

test('incompatible analyzer libraries stay pathless and cannot mint execution grants', () => {
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const item = recorded(registry, observation({ compatibility: 'incompatible-architecture' }));
	registry.allow(item.installationId);
	assert.equal(registry.describe().entries[0]?.eligible, false);
	assert.equal(registry.describe().entries[0]?.ineligibleReason, 'incompatible');
	assert.throws(() => registry.executionGrantFor(item.installationId), (error: unknown) =>
		error instanceof VampAnalyzerRegistryError && error.code === 'incompatible');
});

