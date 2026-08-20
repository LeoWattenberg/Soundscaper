/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureDurableSessionCoordinator,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import {
	captureCreationInventory,
} from '../src/common/editor/controller/framescaper-capture-durable-creation.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { framescaperCaptureCreationFenceKey } from '../src/common/editor/storage/framescaper-capture-session-creation-repository.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import {
	capacityCreation,
	commitManifest,
	createFixture,
	createRepositories,
	creationJournalKey,
	encodedPort,
	globalRawReservationCount,
	initialManifest,
	manifestPort,
	rawFaultValues,
	rawOnlySessionRequest,
	rawOwner,
	rawPacket,
	rawPcmPort,
	restartedCoordinator,
	sequentialId,
	sessionRequest,
} from './helpers/framescaper-capture-creation-recovery-fixture.ts';

test('startup globally retries an exact partial creation even after its origin project is absent', async () => {
	const fixture = createFixture();
	let refuseEncodedCleanup = true;
	const interrupted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: {
			...encodedPort(fixture.encodedSpools),
			async delete(record) {
				if (refuseEncodedCleanup) throw new Error('encoded cleanup interrupted');
				await fixture.encodedSpools.delete(record);
			},
		},
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async createFramescaper() { throw new Error('second spool unavailable'); },
		},
		manifests: fixture.manifests,
		now: () => 100,
		createId: () => 'interrupted-attempt',
	});

	await assert.rejects(interrupted.create(sessionRequest()), /second spool unavailable/u);
	const leftover = await fixture.encodedSpools.load('project-capture', 'camera-spool');
	assert.ok(leftover);
	assert.equal(leftover.spoolToken, 'framescaper-capture:interrupted-attempt');
	assert.equal((await fixture.manifests.listProjectCreations('project-capture'))[0]?.state, 'cleanup-pending');

	refuseEncodedCleanup = false;
	const reopened = createRepositories(fixture.memory);
	const restarted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: reopened.encodedSpools,
		rawPcmSpools: reopened.rawPcmSpools,
		manifests: reopened.manifests,
		now: () => 200,
	});
	assert.deepEqual(await restarted.recoveryInventory('surviving-project'), []);
	assert.equal(await reopened.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.deepEqual(await reopened.manifests.listProjectCreations('project-capture'), []);
});

test('create retries every exactly inventoried spool after manifest and cleanup failures', async () => {
	const fixture = createFixture();
	let refuseCleanup = true;
	const interrupted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: {
			...encodedPort(fixture.encodedSpools),
			async delete(record) {
				if (refuseCleanup) throw new Error('encoded cleanup interrupted');
				await fixture.encodedSpools.delete(record);
			},
		},
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async remove(record) {
				if (refuseCleanup) throw new Error('PCM cleanup interrupted');
				return fixture.rawPcmSpools.remove(record);
			},
		},
		manifests: {
			...manifestPort(fixture.manifests),
			async publishCreation() { throw new Error('manifest unavailable'); },
		},
		now: () => 100,
		createId: sequentialId('failed'),
	});

	await assert.rejects(interrupted.create(sessionRequest()), /manifest unavailable/u);
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));
	assert.equal((await fixture.manifests.listProjectCreations('project-capture'))[0]?.state, 'cleanup-pending');

	refuseCleanup = false;
	const restarted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 200,
		createId: sequentialId('retry'),
	});
	const session = await restarted.create(sessionRequest());

	assert.equal(session.manifest.state, 'capturing');
	assert.equal((await fixture.encodedSpools.load('project-capture', 'camera-spool'))?.spoolToken,
		'framescaper-capture:retry-1');
	assert.equal((await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'))?.spoolToken,
		'microphone-spool:capture:retry-2');
	assert.deepEqual(await fixture.manifests.listProjectCreations('project-capture'), []);
});

