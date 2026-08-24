/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { HELPER_PLUGIN_FORMATS } from '../desktop/helper-job-grant.ts';
import { HelperSupervisionError, type HelperJobRequest } from '../desktop/helper-supervisor.ts';
import { HelperContractViolationError } from '../desktop/helper-wire-admission.ts';
import type { NativeAddonAvailability } from '../desktop/native-addon-payload.ts';
import {
	DesktopPluginScanService,
	PLUGIN_SCAN_RESOURCE_POLICY,
	type PluginScanOutcome,
	type PluginScanQuarantineReason,
	type PluginScanRequest,
	type PluginScanRootLocation,
} from '../desktop/plugin-scan-service.ts';

const SERVICE_SOURCE = readFileSync(new URL('../desktop/plugin-scan-service.ts', import.meta.url), 'utf8');

const AVAILABLE_PAYLOAD: NativeAddonAvailability = Object.freeze({
	status: 'available',
	descriptor: Object.freeze({
		target: 'linux-x64',
		path: '/verified/soundscaper_helper.node',
		byteLength: 1,
		sha256: 'a'.repeat(64),
		addonVersion: '1.0.0',
		napiVersion: 8,
		toolchainIdentity: 'cc (test) 1.0',
	}),
});

const ROOT: PluginScanRootLocation = Object.freeze({
	path: '/home/scanner/.vst3',
	identity: Object.freeze({ dev: 66_305, ino: 4_242 }),
	scanDigest: 'e'.repeat(64),
});

const ENTRY = Object.freeze({
	stableId: 'com.example.reverb',
	name: 'Example Reverb',
	vendor: 'Example Audio',
	version: '2.1.0',
	binaryPath: '/home/scanner/.vst3/Example Reverb.vst3',
	binaryBytes: 4_194_304,
	binarySha256: 'b'.repeat(64),
	classification: 'effect',
	channelSupport: [{ inputs: 2, outputs: 2 }],
	realtime: true,
	offline: true,
	reportedLatencyFrames: 0,
	signature: 'signed-valid',
	compatibility: 'compatible',
	descriptorVersion: 3,
});

const SCAN = Object.freeze({ format: 'vst3', status: 'scanned', detail: '', entries: [ENTRY] });

function failed(outcome: PluginScanOutcome): Extract<PluginScanOutcome, { status: 'failed' }> {
	assert.equal(outcome.status, 'failed');
	if (outcome.status !== 'failed') throw new Error('unreachable');
	return outcome;
}

interface Harness {
	readonly service: DesktopPluginScanService;
	readonly requests: HelperJobRequest<'plugin-scan'>[];
	readonly quarantined: [string, PluginScanQuarantineReason][];
	readonly disposals: number[];
	/** Mutable so a test can withdraw consent mid-flight, as a user can. */
	readonly grants: Set<string>;
}

function createService({
	enabled = true,
	quarantined = false,
	consented = ['vst3', 'clap'] as readonly string[],
	digests = [] as readonly string[],
	root = ROOT as PluginScanRootLocation | null,
	payload = AVAILABLE_PAYLOAD,
	describePayload,
	run = async () => SCAN as unknown,
}: Partial<{
	enabled: boolean;
	quarantined: boolean;
	consented: readonly string[];
	digests: readonly string[];
	root: PluginScanRootLocation | null;
	payload: NativeAddonAvailability;
	describePayload: () => Promise<NativeAddonAvailability>;
	run: (request: HelperJobRequest<'plugin-scan'>) => Promise<unknown>;
}> = {}): Harness {
	const requests: HelperJobRequest<'plugin-scan'>[] = [];
	const quarantines: [string, PluginScanQuarantineReason][] = [];
	const disposals: number[] = [];
	const grants = new Set(consented);
	const service = new DesktopPluginScanService({
		supervisor: {
			runJob: async (request) => {
				requests.push(request);
				request.signal?.throwIfAborted();
				const result = await run(request);
				if (!request.validateResult) return result;
				try {
					return request.validateResult(result);
				} catch (error) {
					// HelperSupervisor never rethrows the contract error from a
					// rejected result: it kills the channel and reports a typed
					// supervision fault. A double that leaks the raw error would
					// let the service pass against a supervisor that does not exist.
					throw new HelperSupervisionError('malformed-message',
						`The helper returned a result the contract rejects: ${(error as Error).message}`);
				}
			},
			snapshot: () => Object.freeze({ state: 'ready', quarantined }),
			clearQuarantine: () => disposals.push(-1),
			dispose: () => disposals.push(1),
		},
		consent: { isGranted: (format) => grants.has(format) },
		quarantine: {
			isQuarantined: (digest) => digests.includes(digest),
			quarantine: (digest, reason) => quarantines.push([digest, reason]),
		},
		roots: { resolve: (rootId) => (rootId === 'root-1' ? root : null) },
		isEnabled: () => enabled,
		describePayload: describePayload ?? (async () => payload),
	});
	return { service, requests, quarantined: quarantines, disposals, grants };
}

