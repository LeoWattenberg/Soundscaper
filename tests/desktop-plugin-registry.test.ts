/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopPluginRegistry,
	type DesktopPluginRegistryOptions,
	type PluginEntryView,
	type PluginRegistryAdmission,
	PluginRegistryError,
	type PluginScanObservation,
	entryIdFor,
	installationIdFor,
	MAXIMUM_PLUGIN_INSTALLATIONS,
} from '../desktop/plugin-registry.ts';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

/** The durable quarantine is a required seam, so every registry is given one. */
function createRegistry(quarantined: ReadonlySet<string> = new Set()): DesktopPluginRegistry {
	return new DesktopPluginRegistry({ isQuarantined: (digest) => quarantined.has(digest) });
}

function observation(overrides: Partial<PluginScanObservation> = {}): PluginScanObservation {
	return {
		format: 'vst3',
		stableId: 'com.example.reverb',
		name: 'Room Reverb',
		vendor: 'Example Audio',
		version: '1.2.0',
		platform: 'linux',
		architecture: 'x64',
		binaryPath: '/usr/lib/vst3/RoomReverb.vst3',
		binaryBytes: 4_096,
		binarySha256: DIGEST_A,
		identity: { dev: 66_305, ino: 12_345 },
		classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }],
		realtimeSupported: true,
		offlineSupported: true,
		reportedLatencyFrames: 64,
		signature: 'trusted',
		compatibility: 'compatible',
		descriptorVersion: 3,
		...overrides,
	};
}

function recorded(admission: PluginRegistryAdmission): Readonly<{
	entryId: string;
	installationId: string;
	unreviewed: boolean;
	selectionRequired: boolean;
}> {
	assert.equal(admission.status, 'recorded', JSON.stringify(admission));
	if (admission.status !== 'recorded') throw new Error('unreachable');
	return admission;
}

function rejection(admission: PluginRegistryAdmission): string {
	assert.equal(admission.status, 'rejected', JSON.stringify(admission));
	if (admission.status !== 'rejected') throw new Error('unreachable');
	return admission.reason;
}

function entry(registry: DesktopPluginRegistry, entryId: string): PluginEntryView {
	const view = registry.describe().entries.find((candidate) => candidate.entryId === entryId);
	assert.ok(view, 'the registry must project the recorded entry');
	return view;
}

function registryErrorCode(operation: () => unknown): string {
	try {
		operation();
	} catch (error) {
		assert.ok(error instanceof PluginRegistryError, `expected a PluginRegistryError, saw ${String(error)}`);
		return error.code;
	}
	throw new Error('the operation was expected to throw');
}

function projectedStrings(value: unknown, found: string[] = []): string[] {
	if (typeof value === 'string') found.push(value);
	else if (Array.isArray(value)) for (const item of value) projectedStrings(item, found);
	else if (value && typeof value === 'object') for (const item of Object.values(value)) projectedStrings(item, found);
	return found;
}

test('identity is the format plus the format-native stable id, never the path', () => {
	const registry = createRegistry();
	const first = recorded(registry.record(observation()));
	const sameIdOtherFormat = recorded(registry.record(observation({
		format: 'clap',
		binarySha256: DIGEST_B,
		binaryPath: '/usr/lib/clap/RoomReverb.clap',
	})));
	assert.notEqual(first.entryId, sameIdOtherFormat.entryId, 'a shared stable id in two formats is two plug-ins');
	assert.equal(first.entryId, entryIdFor('vst3', 'com.example.reverb'));
	assert.equal(first.installationId, installationIdFor(DIGEST_A));
	assert.equal(registry.describe().entries.length, 2);

	// The same bytes rescanned from another folder stay one installation.
	const rescanned = recorded(registry.record(observation({ binaryPath: '/opt/vst3/RoomReverb.vst3' })));
	assert.equal(rescanned.installationId, first.installationId);
	assert.equal(entry(registry, first.entryId).installations.length, 1);
	assert.equal(registry.hostGrantFor(first.installationId).binaryPath, '/opt/vst3/RoomReverb.vst3');
});