test('orphan retry fails closed when an inventoried spool has changed ownership', async () => {
	const fixture = createFixture();
	let refuseRawCleanup = true;
	const interrupted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async remove(record) {
				if (refuseRawCleanup) return false;
				return fixture.rawPcmSpools.remove(record);
			},
		},
		manifests: {
			...manifestPort(fixture.manifests),
			async publishCreation() { throw new Error('manifest unavailable'); },
		},
		now: () => 100,
		createId: sequentialId('changed'),
	});

	await assert.rejects(interrupted.create(sessionRequest()), /manifest unavailable/u);
	const raw = await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
	assert.ok(raw);
	await fixture.rawPcmSpools.replaceData(raw, { kind: 'foreign-owner' });
	refuseRawCleanup = false;
	const restarted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 200,
	});

	await assert.rejects(restarted.recoveryInventory('project-capture'), /ownership changed/u);
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));
	assert.equal((await fixture.manifests.listProjectCreations('project-capture')).length, 1);
});

test('a generic same-token raw lookalike is never accepted or reclaimed as Framescaper creation storage', async () => {
	const fixture = createFixture();
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async createFramescaper(request) {
				await fixture.rawPcmSpools.create(request);
				return fixture.rawPcmSpools.createFramescaper(request);
			},
		},
		manifests: fixture.manifests,
		now: () => 100,
		createId: () => 'generic-lookalike',
	});

	await assert.rejects(coordinator.create(rawOnlySessionRequest()), /ownership changed|already exists/u);
	const lookalike = await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
	assert.ok(lookalike);
	assert.equal(lookalike.appendProtocol, undefined);
	assert.equal(lookalike.spoolToken, 'microphone-spool:capture:generic-lookalike');
	assert.equal((await fixture.manifests.listProjectCreations('project-capture')).length, 1);
});

test('an interrupted cleanup-state transition remains leased then becomes globally recoverable', async () => {
	const fixture = createFixture();
	const interrupted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: {
			...encodedPort(fixture.encodedSpools),
			async delete() { throw new Error('encoded cleanup interrupted'); },
		},
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async remove() { throw new Error('PCM cleanup interrupted'); },
		},
		manifests: {
			...manifestPort(fixture.manifests),
			async publishCreation() { throw new Error('manifest unavailable'); },
			async replaceCreation() { throw new Error('journal transition interrupted'); },
		},
		now: () => 100,
		createId: sequentialId('leased'),
	});

	await assert.rejects(interrupted.create(sessionRequest()), /manifest unavailable/u);
	const journal = (await fixture.manifests.listProjectCreations('project-capture'))[0];
	assert.equal(journal?.state, 'creating');
	assert.equal(journal?.leaseExpiresAt, 60_100);

	const beforeExpiry = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 60_099,
	});
	assert.deepEqual(await beforeExpiry.recoveryInventory('surviving-project'), []);
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));

	const expired = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 60_100,
	});
	assert.deepEqual(await expired.recoveryInventory('surviving-project'), []);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
	assert.deepEqual(await fixture.manifests.listCreations(), []);
});

test('expired maintenance fences a deferred live creator before deleting its partial spools', async () => {
	const fixture = createFixture();
	let clock = 100;
	let releaseRaw!: () => void;
	let rawStarted!: () => void;
	const rawGate = new Promise<void>((resolve) => { releaseRaw = resolve; });
	const rawAdmission = new Promise<void>((resolve) => { rawStarted = resolve; });
	const creator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async createFramescaper(request) {
				rawStarted();
				await rawGate;
				return fixture.rawPcmSpools.createFramescaper(request);
			},
		},
		manifests: fixture.manifests,
		now: () => clock,
		createId: sequentialId('deferred'),
	});
	const creation = creator.create(sessionRequest());
	await rawAdmission;
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);

	clock = 60_100;
	const maintenance = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => clock,
	});
	assert.deepEqual(await maintenance.recoveryInventory('surviving-project'), []);
	releaseRaw();
	await assert.rejects(creation, /creation|global admission/u);

	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
	assert.deepEqual(await fixture.manifests.listCreations(), []);
});