function scan(service: DesktopPluginScanService, patch: Partial<PluginScanRequest> = {}): Promise<PluginScanOutcome> {
	return service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst3', ...patch });
}

async function nextTick(): Promise<void> {
	await new Promise((resolve) => { setTimeout(resolve, 0); });
}

test('the discovery service cannot reach an execution surface at all', () => {
	// Structural, not behavioural: the guarantee is that no import and no job
	// kind in this module could start a plug-in, so a later caller cannot
	// discover one by passing a different argument.
	const specifiers = [...SERVICE_SOURCE.matchAll(/from '([^']+)'/gu)].map(([, specifier]) => specifier);
	assert.deepEqual([...new Set(specifiers)].sort(), [
		'./helper-job-grant.ts',
		'./helper-supervisor.ts',
		'./helper-wire-admission.ts',
		'./native-addon-payload.ts',
		'./plugin-scan-results.ts',
	]);
	assert.equal(/plugin-host/u.test(SERVICE_SOURCE), false, 'the scan service must not name the hosting job kind');
	assert.equal(/binaryPath/u.test(SERVICE_SOURCE), false, 'the scan service must not name a plug-in binary path');
});

test('a request shaped like a hosting request is refused, never reinterpreted', async () => {
	const { service, requests } = createService();
	const hostShaped = {
		owner: {},
		format: 'vst3',
		binaryPath: '/home/scanner/.vst3/Example Reverb.vst3',
		binarySha256: 'b'.repeat(64),
	} as unknown as PluginScanRequest;
	assert.equal(failed(await service.scanRoot(hostShaped)).code, 'unsupported-job');
	const extraKey = { owner: {}, rootId: 'root-1', format: 'vst3', instantiate: true } as unknown as PluginScanRequest;
	assert.equal(failed(await service.scanRoot(extraKey)).code, 'unsupported-job');
	assert.equal(failed(await service.scanRoot(null as unknown as PluginScanRequest)).code, 'unsupported-job');
	assert.equal(failed(await scan(service, { owner: 'renderer-1' as unknown as object })).code, 'unsupported-job');
	assert.equal(failed(await scan(service, { rootId: 'x'.repeat(257) })).code, 'unsupported-job');
	assert.equal(requests.length, 0, 'a refused request must never reach the helper');
});

test('nothing scans while the surface is disabled or the format is unconsented', async () => {
	const disabled = createService({ enabled: false });
	assert.equal(failed(await scan(disabled.service)).code, 'helper-disabled');
	assert.equal(disabled.requests.length, 0);

	const unconsented = createService({ consented: [] });
	assert.equal(failed(await scan(unconsented.service)).code, 'consent-required');
	assert.equal(unconsented.requests.length, 0, 'consent is checked before any helper work');

	// Consent is per format: consenting to one format authorizes only that one.
	const partial = createService({ consented: ['clap'] });
	assert.equal(failed(await scan(partial.service)).code, 'consent-required');
	assert.equal((await scan(partial.service, { format: 'clap' })).status, 'described');
	assert.deepEqual(partial.requests.map(({ grant }) => grant.format), ['clap']);
});