test('a changed digest is a new unreviewed installation, never an update of the reviewed one', () => {
	const registry = createRegistry();
	const original = recorded(registry.record(observation({ signature: 'unsigned' })));
	registry.allow(original.installationId);
	assert.equal(entry(registry, original.entryId).eligible, true);

	const changed = recorded(registry.record(observation({ binarySha256: DIGEST_B, signature: 'unsigned' })));
	assert.notEqual(changed.installationId, original.installationId);
	assert.equal(changed.unreviewed, true);
	assert.equal(changed.selectionRequired, true);
	const view = entry(registry, original.entryId);
	assert.equal(view.installations.length, 2);
	assert.deepEqual(view.installations.map((installation) => installation.reviewed), [true, false]);
	assert.equal(view.ineligibleReason, 'identity-collision');

	// With the old binary gone, the warning-and-allow decision is plainly not
	// inherited: the new digest is untrusted code until the user allows it too.
	registry.forget(original.installationId);
	assert.equal(entry(registry, original.entryId).ineligibleReason, 'untrusted-code');
	registry.allow(changed.installationId);
	assert.equal(entry(registry, original.entryId).eligible, true);
});

test('a stable-id collision is ineligible until the user selects, whatever the scan order', () => {
	const paths = ['/usr/lib/vst3/RoomReverb.vst3', '/opt/vendor/RoomReverb.vst3'];
	const digests = [DIGEST_A, DIGEST_B];
	for (const order of [[0, 1], [1, 0]]) {
		const registry = createRegistry();
		const ids = order.map((index) => recorded(registry.record(observation({
			binarySha256: digests[index],
			binaryPath: paths[index],
			version: `1.${String(index)}.0`,
		}))));
		const entryId = ids[0].entryId;
		assert.equal(entry(registry, entryId).eligible, false);
		assert.equal(entry(registry, entryId).ineligibleReason, 'identity-collision');
		for (const id of ids) {
			assert.equal(registryErrorCode(() => registry.hostGrantFor(id.installationId)), 'identity-collision',
				'scan order must never pick an installation silently');
		}

		const chosen = installationIdFor(DIGEST_B);
		registry.select(chosen);
		assert.equal(entry(registry, entryId).eligible, true);
		assert.equal(registry.hostGrantFor(chosen).binaryPath, '/opt/vendor/RoomReverb.vst3');
		assert.equal(registryErrorCode(() => registry.hostGrantFor(installationIdFor(DIGEST_A))),
			'not-active-installation');
	}
});

test('a further installation re-opens a choice the user already made', () => {
	const registry = createRegistry();
	const first = recorded(registry.record(observation()));
	recorded(registry.record(observation({ binarySha256: DIGEST_B, binaryPath: '/opt/vendor/RoomReverb.vst3' })));
	registry.select(first.installationId);
	assert.equal(entry(registry, first.entryId).eligible, true);

	const third = recorded(registry.record(observation({ binarySha256: DIGEST_C, binaryPath: '/srv/RoomReverb.vst3' })));
	assert.equal(third.selectionRequired, true);
	assert.equal(entry(registry, first.entryId).ineligibleReason, 'identity-collision');
	assert.equal(registryErrorCode(() => registry.hostGrantFor(first.installationId)), 'identity-collision');
});