test('a manifest that commits before publication acknowledgement wins over destructive settlement', async () => {
	const fixture = createFixture();
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifestPort(fixture.manifests),
			async publishCreation(expected, manifest) {
				await fixture.manifests.publishCreation(expected, manifest);
				throw new Error('manifest publication acknowledgement was lost');
			},
		},
		now: () => 100,
		createId: sequentialId('committed'),
	});

	await assert.rejects(coordinator.create(sessionRequest()), /acknowledgement was lost/u);

	const manifest = await fixture.manifests.load('project-capture', 'session-capture');
	assert.equal(manifest?.state, 'capturing');
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));
	assert.deepEqual(await fixture.manifests.listCreations(), []);
});

test('an expired creation fence rejects a late raw metadata commit without creator settlement', async () => {
	const fixture = createFixture();
	const request = rawOnlySessionRequest();
	const creation = captureCreationInventory(request, 100, () => 'late-dead-creator');
	await fixture.manifests.createCreation(creation);
	const maintenance = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 60_100,
	});
	await maintenance.recoveryInventory('unrelated-surviving-project');

	await assert.rejects(fixture.rawPcmSpools.create({
		projectId: creation.projectFence.projectId,
		spoolId: creation.streams[0]!.spoolId,
		spoolToken: creation.streams[0]!.spoolToken,
		creationFence: {
			key: framescaperCaptureCreationFenceKey(
				creation.projectFence.projectId, creation.sessionId,
			),
			expected: creation,
		},
		sampleRate: 48_000,
		channelCount: 2,
		chunkFrames: 1_024,
		data: rawOwner(),
	}), /global admission/u);

	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
	assert.equal(globalRawReservationCount(await fixture.values.get('raw-pcm-spool-global-inventory-v1')), 0);
	assert.deepEqual(await fixture.manifests.listCreations(), []);
});

test('journal cleanup atomically fences a delayed publication-fence reservation', async () => {
	const fixture = createFixture();
	let releaseFence!: () => void;
	let fenceStarted!: () => void;
	const fenceGate = new Promise<void>((resolve) => { releaseFence = resolve; });
	const fenceAdmission = new Promise<void>((resolve) => { fenceStarted = resolve; });
	const values = fixture.values;
	const delayedManifests = new FramescaperCaptureSessionManifestRepository({
		get: values.get.bind(values),
		putIfAbsent: values.putIfAbsent.bind(values),
		putIfAbsentAndUpdate: values.putIfAbsentAndUpdate.bind(values),
		replaceIfCurrent: values.replaceIfCurrent.bind(values),
		deleteIfCurrent: values.deleteIfCurrent.bind(values),
		listByPrefix: values.listByPrefix.bind(values),
		async putIfAbsentWhenCurrent(...args) {
			if (args[2].startsWith('framescaper-capture-session-creation-fence-v1:')) {
				fenceStarted();
				await fenceGate;
			}
			return values.putIfAbsentWhenCurrent(...args);
		},
	});
	const creation = captureCreationInventory(rawOnlySessionRequest(), 100, () => 'delayed-fence');
	const pendingCreation = delayedManifests.createCreation(creation);
	await fenceAdmission;

	await createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 60_100,
	}).recoveryInventory('surviving-project');
	releaseFence();
	await assert.rejects(pendingCreation, /publication fence/u);

	assert.equal(await values.get(framescaperCaptureCreationFenceKey(
		creation.projectFence.projectId, creation.sessionId,
	)), undefined);
	assert.deepEqual(await fixture.manifests.listCreations(), []);
});