test('availability reports the per-format consent gate without naming a path', async () => {
	const { service } = createService({
		consented: ['vst3'],
		payload: Object.freeze({
			status: 'unavailable',
			reason: 'payload-pending-external',
			detail: 'No Windows ARM64 build host is provisioned.',
		}),
	});
	const availability = await service.availability();
	assert.equal(availability.enabled, true);
	assert.equal(availability.quarantined, false);
	assert.equal(availability.payload.reason, 'payload-pending-external');
	// Derived from the contract, not snapshotted from it: every format the wire
	// admits is listed, and exactly the consented ones are marked so.
	assert.deepEqual(availability.formats.map(({ format }) => format), [...HELPER_PLUGIN_FORMATS]);
	assert.deepEqual(availability.formats.filter(({ consented }) => consented).map(({ format }) => format), ['vst3']);
});

test('availability publishes the payload reason and never its path-bearing detail', async () => {
	// `describeNativeAddonAvailability` puts the resolved payload file in its
	// detail. Main owns that path; a status a renderer can read may carry the
	// closed reason code and nothing that names a location on disk.
	const { service } = createService({
		payload: Object.freeze({
			status: 'unavailable',
			reason: 'payload-digest-mismatch',
			detail: 'The native addon payload at /opt/soundscaper/helper.node does not match its pinned digest.',
		}),
	});
	const availability = await service.availability();
	assert.equal(availability.payload.status, 'unavailable');
	assert.equal(availability.payload.reason, 'payload-digest-mismatch');
	assert.equal(JSON.stringify(availability).includes('/opt/soundscaper'), false,
		'a resolved payload path must not cross to a renderer through availability');
	assert.equal(JSON.stringify(availability).includes('helper.node'), false);
});

test('consent withdrawn while a scan waits is refused, never raced', async () => {
	// Consent is checked before the payload is verified and again before the
	// job is posted: both waits are unbounded from main's point of view, and a
	// withdrawal during either has to stop the scan rather than lose to it.
	let releasePayload: (value: NativeAddonAvailability) => void = () => undefined;
	const duringPayload = createService({
		describePayload: () => new Promise((resolve) => { releasePayload = resolve; }),
	});
	const pending = scan(duringPayload.service);
	await nextTick();
	duringPayload.grants.delete('vst3');
	releasePayload(AVAILABLE_PAYLOAD);
	assert.equal(failed(await pending).code, 'consent-required');
	assert.equal(duringPayload.requests.length, 0, 'a withdrawn format must never reach the helper');
	assert.deepEqual(duringPayload.quarantined, [], 'a withdrawn consent is not a scanner fault');

	let release: () => void = () => undefined;
	let started = 0;
	const queued = createService({
		run: async () => {
			started += 1;
			if (started === 1) await new Promise<void>((resolve) => { release = resolve; });
			return SCAN;
		},
	});
	const first = scan(queued.service);
	await nextTick();
	const second = scan(queued.service);
	await nextTick();
	queued.grants.delete('vst3');
	release();
	assert.equal((await first).status, 'described');
	assert.equal(failed(await second).code, 'consent-required');
	assert.equal(queued.requests.length, 1, 'only the scan still consented when it was posted may run');
	assert.deepEqual(queued.quarantined, []);
});

test('an unknown format or an unregistered root never becomes a helper job', async () => {
	const { service, requests } = createService();
	assert.equal(failed(await scan(service, { format: 'vst2' })).code, 'unknown-format');
	assert.equal(failed(await scan(service, { rootId: 'root-9' })).code, 'unknown-root');
	const unresolvable = createService({ root: null });
	assert.equal(failed(await scan(unresolvable.service)).code, 'unknown-root');
	assert.equal(requests.length + unresolvable.requests.length, 0);
});