test('an instrument is recorded and is never materializable', () => {
	const registry = createRegistry();
	const instrument = recorded(registry.record(observation({
		stableId: 'com.example.synth',
		name: 'Example Synth',
		classification: 'instrument',
		signature: 'trusted',
	})));
	const view = entry(registry, instrument.entryId);
	assert.equal(view.classification, 'instrument');
	assert.equal(view.eligible, false);
	assert.equal(view.ineligibleReason, 'instrument-not-offered');
	assert.equal(registryErrorCode(() => registry.hostGrantFor(instrument.installationId)), 'instrument-not-offered');

	// No sequence of user decisions promotes it.
	registry.allow(instrument.installationId);
	registry.select(instrument.installationId);
	assert.equal(entry(registry, instrument.entryId).ineligibleReason, 'instrument-not-offered');
	assert.equal(registryErrorCode(() => registry.hostGrantFor(instrument.installationId)), 'instrument-not-offered');
	assert.equal(registry.eligibility(instrument.entryId).eligible, false);

	// An identity that is an instrument in any installation is never offered.
	const mixed = createRegistry();
	const effect = recorded(mixed.record(observation()));
	mixed.record(observation({ binarySha256: DIGEST_B, binaryPath: '/opt/x.vst3', classification: 'instrument' }));
	mixed.select(effect.installationId);
	assert.equal(entry(mixed, effect.entryId).ineligibleReason, 'instrument-not-offered');
	assert.equal(registryErrorCode(() => mixed.hostGrantFor(effect.installationId)), 'instrument-not-offered');
});

test('unsigned or unverifiable code is never silently eligible', () => {
	for (const signature of ['unsigned', 'unverifiable', 'untrusted'] as const) {
		const registry = createRegistry();
		const admission = recorded(registry.record(observation({ signature })));
		assert.equal(entry(registry, admission.entryId).ineligibleReason, 'untrusted-code');
		assert.equal(registryErrorCode(() => registry.hostGrantFor(admission.installationId)), 'untrusted-code');
		registry.allow(admission.installationId);
		assert.equal(entry(registry, admission.entryId).eligible, true);
		registry.withdrawAllowance(admission.installationId);
		assert.equal(entry(registry, admission.entryId).ineligibleReason, 'untrusted-code');
	}
	const trusted = createRegistry();
	const admission = recorded(trusted.record(observation()));
	assert.equal(entry(trusted, admission.entryId).eligible, true, 'trusted code needs no warning-and-allow');
});

test('classification, compatibility and supported modes each block eligibility', () => {
	for (const [overrides, reason] of [
		[{ classification: 'unknown' as const }, 'classification-unknown'],
		[{ compatibility: 'incompatible-architecture' as const }, 'incompatible'],
		[{ compatibility: 'unknown' as const }, 'incompatible'],
		[{ realtimeSupported: false, offlineSupported: false }, 'no-supported-mode'],
	] as const) {
		const registry = createRegistry();
		const admission = recorded(registry.record(observation(overrides)));
		assert.equal(entry(registry, admission.entryId).ineligibleReason, reason);
		assert.equal(registryErrorCode(() => registry.hostGrantFor(admission.installationId)), reason);
	}
});

test('one binary may never claim a second identity', () => {
	const registry = createRegistry();
	const first = recorded(registry.record(observation()));
	assert.equal(rejection(registry.record(observation({ stableId: 'com.example.other' }))), 'identity-change');
	assert.equal(rejection(registry.record(observation({ format: 'clap' }))), 'identity-change');
	assert.equal(registry.describe().entries.length, 1, 'a rejected identity change records nothing');
	assert.equal(entry(registry, first.entryId).installations.length, 1);
});

test('a quarantined digest is refused at admission and ineligible afterwards', () => {
	const quarantined = new Set<string>();
	const registry = createRegistry(quarantined);
	const admission = recorded(registry.record(observation({ signature: 'unsigned' })));
	quarantined.add(DIGEST_A);
	assert.equal(entry(registry, admission.entryId).ineligibleReason, 'quarantined');
	assert.equal(entry(registry, admission.entryId).installations[0].quarantined, true);
	assert.equal(registryErrorCode(() => registry.hostGrantFor(admission.installationId)), 'quarantined');
	assert.equal(registryErrorCode(() => registry.allow(admission.installationId)), 'quarantined');
	assert.equal(rejection(registry.record(observation())), 'quarantined');
});