test('startup releases exact raw reservations stranded at both registry crash boundaries', async (t) => {
	await t.test('global reservation committed before registry creation', async () => {
		const fixture = createFixture();
		const faultValues = rawFaultValues(fixture, {
			refuseRegistryCreation: true,
			refuseGlobalRelease: () => true,
		});
		const interruptedRaw = new RawPcmSpoolRepository(faultValues, fixture.sourceRecords);
		const interrupted = createFramescaperCaptureDurableSessionCoordinator({
			encodedSpools: fixture.encodedSpools,
			rawPcmSpools: interruptedRaw,
			manifests: fixture.manifests,
			now: () => 100,
			createId: () => 'reserve-before-registry',
		});

		await assert.rejects(interrupted.create(rawOnlySessionRequest()), /global release interrupted/u);
		assert.equal(await interruptedRaw.load('project-capture', 'microphone-spool'), null);
		assert.equal(globalRawReservationCount(
			await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
		), 1);
		assert.equal((await fixture.manifests.listCreations()).length, 1);

		await restartedCoordinator(fixture).recoveryInventory('surviving-project');
		assert.equal(globalRawReservationCount(
			await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
		), 0);
		assert.deepEqual(await fixture.manifests.listCreations(), []);
	});

	await t.test('registry deleted before global reservation release', async () => {
		const fixture = createFixture();
		let registryDeleted = false;
		const faultValues = rawFaultValues(fixture, {
			refuseGlobalRelease: () => registryDeleted,
			onRegistryDelete: () => { registryDeleted = true; },
		});
		const interruptedRaw = new RawPcmSpoolRepository(faultValues, fixture.sourceRecords);
		const interrupted = createFramescaperCaptureDurableSessionCoordinator({
			encodedSpools: fixture.encodedSpools,
			rawPcmSpools: interruptedRaw,
			manifests: {
				...manifestPort(fixture.manifests),
				async publishCreation() { throw new Error('manifest unavailable'); },
			},
			now: () => 100,
			createId: () => 'delete-before-release',
		});

		await assert.rejects(interrupted.create(rawOnlySessionRequest()), /manifest unavailable/u);
		assert.equal(registryDeleted, true);
		assert.equal(await interruptedRaw.load('project-capture', 'microphone-spool'), null);
		assert.equal(globalRawReservationCount(
			await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
		), 1);
		assert.equal((await fixture.manifests.listCreations()).length, 1);

		await restartedCoordinator(fixture).recoveryInventory('surviving-project');
		assert.equal(globalRawReservationCount(
			await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
		), 0);
		assert.deepEqual(await fixture.manifests.listCreations(), []);
	});
});

test('terminal session retry releases a raw reservation after its registry deletion crash', async (t) => {
	for (const terminal of ['committed', 'discarded'] as const) {
		await t.test(terminal, async () => {
			const fixture = createFixture();
			let registryDeleted = false;
			const interruptedRaw = new RawPcmSpoolRepository(rawFaultValues(fixture, {
				refuseGlobalRelease: () => registryDeleted,
				onRegistryDelete: () => { registryDeleted = true; },
			}), fixture.sourceRecords);
			const coordinator = createFramescaperCaptureDurableSessionCoordinator({
				encodedSpools: fixture.encodedSpools,
				rawPcmSpools: interruptedRaw,
				manifests: fixture.manifests,
				now: () => 100,
				createId: () => `terminal-${terminal}`,
			});
			const session = await coordinator.create(rawOnlySessionRequest());
			assert.deepEqual(await fixture.manifests.listCreations(), []);
			if (terminal === 'committed') {
				await session.append(rawPacket());
				await session.seal();
				await commitManifest(fixture.manifests, session.manifest);
			}

			await assert.rejects(
				terminal === 'committed' ? session.retireCommitted() : session.delete(),
				/global release interrupted/u,
			);
			assert.equal(registryDeleted, true);
			assert.equal(await interruptedRaw.load('project-capture', 'microphone-spool'), null);
			assert.equal(globalRawReservationCount(
				await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
			), 1);
			assert.equal((await fixture.manifests.load(
				'project-capture', 'session-capture',
			))?.state, terminal);

			await restartedCoordinator(fixture).recoveryInventory('project-capture');
			assert.equal(globalRawReservationCount(
				await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
			), 0);
			assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
		});
	}
});