test('a quarantined scanner or a quarantined scan location refuses before spawning', async () => {
	const scanner = createService({ quarantined: true });
	assert.equal(failed(await scan(scanner.service)).code, 'helper-quarantined');
	assert.equal(scanner.requests.length, 0);

	const digest = createService({ digests: [ROOT.scanDigest] });
	assert.equal(failed(await scan(digest.service)).code, 'digest-quarantined');
	assert.equal(digest.requests.length, 0, 'a quarantined digest must not be rescanned implicitly');
});

test('an unverifiable payload degrades without spawning and without naming a file', async () => {
	const { service, requests } = createService({
		payload: Object.freeze({
			status: 'unavailable',
			reason: 'payload-digest-mismatch',
			detail: 'The native addon payload at /opt/soundscaper/helper.node does not match its pinned digest.',
		}),
	});
	const outcome = failed(await scan(service));
	assert.equal(outcome.code, 'helper-unavailable');
	assert.equal(outcome.message.includes('/opt/soundscaper'), false, 'a failure message must not carry a raw path');
	assert.equal(requests.length, 0);
});

test('a consented scan grants exactly one root and no bytes of project audio', async () => {
	const { service, requests } = createService();
	const outcome = await scan(service);
	assert.equal(outcome.status, 'described');
	assert.equal(requests.length, 1);
	assert.equal(requests[0].kind, 'plugin-scan');
	assert.deepEqual(requests[0].grant, {
		rootPath: '/home/scanner/.vst3',
		format: 'vst3',
		identity: { dev: 66_305, ino: 4_242 },
	});
	assert.deepEqual(Object.keys(requests[0].grant).sort(), ['format', 'identity', 'rootPath']);
	assert.equal(requests[0].resourcePolicy, PLUGIN_SCAN_RESOURCE_POLICY);
	assert.equal(PLUGIN_SCAN_RESOURCE_POLICY.maximumInputBytes, 1, 'a scan grant may not carry a byte payload');
	assert.equal(requests[0].signal?.aborted, false);
});

test('the described scan a renderer receives carries no raw path anywhere', async () => {
	const { service } = createService();
	const outcome = await scan(service);
	assert.equal(outcome.status, 'described');
	if (outcome.status !== 'described') throw new Error('unreachable');
	assert.equal(JSON.stringify(outcome).includes('/home/scanner'), false,
		'neither the root nor a binary path may reach the renderer');
	assert.equal(Object.hasOwn(outcome.scan.entries[0], 'binaryPath'), false);
	assert.equal(outcome.scan.entries[0].binarySha256, 'b'.repeat(64));
});

test('a helper answer that fails admission durably quarantines the scan unit', async () => {
	const { service, quarantined } = createService({
		run: async () => ({ ...SCAN, entries: [{ ...ENTRY, binaryPath: '../../etc/shadow' }] }),
	});
	const outcome = failed(await scan(service));
	assert.equal(outcome.code, 'helper-failed');
	assert.deepEqual(outcome.fault, { reason: 'malformed-answer', quarantined: true });
	assert.deepEqual(quarantined, [[ROOT.scanDigest, 'malformed-answer']]);
});

test('an oversized answer names its fault and quarantines the location until an explicit rescan', async () => {
	// The realistic shape: the helper really does answer with too many entries,
	// the supervisor rejects the result and reports its own typed fault.
	const overlong = createService({
		run: async () => ({
			...SCAN,
			entries: Array.from({ length: 513 }, (_unused, index) => ({ ...ENTRY, stableId: `com.example.p${String(index)}` })),
		}),
	});
	assert.equal(failed(await scan(overlong.service)).code, 'helper-failed');
	assert.deepEqual(failed(await scan(overlong.service)).fault, { reason: 'malformed-answer', quarantined: true });
	assert.deepEqual(overlong.quarantined,
		[[ROOT.scanDigest, 'malformed-answer'], [ROOT.scanDigest, 'malformed-answer']]);

	// The defensive shape, in case a supervisor ever surfaces the contract error
	// itself: an oversize answer is still a fault, named as one.
	const direct = createService({
		run: () => Promise.reject(new HelperContractViolationError('oversized', 'too many entries')),
	});
	const outcome = failed(await scan(direct.service));
	assert.equal(outcome.code, 'helper-failed');
	assert.deepEqual(outcome.fault, { reason: 'oversize-answer', quarantined: true });
	assert.deepEqual(direct.quarantined, [[ROOT.scanDigest, 'oversize-answer']]);
});

