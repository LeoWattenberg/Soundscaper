/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import type { HelperJobRequest } from '../desktop/helper-supervisor.ts';
import { FramescaperNativeProjectAuthority } from '../desktop/native-services-project-authority.ts';
import { FramescaperNativeSelectedV20ProjectAuthority } from '../desktop/native-services-selected-v20-project-authority.ts';
import {
	authenticateNativeProjectPlanBodies,
	authenticateNativeProjectTimingBodies,
	type NativeProjectMediaBody,
} from '../desktop/native-services-video-timing-staging.ts';
import type { HelperDataPlaneTransferPort } from '../desktop/helper-data-plane-transfer.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';
import { nativeQueueSmallStaticPlanV8 } from './helpers/native-queue-plan-fixture.ts';

test('carrierless V8 project preparation authenticates originals without a derived stage', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'framescaper-v8-project-stage-'));
	try {
		const scratchRoot = join(fixtureRoot, 'scratch');
		const outputRoot = join(fixtureRoot, 'output');
		await mkdir(outputRoot);
		const sourceBytes = Buffer.from('selected V20 V8 exact original');
		const sourceSha256 = digest(sourceBytes);
		const plan = nativeQueueSmallStaticPlanV8();
		const body = Object.freeze({
			kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
			sourceId: 'source-1', storageKey: 'source-1', mimeType: 'video/mp4',
			byteLength: sourceBytes.byteLength, sha256: sourceSha256,
		});
		const record = createNativeQueueRecordV2({
			jobId: '8'.repeat(40), taskKind: 'encoded-export', plan,
			projectId: 'v8-project', projectRevision: 1,
			inputFingerprints: [{ sourceId: body.sourceId, sha256: body.sha256 }],
			rootGrantId: '9'.repeat(32), relativeDestination: 'v8.mp4',
			reservations: {
				cpuCores: 1, processTreeRssBytes: 128 * 1_024 * 1_024,
				scratchBytes: 32 * 1_024 * 1_024, minimumFreeBytes: 0, hardwareBackend: null,
			},
			position: 0, createdAtMs: 1,
		});
		const rootGrant = Object.freeze({
			grantId: record.rootGrantId, rootPath: outputRoot,
			volumeIdentity: 'volume-v8', directoryIdentity: 'directory-v8',
			authorizedAtMs: 1, revokedAtMs: null,
		});
		const executablePath = join(fixtureRoot, 'framescaper-media-host');
		const executableBytes = Buffer.from('authenticated media host');
		await writeFile(executablePath, executableBytes, { mode: 0o700 });
		const executableIdentity = await identity(executablePath);
		const channels: Port[][] = [];
		const bodyReads: string[] = [];
		const base = new FramescaperNativeProjectAuthority({
			project: {
				projectState: () => Object.freeze({ open: true, writable: true }),
				projectRecord: () => Object.freeze({
					projectId: record.projectId, projectRevision: record.projectRevision,
					projectSha256: 'a'.repeat(64), bodies: Object.freeze([body]),
				}),
				readProjectBundle: async () => ({
					project: { projectRevision: record.projectRevision, sha256: 'a'.repeat(64) },
					document: '{}', bodies: [body],
				}),
				readBody: async () => { bodyReads.push(body.sourceId); return sourceBytes; },
			},
			scratchRoot,
			executable: () => Object.freeze({
				path: executablePath, byteLength: executableBytes.byteLength,
				sha256: digest(executableBytes), identity: executableIdentity,
			}),
			createMessageChannel: () => {
				const pair = portPair(); channels.push([...pair]);
				return { hostPort: pair[0], helperPort: pair[1] };
			},
			probeRoot: async () => Object.freeze({
				exists: true, directory: true, symbolicLink: false, canonicalPath: outputRoot,
				volumeIdentity: rootGrant.volumeIdentity, directoryIdentity: rootGrant.directoryIdentity,
			}),
			publicationPortFor: () => { throw new Error('publication is outside this staging test'); },
			publicationFenceFor: () => { throw new Error('publication is outside this staging test'); },
			reserveScratch: () => undefined, settleScratch: async () => undefined,
			scratchMatches: () => true, licensingCleared: () => true,
		});
		const renderInputCalls: string[] = [];
		const authority = new FramescaperNativeSelectedV20ProjectAuthority({
			project: base,
			renderInputs: {
				revalidate: async () => { renderInputCalls.push('revalidate'); return false; },
				inspect: async () => { renderInputCalls.push('inspect'); throw new Error('no V8 stage'); },
				settle: async () => { renderInputCalls.push('settle'); },
			},
		});
		assert.equal((await authority.revalidate(record, rootGrant, true)).inputFingerprintsMatch, true);
		const prepared = await authority.prepare(record, rootGrant);
		assert.deepEqual(renderInputCalls, []);
		const request = prepared.request as HelperJobRequest<'media-render'>;
		assert.deepEqual(request.grant.sources.map((sourceGrant) => {
			if (sourceGrant.type !== 'file') throw new Error('V8 originals must use exact file grants.');
			return { type: sourceGrant.type, role: sourceGrant.role, sha256: sourceGrant.sha256 };
		}), [{ type: 'file', role: 'original', sha256: sourceSha256 }]);
		assert.deepEqual(bodyReads, ['source-1']);
		await prepared.cleanup?.('cancelled');
		for (const pair of channels) pair.forEach((port) => port.close());
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true });
	}
});