test('the registry records the whole scan report and projects it back', () => {
	const registry = createRegistry();
	const admission = recorded(registry.record(observation({
		topologies: [{ inputChannels: 2, outputChannels: 2 }, { inputChannels: 0, outputChannels: 4 }],
		realtimeSupported: true,
		offlineSupported: false,
		reportedLatencyFrames: 512,
		signature: 'trusted',
		compatibility: 'compatible',
		descriptorVersion: 7,
	})));
	const [installation] = entry(registry, admission.entryId).installations;
	assert.equal(installation.platform, 'linux');
	assert.equal(installation.architecture, 'x64');
	assert.equal(installation.version, '1.2.0');
	assert.equal(installation.classification, 'effect');
	assert.deepEqual(installation.topologies, [
		{ inputChannels: 2, outputChannels: 2 },
		{ inputChannels: 0, outputChannels: 4 },
	]);
	assert.equal(installation.realtimeSupported, true);
	assert.equal(installation.offlineSupported, false);
	assert.equal(installation.reportedLatencyFrames, 512);
	assert.equal(installation.signature, 'trusted');
	assert.equal(installation.compatibility, 'compatible');
	assert.equal(installation.descriptorVersion, 7);
	assert.equal(installation.selected, true);
	assert.equal(registry.digestFor(admission.installationId), DIGEST_A);
	assert.deepEqual(registry.hostGrantFor(admission.installationId), {
		binaryPath: '/usr/lib/vst3/RoomReverb.vst3',
		binaryBytes: 4_096,
		binarySha256: DIGEST_A,
		format: 'vst3',
		identity: { dev: 66_305, ino: 12_345 },
	});
});

test('a scanner answer outside its bounds is rejected rather than recorded', () => {
	const registry = createRegistry();
	for (const overrides of [
		{ binarySha256: 'not-a-digest' },
		{ binarySha256: 'A'.repeat(64) },
		{ binaryPath: 'relative/RoomReverb.vst3' },
		{ binaryPath: '/usr/lib/../../RoomReverb.vst3' },
		{ platform: 'plan9' },
		{ architecture: 'mips' },
		{ classification: 'sampler' },
		{ signature: 'probably-fine' },
		{ compatibility: 'maybe' },
		{ topologies: [] },
		{ topologies: [{ inputChannels: -1, outputChannels: 2 }] },
		{ reportedLatencyFrames: 10_000_001 },
		{ reportedLatencyFrames: 1.5 },
		{ descriptorVersion: -1 },
		{ realtimeSupported: 'yes' },
		{ stableId: '' },
		{ name: 'x'.repeat(257) },
		{ binaryBytes: 0 },
		{ identity: { dev: 1 } },
	] as unknown as Partial<PluginScanObservation>[]) {
		assert.equal(rejection(registry.record(observation(overrides))), 'malformed', JSON.stringify(overrides));
	}
	assert.deepEqual(registry.describe().entries, []);
});

test('an identity may not hold unbounded installations', () => {
	const registry = createRegistry();
	for (let index = 0; index < MAXIMUM_PLUGIN_INSTALLATIONS; index += 1) {
		recorded(registry.record(observation({
			binarySha256: index.toString(16).padStart(64, '0'),
			binaryPath: `/opt/vendor/copy-${String(index)}.vst3`,
		})));
	}
	assert.equal(rejection(registry.record(observation({
		binarySha256: 'f'.repeat(64),
		binaryPath: '/opt/vendor/one-too-many.vst3',
	}))), 'capacity');
});

test('hostile scanner text never reaches renderer-facing state as a path', () => {
	const registry = createRegistry();
	const admission = recorded(registry.record(observation({
		name: '/etc/passwd',
		vendor: 'C:\\Windows\\System32',
		version: '/opt/secret/1.0',
		stableId: 'file:///opt/secret/plugin.vst3',
		binaryPath: '/opt/secret/plugin.vst3',
	})));
	const view = registry.describe();
	for (const value of projectedStrings(view)) {
		assert.equal(value.includes('/'), false, `${value} leaks a POSIX path separator`);
		assert.equal(value.includes('\\'), false, `${value} leaks a Windows path separator`);
	}
	const serialized = JSON.stringify(view);
	assert.equal(serialized.includes('/opt/secret/plugin.vst3'), false);
	assert.equal(serialized.includes(DIGEST_A), false, 'the binary digest is not renderer-facing state');
	// Main still holds every raw fact behind its own accessors.
	assert.equal(registry.hostGrantFor(admission.installationId).binaryPath, '/opt/secret/plugin.vst3');
	assert.equal(registry.digestFor(admission.installationId), DIGEST_A);
});