test('a scanner fault is named, and every other failure is named as no fault at all', async () => {
	for (const [cause, code, reason] of [
		['helper-exit', 'helper-failed', 'scanner-crash'],
		['malformed-message', 'helper-failed', 'malformed-answer'],
		['job-mismatch', 'helper-failed', 'malformed-answer'],
		['heartbeat', 'helper-failed', 'scanner-hang'],
		['resource-violation', 'helper-failed', 'scanner-hang'],
		['cancellation-timeout', 'helper-cancelled', 'scanner-hang'],
		// Main's own problems, not the installation's: the shared supervisor
		// refusing a second concurrent job while an audio job is in flight, a
		// helper that has not finished its handshake, a request or kind main
		// built wrong, a payload that failed verification, and every ordinary
		// stop. None of these is evidence about the bytes in the folder.
		['helper-error', 'helper-failed', null],
		['handshake', 'helper-failed', null],
		['invalid-request', 'helper-failed', null],
		['unsupported-kind', 'helper-failed', null],
		['cancelled', 'helper-cancelled', null],
		['disposed', 'helper-disabled', null],
		['binary-mismatch', 'helper-unavailable', null],
		['quarantined', 'helper-quarantined', null],
	] as const) {
		const { service, quarantined } = createService({
			run: () => Promise.reject(new HelperSupervisionError(cause, `simulated ${cause}`)),
		});
		const outcome = failed(await scan(service));
		assert.equal(outcome.code, code, `${cause} must surface as ${code}`);
		assert.deepEqual(outcome.fault, reason === null ? null : { reason, quarantined: true },
			`${cause} must ${reason === null ? 'not be a scanner fault' : `be a ${reason} fault`}`);
		assert.deepEqual(quarantined, reason === null ? [] : [[ROOT.scanDigest, reason]],
			reason === null
				? 'a failure that is not a scanner fault may not cost the location anything'
				: 'a scanner fault must durably quarantine its root-and-format scan unit');
		assert.equal(outcome.message.includes('simulated'), false, 'helper text must not be relayed verbatim');
	}
});

test('an error main did not type at all is never charged to the scanned location', async () => {
	// The catch-all is the dangerous one: a bug in main's own code reaching this
	// handler must not durably cost a user's folder its eligibility.
	for (const error of [new TypeError('main built the request wrong'), 'a string', null]) {
		const { service, quarantined } = createService({ run: () => Promise.reject(error) });
		const outcome = failed(await scan(service));
		assert.equal(outcome.code, 'helper-failed');
		assert.equal(outcome.fault, null, 'an untyped failure is not evidence about the scanned bytes');
		assert.deepEqual(quarantined, []);
	}
});

test('a faulting scan quarantines its own scan unit, and the explicit rescan is the exit', async () => {
	// A folder that crashes the scanner must not be rescanned into the same
	// crash forever; the durable scan-unit quarantine holds that location until
	// the user clears it with the explicit rescan clearance.
	const { service, quarantined } = createService({
		run: () => Promise.reject(new HelperSupervisionError('helper-exit', 'the scanner died')),
	});
	const outcome = failed(await scan(service));
	assert.deepEqual(outcome.fault, { reason: 'scanner-crash', quarantined: true });
	assert.deepEqual(quarantined, [[ROOT.scanDigest, 'scanner-crash']]);

	// Once the durable store holds the scan unit, the same location refuses
	// before any helper job is spawned.
	const blocked = createService({ digests: [ROOT.scanDigest] });
	const refused = failed(await scan(blocked.service));
	assert.equal(refused.code, 'digest-quarantined');
	assert.deepEqual(blocked.requests, [], 'a quarantined location must not reach the helper');
});

