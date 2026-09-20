/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopVampAnalyzerRegistry,
	type VampAnalyzerLibraryObservation,
} from '../desktop/vamp-analyzer-registry.ts';
import {
	DesktopVampAnalyzerSessions,
	type VampAnalyzerBackendInstance,
} from '../desktop/vamp-analyzer-session.ts';

const OWNER = {};
const OTHER_OWNER = {};
const DIGEST = 'c'.repeat(64);

function observation(): VampAnalyzerLibraryObservation {
	return {
		kind: 'analyzer-library', format: 'vamp', libraryPath: '/usr/lib/vamp/markers.so',
		libraryBytes: 8_192, librarySha256: DIGEST, identity: { dev: 2, ino: 3 },
		platform: 'linux', architecture: 'x64', compatibility: 'compatible',
		descriptors: [{
			kind: 'analyzer', format: 'vamp', identifier: 'org.example.markers', name: 'Markers',
			description: '', maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2,
			inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
			preferredStepSize: 2, preferredBlockSize: 4, parameters: [], programs: [], outputs: [{
				identifier: 'markers', name: 'Markers', description: '', unit: '', binCount: 1,
				binNames: ['Strength'], extents: { minimumValue: 0, maximumValue: 1 },
				quantizeStep: null, sampleType: 'variable-sample-rate', sampleRate: null,
				hasDuration: false,
			}],
		}],
	};
}

function harness(options: Readonly<{ malformedProcess?: boolean; deferredProcess?: boolean }> = {}) {
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const recorded = registry.recordLibrary(observation());
	assert.equal(recorded.status, 'recorded');
	if (recorded.status !== 'recorded') throw new Error('unreachable');
	const installationId = recorded.analyzers[0]!.installationId;
	registry.allow(installationId);
	const calls: string[] = [];
	let releaseProcess: (() => void) | undefined;
	const processGate = new Promise<void>((resolve) => { releaseProcess = resolve; });
	const instance: VampAnalyzerBackendInstance = {
		configure: async () => {
			calls.push('configure');
			return { outputs: observation().descriptors[0]!.outputs };
		},
		process: async (chunk) => {
			calls.push(`pcm:${String(chunk.startFrame)}:${String(chunk.frameCount)}`);
			if (options.deferredProcess) await processGate;
			return options.malformedProcess ? [{
				outputId: 'markers', timestamp: null, duration: null, values: [1, 2], label: '',
			}] : [{
				outputId: 'markers', timestamp: { seconds: 0, nanoseconds: 0 }, duration: null,
				values: [0.75], label: 'marker',
			}];
		},
		finish: async () => { calls.push('finish'); return [] },
		cancel: async (reason) => { calls.push(`cancel:${reason}`) },
		close: async () => { calls.push('close') },
	};
	const sessions = new DesktopVampAnalyzerSessions({
		registry,
		backend: {
			open: async (grant) => {
				calls.push(`open:${grant.libraryPath}`);
				return instance;
			},
		},
		mintSessionId: () => 'vamp_session_01',
	});
	return { sessions, calls, installationId, releaseProcess: () => releaseProcess?.() };
}

async function configuredSession(fixture: ReturnType<typeof harness>, frameCount = 4) {
	const started = await fixture.sessions.start(OWNER, {
		installationId: fixture.installationId, sessionId: null,
	});
	return fixture.sessions.configure(OWNER, {
		sessionId: started.sessionId, sampleRate: 48_000, channelCount: 1,
		stepSize: 2, blockSize: 4, frameCount, parameters: {}, program: null,
	});
}

test('session streams configured PCM and finishes with pathless analyzer projections', async () => {
	const fixture = harness();
	const configured = await configuredSession(fixture);
	assert.equal(configured.state, 'configured');
	assert.equal(JSON.stringify(configured).includes('/usr/lib'), false);
	assert.equal(configured.kind, 'analyzer-session');
	assert.equal(configured.format, 'vamp');

	const batch = await fixture.sessions.pushPcm(OWNER, {
		sessionId: configured.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0.5, 0, -0.5)],
	});
	assert.equal(batch.features[0]?.outputId, 'markers');
	assert.equal(JSON.stringify(batch).includes('/usr/lib'), false);
	const finished = await fixture.sessions.finish(OWNER, { sessionId: configured.sessionId });
	assert.equal(finished.session.state, 'finished');
	assert.deepEqual(fixture.calls, ['open:/usr/lib/vamp/markers.so', 'configure', 'pcm:0:4', 'finish', 'close']);
	await assert.rejects(() => fixture.sessions.finish(OWNER, { sessionId: configured.sessionId }), /unknown.*session/iu);
});

test('session rejects foreign owners, non-contiguous PCM, and incomplete finishes', async () => {
	const fixture = harness();
	const configured = await configuredSession(fixture, 6);
	await assert.rejects(() => fixture.sessions.pushPcm(OTHER_OWNER, {
		sessionId: configured.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0)],
	}), /owned/iu);
	await assert.rejects(() => fixture.sessions.pushPcm(OWNER, {
		sessionId: configured.sessionId, startFrame: 1, channels: [Float32Array.of(0, 0)],
	}), /contiguous/iu);
	await fixture.sessions.pushPcm(OWNER, {
		sessionId: configured.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0)],
	});
	await assert.rejects(() => fixture.sessions.finish(OWNER, { sessionId: configured.sessionId }), /all configured PCM/iu);
	assert.equal(await fixture.sessions.cancel(OWNER, {
		sessionId: configured.sessionId, reason: 'user-cancelled',
	}), true);
	assert.deepEqual(fixture.calls.slice(-2), ['cancel:user-cancelled', 'close']);
});

test('malformed backend features fail closed and tear down the exact session', async () => {
	const fixture = harness({ malformedProcess: true });
	const configured = await configuredSession(fixture);
	await assert.rejects(() => fixture.sessions.pushPcm(OWNER, {
		sessionId: configured.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0, 0, 0)],
	}), /bin count/iu);
	assert.deepEqual(fixture.calls.slice(-2), ['cancel:backend-fault', 'close']);
	await assert.rejects(() => fixture.sessions.finish(OWNER, { sessionId: configured.sessionId }), /unknown.*session/iu);
});

test('one session admits only one in-flight operation and owner revocation cancels its sessions', async () => {
	const fixture = harness({ deferredProcess: true });
	const configured = await configuredSession(fixture);
	const pending = fixture.sessions.pushPcm(OWNER, {
		sessionId: configured.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0, 0, 0)],
	});
	await assert.rejects(() => fixture.sessions.pushPcm(OWNER, {
		sessionId: configured.sessionId, startFrame: 0, channels: [Float32Array.of(0, 0, 0, 0)],
	}), /busy/iu);
	fixture.releaseProcess();
	await pending;
	assert.equal(await fixture.sessions.cancelOwner(OWNER, 'renderer-revoked'), 1);
	assert.deepEqual(fixture.calls.slice(-2), ['cancel:renderer-revoked', 'close']);
});