test('VFR queue preparation stages exact project timing bodies and mints dedicated helper grants', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-vfr-project-stage-'));
	try {
		const scratchRoot = join(root, 'scratch');
		const outputRoot = join(root, 'output');
		await mkdir(outputRoot);
		const sourceBytes = Buffer.from('authenticated project video source');
		const sourceSha256 = digest(sourceBytes);
		const fixture = unifiedExactVfrPlanFixture(12, sourceSha256);
		const executablePath = join(root, 'framescaper-media-host');
		const executableBytes = Buffer.from('authenticated media host');
		await writeFile(executablePath, executableBytes, { mode: 0o700 });
		const executableIdentity = await identity(executablePath);
		const original = Object.freeze({
			kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
			sourceId: 'vfr-source', storageKey: 'vfr-source', mimeType: 'video/mp4',
			byteLength: sourceBytes.byteLength, sha256: sourceSha256,
		});
		const timing = Object.freeze({
			kind: 'video-timing' as const, encoding: fixture.publication.reference.encoding,
			sourceId: fixture.publication.reference.storageKey,
			storageKey: fixture.publication.reference.storageKey,
			mimeType: 'application/vnd.soundscaper.video-timing',
			byteLength: fixture.publication.bytes.byteLength,
			sha256: fixture.publication.reference.sha256,
		});
		const bodies = Object.freeze([original, timing]);
		const record = createNativeQueueRecordV2({
			jobId: '1'.repeat(40), taskKind: 'encoded-export', plan: fixture.plan,
			timingSidecars: fixture.timingSidecars,
			projectId: 'vfr-project', projectRevision: 1,
			inputFingerprints: [{ sourceId: original.sourceId, sha256: original.sha256 }],
			rootGrantId: '2'.repeat(32), relativeDestination: 'vfr.mp4',
			reservations: {
				cpuCores: 1, processTreeRssBytes: 128 * 1_024 * 1_024,
				scratchBytes: 32 * 1_024 * 1_024, minimumFreeBytes: 0, hardwareBackend: null,
			},
			position: 0, createdAtMs: 1,
		});
		const rootGrant = Object.freeze({
			grantId: record.rootGrantId, rootPath: outputRoot,
			volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
			authorizedAtMs: 1, revokedAtMs: null,
		});
		const channels: Port[][] = [];
		const settlements: string[] = [];
		const bodyReadOrder: string[] = [];
		let readsInFlight = 0;
		let maximumReadsInFlight = 0;
		const authority = new FramescaperNativeProjectAuthority({
			project: {
				projectState: () => Object.freeze({ open: true, writable: true }),
				projectRecord: () => Object.freeze({
					projectId: 'vfr-project', projectRevision: 1,
					projectSha256: '3'.repeat(64), bodies,
				}),
				readProjectBundle: async () => ({
					project: { projectRevision: 1, sha256: '3'.repeat(64) },
					document: JSON.stringify({ sources: [] }), bodies,
				}),
				readBody: async (bodyValue) => {
					const body = bodyValue as { kind: string };
					bodyReadOrder.push(body.kind);
					readsInFlight += 1;
					maximumReadsInFlight = Math.max(maximumReadsInFlight, readsInFlight);
					await Promise.resolve();
					readsInFlight -= 1;
					return body.kind === 'video-timing' ? fixture.publication.bytes : sourceBytes;
				},
			},
			scratchRoot,
			executable: () => Object.freeze({
				path: executablePath, byteLength: executableBytes.byteLength,
				sha256: digest(executableBytes), identity: executableIdentity,
			}),
			createMessageChannel: () => {
				const pair = portPair();
				channels.push([...pair]);
				return { hostPort: pair[0], helperPort: pair[1] };
			},
			probeRoot: async () => Object.freeze({
				exists: true, directory: true, symbolicLink: false,
				canonicalPath: outputRoot, volumeIdentity: rootGrant.volumeIdentity,
				directoryIdentity: rootGrant.directoryIdentity,
			}),
			publicationPortFor: () => { throw new Error('publication is outside this staging test'); },
			publicationFenceFor: () => { throw new Error('publication is outside this staging test'); },
			reserveScratch: () => undefined,
			settleScratch: async (_jobId, outcome) => { settlements.push(outcome); },
			scratchMatches: () => true,
			licensingCleared: () => true,
		});
		assert.equal((await authority.revalidate(record, rootGrant, true)).inputFingerprintsMatch, true);
		const prepared = await authority.prepare(record, rootGrant);
		const grant = prepared.request.grant as unknown as {
			videoTimingAssets: readonly [{ path: string; bytes: number; sha256: string; role: string }];
		};
		assert.deepEqual(grant.videoTimingAssets.map(({ bytes, sha256, role }) => ({ bytes, sha256, role })), [{
			bytes: timing.byteLength, sha256: timing.sha256, role: 'video-timing',
		}]);
		assert.deepEqual(await readFile(grant.videoTimingAssets[0].path), Buffer.from(fixture.publication.bytes));
		assert.deepEqual(bodyReadOrder, ['video-timing', 'video-original']);
		assert.equal(maximumReadsInFlight, 1, 'project bodies are read and authenticated sequentially');
		assert.equal(record.planPayload.includes('presentationTicks'), false);
		assert.equal(prepared.request.dataPlaneTransfers?.length, 1, 'SCTI remains a file grant, not control or plan bytes');
		await prepared.cleanup?.('cancelled');
		assert.deepEqual(settlements, ['cancelled']);
		for (const pair of channels) pair.forEach((port) => port.close());
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('project timing-body resolution rejects missing and digest-drifted SCTI authority', async () => {
	const sourceBytes = Buffer.from('timing body hostile fixture source');
	const fixture = unifiedExactVfrPlanFixture(9, digest(sourceBytes));
	const original = {
		kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
		sourceId: 'vfr-source', storageKey: 'vfr-source', mimeType: 'video/mp4',
		byteLength: sourceBytes.byteLength, sha256: digest(sourceBytes),
	};
	const timing = {
		kind: 'video-timing' as const, encoding: fixture.publication.reference.encoding,
		sourceId: fixture.publication.reference.storageKey,
		storageKey: fixture.publication.reference.storageKey,
		mimeType: 'application/vnd.soundscaper.video-timing',
		byteLength: fixture.publication.bytes.byteLength,
		sha256: fixture.publication.reference.sha256,
	};
	const request = {
		plan: fixture.plan,
		inputFingerprints: [{ sourceId: original.sourceId, sha256: original.sha256 }],
		bodies: [original, timing],
		readBody: async (body: Readonly<NativeProjectMediaBody>) => (
			body.kind === 'video-timing' ? fixture.publication.bytes : sourceBytes
		),
		maximumStagedBytes: 32 * 1_024 * 1_024,
	};
	let refusedReadCount = 0;
	await assert.rejects(
		authenticateNativeProjectPlanBodies({
			...request,
			maximumStagedBytes: 1,
			readBody: async (body) => {
				refusedReadCount += 1;
				return request.readBody(body);
			},
		}),
		/scratch reservation/iu,
	);
	assert.equal(refusedReadCount, 0, 'metadata overflow is refused before reading a project body');
	let refusedTimingReadCount = 0;
	await assert.rejects(
		authenticateNativeProjectTimingBodies({
			plan: request.plan,
			bodies: [timing],
			maximumStagedBytes: 1,
			readBody: async (body) => {
				refusedTimingReadCount += 1;
				return request.readBody(body);
			},
		}),
		/scratch reservation/iu,
	);
	assert.equal(refusedTimingReadCount, 0, 'timing-only metadata overflow is refused before a body read');
	await assert.rejects(
		authenticateNativeProjectPlanBodies({ ...request, bodies: [original] }),
		/no unique exact video-timing project body/iu,
	);
	const tampered = fixture.publication.bytes.slice();
	tampered[tampered.length - 1] ^= 0xff;
	await assert.rejects(
		authenticateNativeProjectPlanBodies({
			...request,
			readBody: async (body) => body.kind === 'video-timing' ? tampered : sourceBytes,
		}),
		/changed|digest|binding/iu,
	);
});

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function identity(path: string) {
	const value = await stat(path);
	return Object.freeze({ dev: value.dev, ino: value.ino });
}

class Port extends EventEmitter implements HelperDataPlaneIoPort, HelperDataPlaneTransferPort {
	peer: Port | null = null;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.emit('message', { data: message })); }
	start(): void {}
	close(): void { this.removeAllListeners(); }
}

function portPair(): readonly [Port, Port] {
	const left = new Port();
	const right = new Port();
	left.peer = right;
	right.peer = left;
	return [left, right];
}