test('a registry cannot be built without the quarantine it must consult', () => {
	// Defaulting the seam to "nothing is quarantined" would make forgetting to
	// wire the durable store look exactly like a clean machine.
	assert.equal(registryErrorCode(() => new DesktopPluginRegistry({} as DesktopPluginRegistryOptions)),
		'missing-quarantine');
	assert.equal(registryErrorCode(() => new DesktopPluginRegistry(
		{ isQuarantined: null } as unknown as DesktopPluginRegistryOptions)), 'missing-quarantine');
});

test('a colliding installation cannot rename the identity behind the user', () => {
	const registry = createRegistry();
	const first = recorded(registry.record(observation()));
	recorded(registry.record(observation({
		binarySha256: DIGEST_B,
		binaryPath: '/opt/vendor/RoomReverb.vst3',
		name: 'System Update',
		vendor: 'Nobody At All',
	})));
	// The user is being asked which of the two to keep; the newcomer must not be
	// the one that decides what the identity is called while they answer.
	assert.equal(entry(registry, first.entryId).name, 'Room Reverb');
	assert.equal(entry(registry, first.entryId).vendor, 'Example Audio');

	registry.select(first.installationId);
	assert.equal(entry(registry, first.entryId).name, 'Room Reverb');

	// Once the newcomer is the installation in use, its own text is the truth.
	registry.select(installationIdFor(DIGEST_B));
	assert.equal(entry(registry, first.entryId).name, 'System Update');
	assert.equal(entry(registry, first.entryId).vendor, 'Nobody At All');
});

test('forgetting an installation drops the digest binding it created', () => {
	const registry = createRegistry();
	const first = recorded(registry.record(observation()));
	assert.equal(registry.forget(first.installationId), true);
	assert.deepEqual(registry.describe().entries, []);

	// The digest-to-identity bindings are the one collection with no ceiling of
	// its own, so they may not outlive the installations that created them: a
	// record-and-forget cycle would otherwise grow them without bound.
	const reused = recorded(registry.record(observation({ stableId: 'com.example.other' })));
	assert.notEqual(reused.entryId, first.entryId);
	assert.equal(registry.describe().entries.length, 1);

	// A binary the registry still holds may still not claim a second identity.
	assert.equal(rejection(registry.record(observation({ stableId: 'com.example.third' }))), 'identity-change');
	assert.equal(registry.describe().entries.length, 1);
});

test('an entry the registry does not hold is named unknown, not a collision', () => {
	const registry = createRegistry();
	assert.deepEqual(registry.eligibility('enosuchentry'), { eligible: false, reason: 'unknown-entry' },
		'an unknown id must not borrow the reason of a plug-in waiting for the user to choose');
	const admission = recorded(registry.record(observation()));
	assert.deepEqual(registry.eligibility(admission.entryId), { eligible: true, reason: null });
	registry.forget(admission.installationId);
	assert.deepEqual(registry.eligibility(admission.entryId), { eligible: false, reason: 'unknown-entry' });
});

test('an unknown installation is an error rather than a silent no-op', () => {
	const registry = createRegistry();
	assert.equal(registryErrorCode(() => registry.select('inope')), 'unknown-installation');
	assert.equal(registryErrorCode(() => registry.allow('inope')), 'unknown-installation');
	assert.equal(registryErrorCode(() => registry.digestFor('inope')), 'unknown-installation');
	assert.equal(registry.forget('inope'), false);
	const admission = recorded(registry.record(observation()));
	assert.equal(registry.forget(admission.installationId), true);
	assert.deepEqual(registry.describe().entries, [], 'an identity with no installations is not an entry');
});
