/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
	lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import {
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneReservedFile,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';
import type { HelperDataPlaneOutputReservation } from '../desktop/helper-data-plane-output-reservation.ts';
import type { HelperMediaImageSequenceDecodeJobGrant } from '../desktop/helper-native-job-contract.ts';
import { framescaperNativeImageSequenceAssetPath } from '../desktop/native-image-sequence-import-contract.ts';
import {
	FramescaperNativeImageSequenceDecodeAuthority,
} from '../desktop/native-image-sequence-decode-authority.ts';
import type { NativeMediaHelperPoolJobRequest } from '../desktop/native-media-helper-pool.ts';

const PROJECT_ID = 'sequence-project';
const SOURCE_ID = 'sequence-source';
const REVISION = 8;
const RATE = Object.freeze({ num: 60_000, den: 1_001 });
const OWNER = Object.freeze({ id: 'renderer' });

test('real authority decode retains exact 60000/1001 source, grant, pack, and claim timing', async (t) => {
	const observed: {
		plan?: Record<string, unknown>;
		grant?: HelperMediaImageSequenceDecodeJobGrant;
	} = {};
	const fixture = await authorityFixture(t, {
		async runJob(request, ordinal) {
			const { grant, ports } = decodeJob(request);
			observed.grant = grant;
			observed.plan = await receivePlan(
				fixture.directory, grant.plan, ports.plan, ordinal, request.signal,
			);
			return sendDecoded(fixture.directory, fixture.decoded, grant.output, ports.output, ordinal);
		},
	});
	const claim = exactClaim(await fixture.authority.request(OWNER, decodeRequest(0)));
	assert.deepEqual(claim.frameRate, RATE);
	assert.ok(observed.grant);
	assert.deepEqual(observed.grant.imageSequence.frameRate, RATE);
	assert.ok(observed.plan);
	const timebase = observed.plan.timebase as Readonly<{ sequenceRate: unknown }>;
	assert.deepEqual(timebase.sequenceRate, RATE);
	const nodes = observed.plan.nodes as readonly Readonly<Record<string, unknown>>[];
	const professional = nodes.find(({ kind }) => kind === 'professional-media');
	assert.ok(professional);
	const source = professional.imageSequence as Readonly<{ frameRate: unknown }>;
	assert.deepEqual(source.frameRate, RATE);
	const header = new DataView(
		fixture.decoded.buffer, fixture.decoded.byteOffset, fixture.decoded.byteLength,
	);
	assert.deepEqual({ num: header.getUint32(55, true), den: header.getUint32(51, true) }, RATE);
	assert.equal(await fixture.authority.request(OWNER, {
		operation: 'release', claimId: claim.claimId,
	}), true);
	await fixture.authority.dispose();
});

test('owner revocation waits for in-flight admission settlement and prevents helper work', async (t) => {
	const readStarted = deferred<void>();
	const releaseRead = deferred<void>();
	const fixture = await authorityFixture(t, {
		async readProjectBundle() {
			readStarted.resolve();
			await releaseRead.promise;
			return fixtureBundle(fixture);
		},
	});
	const decode = fixture.authority.request(OWNER, decodeRequest(1));
	await readStarted.promise;
	let revoked = false;
	const revocation = fixture.authority.revokeOwner(OWNER).then(() => { revoked = true; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(revoked, false, 'revocation must await the active request, not only signal it');
	releaseRead.resolve();
	await assert.rejects(decode, { name: 'AbortError' });
	await revocation;
	assert.equal(revoked, true);
	assert.equal(fixture.jobs(), 0, 'an aborted admission cannot reach native work');
	assert.deepEqual(await decodedClaims(fixture.root), []);
	await fixture.authority.dispose();
});

test('decode cancellation aborts the data plane and a late helper result cannot install a claim', async (t) => {
	const jobStarted = deferred<void>();
	let observedAbort = false;
	let lateResult = false;
	const fixture = await authorityFixture(t, {
		async runJob(request) {
			const { grant, ports } = decodeJob(request);
			await receivePlan(fixture.directory, grant.plan, ports.plan, 1, request.signal);
			jobStarted.resolve();
			await abortObserved(request.signal);
			observedAbort = true;
			lateResult = true;
			return { output: completion(grant.output, fixture.decoded) };
		},
	});
	const decode = fixture.authority.request(OWNER, decodeRequest(2));
	await jobStarted.promise;
	assert.equal(await fixture.authority.request(OWNER, {
		operation: 'cancel', requestId: opaque(2),
	}), true);
	await assert.rejects(decode, { name: 'AbortError' });
	assert.equal(observedAbort, true);
	assert.equal(lateResult, true);
	assert.deepEqual(await decodedClaims(fixture.root), []);
	await fixture.authority.dispose();
});

test('seven claims reserve only one concurrent decode and never exceed eight open claims', async (t) => {
	const eighthStarted = deferred<void>();
	const releaseEighth = deferred<void>();
	const fixture = await authorityFixture(t, {
		async runJob(request, ordinal) {
			const { grant, ports } = decodeJob(request);
			await receivePlan(fixture.directory, grant.plan, ports.plan, ordinal, request.signal);
			if (ordinal === 8) {
				eighthStarted.resolve();
				await releaseEighth.promise;
			}
			return sendDecoded(fixture.directory, fixture.decoded, grant.output, ports.output, ordinal);
		},
	});
	const claims: Claim[] = [];
	for (let index = 1; index <= 7; index += 1) {
		claims.push(exactClaim(await fixture.authority.request(OWNER, decodeRequest(index + 10))));
	}
	const contenders = Array.from({ length: 4 }, (_, index) => (
		fixture.authority.request(OWNER, decodeRequest(index + 30))
	));
	const settlement = Promise.allSettled(contenders);
	await eighthStarted.promise;
	releaseEighth.resolve();
	const results = await settlement;
	const installed = results.filter((result): result is PromiseFulfilledResult<unknown> => (
		result.status === 'fulfilled'
	)).map(({ value }) => exactClaim(value));
	assert.equal(installed.length, 1);
	assert.equal(results.filter(({ status }) => status === 'rejected').length, 3);
	claims.push(...installed);
	assert.equal((await decodedClaims(fixture.root)).length, 8);
	await assert.rejects(
		fixture.authority.request(OWNER, decodeRequest(50)),
		/capacity/iu,
	);
	for (const claim of claims) {
		assert.equal(await fixture.authority.request(OWNER, {
			operation: 'release', claimId: claim.claimId,
		}), true);
	}
	assert.deepEqual(await decodedClaims(fixture.root), []);
	await fixture.authority.dispose();
});

test('failed unlink retains a closed claim and dispose retries cleanup without an orphan', async (t) => {
	const fixture = await authorityFixture(t);
	const claim = exactClaim(await fixture.authority.request(OWNER, decodeRequest(60)));
	const claimsPath = join(fixture.root, 'decoded-claims');
	const displaced = join(fixture.root, 'decoded-claims-displaced');
	await rename(claimsPath, displaced);
	await assert.rejects(
		fixture.authority.request(OWNER, { operation: 'release', claimId: claim.claimId }),
		/cleanup failed/iu,
	);
	await rename(displaced, claimsPath);
	await assert.rejects(fixture.authority.request(OWNER, {
		operation: 'read', claimId: claim.claimId, offset: 0, length: 1,
	}), /outside this owner claim/iu, 'a retained claim cannot serve through its closed handle');
	await fixture.authority.dispose();
	assert.deepEqual(await decodedClaims(fixture.root), []);
	await fixture.authority.dispose();
});

interface Claim {
	readonly claimId: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
}

interface Fixture {
	readonly directory: string;
	readonly root: string;
	readonly decoded: Uint8Array;
	readonly bundle: Readonly<Record<string, unknown>>;
	readonly authority: FramescaperNativeImageSequenceDecodeAuthority;
	readonly jobs: () => number;
}

async function authorityFixture(t: TestContext,
	options: Readonly<{
		readonly readProjectBundle?: () => Promise<unknown>;
		readonly runJob?: (request: NativeMediaHelperPoolJobRequest, ordinal: number) => Promise<unknown>;
	}> = {},
): Promise<Fixture> {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-sequence-decode-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, 'authority');
	const scratchRoot = join(directory, 'scratch');
	const objects = join(root, 'objects');
	await mkdir(objects, { recursive: true });
	const packBytes = Uint8Array.of(1, 2, 3);
	const inventoryBytes = new TextEncoder().encode('{"schemaVersion":1}');
	const packSha256 = digest(packBytes);
	const inventorySha256 = digest(inventoryBytes);
	const pack = Object.freeze({
		kind: 'image-sequence-source-pack' as const,
		storageKey: `image-sequence-pack-sha256:${packSha256}`,
		sha256: packSha256, byteLength: packBytes.byteLength,
	});
	const inventory = Object.freeze({
		kind: 'image-sequence-inventory' as const, version: 1 as const,
		storageKey: `image-sequence-inventory-sha256:${inventorySha256}`,
		sha256: inventorySha256, byteLength: inventoryBytes.byteLength,
		frameCount: 1, firstFrameNumber: 1, lastFrameNumber: 1,
	});
	await Promise.all([
		writeFile(framescaperNativeImageSequenceAssetPath(root, pack), packBytes),
		writeFile(framescaperNativeImageSequenceAssetPath(root, inventory), inventoryBytes),
	]);
	const source = Object.freeze({
		kind: 'video' as const, sourceType: 'image-sequence' as const, version: 1 as const,
		id: SOURCE_ID, name: 'Sequence', stem: 'shot.', extension: 'png', frameNumberWidth: 4,
		firstFrameNumber: 1, lastFrameNumber: 1, frameCount: 1, frameRate: RATE,
		inventory, sourcePack: pack,
		characteristics: Object.freeze({
			backend: 'framescaper-media-host', codedWidth: 2, codedHeight: 2,
			hasAlpha: false, videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24',
			chromaFormat: '4:4:4', alphaMode: null, alphaInterpretation: null,
			colour: Object.freeze({
				primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
			}),
		}),
	});
	const document = Object.freeze({
		schemaVersion: 28, id: PROJECT_ID, revision: REVISION,
		sources: Object.freeze([Object.freeze({
			kind: 'video', id: SOURCE_ID, storageKey: pack.storageKey,
			contentSha256: pack.sha256, imageSequence: source,
		})]),
	});
	const bundle = Object.freeze({
		project: Object.freeze({ projectRevision: REVISION }), document: JSON.stringify(document),
		bodies: Object.freeze([
			Object.freeze({ kind: pack.kind, storageKey: pack.storageKey,
				byteLength: pack.byteLength, sha256: pack.sha256 }),
			Object.freeze({ kind: inventory.kind, storageKey: inventory.storageKey,
				byteLength: inventory.byteLength, sha256: inventory.sha256 }),
		]),
	});
	const executablePath = join(directory, 'media-host');
	const executableBytes = new TextEncoder().encode('fixture executable');
	await writeFile(executablePath, executableBytes, { mode: 0o700 });
	const executableStat = await lstat(executablePath);
	const decoded = decodedPack();
	let opaqueId = 0;
	let jobCount = 0;
	const authority = new FramescaperNativeImageSequenceDecodeAuthority({
		root, scratchRoot,
		project: {
			projectState: () => Object.freeze({ open: true, writable: true }),
			readProjectBundle: options.readProjectBundle ?? (() => Promise.resolve(bundle)),
		},
		executable: () => Object.freeze({
			path: executablePath, byteLength: executableBytes.byteLength,
			sha256: digest(executableBytes),
			identity: Object.freeze({ dev: executableStat.dev, ino: executableStat.ino }),
		}),
		createMessageChannel: () => channel(),
		mediaRuntime: {
			available: () => true,
			async runJob(request) {
				jobCount += 1;
				if (options.runJob) return options.runJob(request, jobCount);
				const { grant, ports } = decodeJob(request);
				await receivePlan(directory, grant.plan, ports.plan, jobCount, request.signal);
				return sendDecoded(directory, decoded, grant.output, ports.output, jobCount);
			},
		},
		mintOpaqueId: () => (++opaqueId).toString(16).padStart(40, '0'),
		runtimeAvailable: () => true,
	});
	const fixture = Object.freeze({ directory, root, decoded, bundle, authority, jobs: () => jobCount });
	return fixture;
}

function fixtureBundle(fixture: Fixture): unknown { return fixture.bundle; }

function decodeRequest(index: number) {
	return Object.freeze({
		operation: 'decode' as const, requestId: opaque(index),
		projectId: PROJECT_ID, projectRevision: REVISION, sourceId: SOURCE_ID,
	});
}

function decodeJob(request: NativeMediaHelperPoolJobRequest) {
	assert.equal(request.kind, 'media-decode');
	const grant = request.grant as HelperMediaImageSequenceDecodeJobGrant;
	assert.ok(grant.imageSequence);
	const transfers = request.dataPlaneTransfers ?? [];
	const plan = transfers.find(({ streamId }) => streamId === grant.plan.streamId)?.port;
	const output = transfers.find(({ streamId }) => streamId === grant.output.streamId)?.port;
	assert.ok(plan instanceof Port);
	assert.ok(output instanceof Port);
	return Object.freeze({ grant, ports: Object.freeze({ plan, output }) });
}

async function receivePlan(
	directory: string, binding: HelperDataPlaneBinding, port: Port,
	ordinal: number, signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const path = join(directory, `helper-plan-${String(ordinal)}.json`);
	await receiveHelperDataPlaneFile({
		binding, port, path,
		...(signal ? { signal } : {}),
	});
	return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

async function sendDecoded(
	directory: string, bytes: Uint8Array, reservation: HelperDataPlaneOutputReservation,
	port: Port, ordinal: number,
): Promise<unknown> {
	const path = join(directory, `helper-output-${String(ordinal)}.rgba-pack`);
	await writeFile(path, bytes);
	const output = completion(reservation, bytes);
	await sendHelperDataPlaneReservedFile({ reservation, port, path, completion: output });
	return Object.freeze({ output });
}

function completion(reservation: HelperDataPlaneOutputReservation, bytes: Uint8Array) {
	return Object.freeze({
		streamId: reservation.streamId, byteLength: bytes.byteLength, sha256: digest(bytes),
	});
}

function decodedPack(): Uint8Array {
	const bytes = new Uint8Array(107);
	bytes.set(new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n'));
	const view = new DataView(bytes.buffer);
	view.setUint32(31, 1, true); view.setUint32(35, 2, true); view.setUint32(39, 2, true);
	view.setBigUint64(43, 1n, true); view.setUint32(51, RATE.den, true); view.setUint32(55, RATE.num, true);
	view.setBigUint64(59, 0n, true); view.setBigInt64(67, 0n, true);
	view.setBigInt64(75, 1n, true); view.setBigUint64(83, 16n, true);
	bytes.set([
		11, 22, 33, 255, 44, 55, 66, 255,
		77, 88, 99, 255, 111, 122, 133, 255,
	], 91);
	return bytes;
}

function exactClaim(value: unknown): Claim {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	const row = value as Record<string, unknown>;
	assert.equal(typeof row.claimId, 'string');
	assert.equal(typeof row.byteLength, 'number');
	assert.equal(typeof row.sha256, 'string');
	assert.deepEqual(row.frameRate, RATE);
	return row as unknown as Claim;
}

async function decodedClaims(root: string): Promise<readonly string[]> {
	try { return (await readdir(join(root, 'decoded-claims'))).sort(); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

async function abortObserved(signal?: AbortSignal): Promise<void> {
	assert.ok(signal);
	if (signal.aborted) return;
	await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function opaque(value: number): string { return value.toString(16).padStart(40, '0'); }

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((done) => { resolve = done; });
	return Object.freeze({ promise, resolve });
}

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	readonly pending: unknown[] = [];
	started = false;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.accept(message)); }
	start(): void {
		this.started = true;
		for (const message of this.pending.splice(0)) this.emit('message', { data: message });
	}
	close(): void {}
	accept(message: unknown): void {
		if (!this.started) this.pending.push(message);
		else this.emit('message', { data: message });
	}
}

function channel(): Readonly<{ hostPort: Port; helperPort: Port }> {
	const hostPort = new Port();
	const helperPort = new Port();
	hostPort.peer = helperPort;
	helperPort.peer = hostPort;
	return Object.freeze({ hostPort, helperPort });
}