test('an installation the scanner calls malformed or oversize loses its own digest', async () => {
	const { service, quarantined } = createService({
		run: async () => ({ ...SCAN, entries: [
			ENTRY,
			{ ...ENTRY, stableId: 'com.example.broken', binarySha256: 'c'.repeat(64), compatibility: 'malformed' },
			{ ...ENTRY, stableId: 'com.example.huge', binarySha256: 'd'.repeat(64), compatibility: 'oversize' },
			{ ...ENTRY, stableId: 'com.example.arm', binarySha256: 'f'.repeat(64), compatibility: 'wrong-architecture' },
		] }),
	});
	assert.equal((await scan(service)).status, 'described');
	assert.deepEqual(quarantined, [
		['c'.repeat(64), 'malformed-plugin'],
		['d'.repeat(64), 'oversize-plugin'],
	]);
});

function settleOnAbort(request: HelperJobRequest<'plugin-scan'>): Promise<unknown> {
	return new Promise((resolve) => {
		request.signal?.addEventListener('abort', () => resolve(SCAN), { once: true });
	});
}

test('scans serialize: contract v1 admits one job at a time', async () => {
	let release: () => void = () => undefined;
	const started: string[] = [];
	const { service } = createService({
		run: async (request) => {
			started.push(request.grant.format);
			if (started.length === 1) await new Promise<void>((resolve) => { release = resolve; });
			return SCAN;
		},
	});
	const first = scan(service);
	await nextTick();
	const second = service.scanRoot({ owner: {}, rootId: 'root-1', format: 'vst3' });
	await nextTick();
	assert.deepEqual(started, ['vst3'], 'the second scan must wait for the first');
	release();
	assert.equal((await first).status, 'described');
	assert.equal((await second).status, 'described');
	assert.equal(started.length, 2);
});

test('a revoked owner is cancelled, and one revoked before its payload never spawns', async () => {
	const owner = {};
	const signals: AbortSignal[] = [];
	const { service } = createService({
		run: (request) => {
			signals.push(request.signal as AbortSignal);
			return settleOnAbort(request);
		},
	});
	const pending = service.scanRoot({ owner, rootId: 'root-1', format: 'vst3' });
	await nextTick();
	service.revokeOwner(owner);
	// A scanner that answers anyway — because its work finished as the abort
	// arrived — must not have that answer published to the owner that left.
	assert.equal(failed(await pending).code, 'helper-cancelled');
	assert.equal(signals.length, 1);
	assert.equal(signals[0].aborted, true);

	let releasePayload: (value: NativeAddonAvailability) => void = () => undefined;
	const slow = createService({
		describePayload: () => new Promise((resolve) => { releasePayload = resolve; }),
		run: settleOnAbort,
	});
	const slowOwner = {};
	const slowScan = slow.service.scanRoot({ owner: slowOwner, rootId: 'root-1', format: 'vst3' });
	await nextTick();
	slow.service.revokeOwner(slowOwner);
	releasePayload(AVAILABLE_PAYLOAD);
	assert.equal(failed(await slowScan).code, 'helper-cancelled');
	assert.equal(slow.requests.length, 0, 'a revoked owner must never spawn a scan');
	assert.deepEqual(slow.quarantined, [], 'a cancelled owner is not a scanner fault');
});

test('disposal aborts every outstanding scan and disposes the supervisor exactly once', async () => {
	const { service, disposals, quarantined } = createService({ run: settleOnAbort });
	const pending = scan(service);
	await nextTick();
	service.dispose();
	service.dispose();
	assert.equal(failed(await pending).code, 'helper-cancelled', 'a scan in flight at shutdown publishes nothing');
	assert.deepEqual(disposals, [1]);
	assert.deepEqual(quarantined, [], 'editor shutdown is not a scanner fault');
	assert.equal(failed(await scan(service)).code, 'helper-disabled');
	service.clearQuarantine();
	assert.deepEqual(disposals, [1, -1]);
});