test('creation records require closed exact leases, canonical keys, and an exact initial manifest', async () => {
	const fixture = createFixture();
	const creation = captureCreationInventory(rawOnlySessionRequest(), 100, () => 'strict-creation');
	await assert.rejects(fixture.manifests.createCreation({
		...creation,
		leaseExpiresAt: creation.leaseExpiresAt + 1,
	}), /lease duration/u);
	await assert.rejects(fixture.manifests.createCreation({
		...creation,
		unexpected: true,
	}), /closed shape/u);
	await assert.rejects(fixture.manifests.createCreation(Object.assign(
		Object.create({ inherited: true }) as object,
		creation,
	)), /closed data record/u);
	const accessor = { ...creation };
	Object.defineProperty(accessor, 'state', { enumerable: true, get: () => 'creating' });
	await assert.rejects(fixture.manifests.createCreation(accessor), /data property/u);
	const prototypeStreams = [...creation.streams];
	Object.setPrototypeOf(prototypeStreams, null);
	await assert.rejects(fixture.manifests.createCreation({
		...creation,
		streams: prototypeStreams,
	}), /closed data array/u);

	const persisted = await fixture.manifests.createCreation(creation);
	await assert.rejects(fixture.manifests.publishCreation(persisted, {
		...initialManifest(persisted),
		updatedAt: persisted.createdAt + 1,
	}), /exact initial manifest/u);
	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);

	const foreign = captureCreationInventory({
		...rawOnlySessionRequest(),
		sessionId: 'foreign-session',
	}, 100, () => 'foreign-key');
	await fixture.values.put(
		'framescaper-capture-session-creation-v1:project-capture:not-the-session',
		foreign,
	);
	await assert.rejects(fixture.manifests.listCreations(), /key ownership changed/u);
});

test('global journal admission atomically refuses a concurrent 4097th creation', async () => {
	const fixture = createFixture();
	const entries: { projectId: string; sessionId: string }[] = [];
	for (let index = 0; index < 4_095; index += 1) {
		const projectId = `capacity-project-${String(index)}`;
		const sessionId = `capacity-session-${String(index)}`;
		const creation = capacityCreation(projectId, sessionId, index);
		entries.push({ projectId, sessionId });
		await fixture.values.put(creationJournalKey(projectId, sessionId), creation);
	}
	await fixture.values.put('framescaper-capture-session-creation-admission-v1', {
		version: 1,
		entries,
	});

	const candidates = [
		capacityCreation('last-slot-a', 'last-session-a', 4_095),
		capacityCreation('last-slot-b', 'last-session-b', 4_096),
	];
	const results = await Promise.allSettled(candidates.map((creation) => (
		fixture.manifests.createCreation(creation)
	)));
	assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
	const refused = results.find(({ status }) => status === 'rejected');
	assert.equal(refused?.status, 'rejected');
	if (refused?.status === 'rejected') assert.match(String(refused.reason), /global admission bound/u);
	assert.equal((await fixture.manifests.listCreations()).length, 4_096);
	await assert.rejects(
		fixture.manifests.createCreation(capacityCreation('overflow', 'overflow-session', 4_097)),
		/global admission bound/u,
	);
	assert.equal((await fixture.manifests.listCreations()).length, 4_096);

	await fixture.values.delete(creationJournalKey('capacity-project-0', 'capacity-session-0'));
	await fixture.manifests.createCreation(capacityCreation(
		'recovered-slot', 'recovered-session', 4_098,
	));
	assert.equal((await fixture.manifests.listCreations()).length, 4_096);
});
