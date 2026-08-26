/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const JOB_ID = 'ab'.repeat(20);

test('the public v1 bridge exposes a pathless, frozen native-services snapshot', async () => {
	const fixture = await loadPreload([capabilitySnapshot(), snapshot()]);
	assert.equal(Object.isFrozen(fixture.bridge.nativeServices), true);
	const capabilities = await fixture.bridge.nativeServices.capabilities();
	assert.equal(capabilities.entries.length, 6);
	assert.equal(capabilities.entries.every((entry) => Object.isFrozen(entry)), true);
	assert.equal(capabilities.entries.some((entry) => 'secretPath' in entry), false);
	const result = await fixture.bridge.nativeServices.snapshot();
	assert.deepEqual({ ...result }, {
		snapshotVersion: 1,
		runtimeAvailable: false,
		nativeMediaEnabled: false,
		queue: result.queue,
		roots: result.roots,
		watchRules: result.watchRules,
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.queue), true);
	assert.equal('secretPath' in result, false);
	assert.equal('rootPath' in result.roots[0], false);
	assert.deepEqual(fixture.invocations, [
		['framescaper:v1:native-services:capabilities', undefined],
		['framescaper:v1:native-services:snapshot', undefined],
	]);
});

test('hostile native capability snapshots never become renderer state', async () => {
	const malformed = capabilitySnapshot();
	malformed.entries[0].secretPath = '/tmp/native-host';
	const fixture = await loadPreload([malformed]);
	await assert.rejects(() => fixture.bridge.nativeServices.capabilities(), /capability entry|fields/iu);
});

test('OpenFX frame offers preserve the exact renderer request capability nonce', async () => {
	const requestNonce = '31'.repeat(20);
	const sessionId = '42'.repeat(20);
	const fixture = await loadPreload([{ protocolVersion: 1, sessionId, requestNonce }]);
	const request = openFxFrameRequest(requestNonce);
	assert.deepEqual({ ...await fixture.bridge.nativeServices.openOpenFxFrameSession(request) }, {
		protocolVersion: 1, sessionId, requestNonce,
	});
	assert.throws(() => fixture.bridge.nativeServices.openOpenFxFrameSession({
		...request, planPayload: 'x'.repeat(16 * 1024 * 1024 + 1),
	}), /OpenFX frame|plan|bound/iu);
	assert.equal(fixture.invocations.length, 1);
	const missing = await loadPreload([{ protocolVersion: 1, sessionId }]);
	await assert.rejects(() => missing.bridge.nativeServices.openOpenFxFrameSession(request),
		/frame offer|requestNonce|fields/iu);
	const forged = await loadPreload([{
		protocolVersion: 1, sessionId, requestNonce, path: '/private/frame.rgba',
	}]);
	await assert.rejects(() => forged.bridge.nativeServices.openOpenFxFrameSession(request),
		/frame offer|fields/iu);
});

test('queue controls are exact in both directions and reject malformed requests before IPC', async () => {
	const projection = snapshot().queue[0];
	const fixture = await loadPreload([projection, [projection], true]);
	const controlled = await fixture.bridge.nativeServices.control({ jobId: JOB_ID, action: 'cancel' });
	assert.equal(controlled.jobId, JOB_ID);
	const reordered = await fixture.bridge.nativeServices.reorder({ jobId: JOB_ID, index: 0 });
	assert.equal(reordered.length, 1);
	assert.equal(await fixture.bridge.nativeServices.remove({ jobId: JOB_ID }), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, request && { ...request }]), [
		['framescaper:v1:native-services:queue:control', { jobId: JOB_ID, action: 'cancel' }],
		['framescaper:v1:native-services:queue:reorder', { jobId: JOB_ID, index: 0 }],
		['framescaper:v1:native-services:queue:remove', { jobId: JOB_ID }],
	]);
	for (const request of [
		{ jobId: 'short', action: 'cancel' },
		{ jobId: JOB_ID, action: 'dispatch' },
		{ jobId: JOB_ID, action: 'cancel', path: '/tmp/leak' },
	]) assert.throws(() => fixture.bridge.nativeServices.control(request), /native queue|job id|fields|opaque identifier/iu);
	assert.throws(() => fixture.bridge.nativeServices.reorder({ jobId: JOB_ID, index: -1 }), /index|non-negative safe integer/iu);
	assert.equal(fixture.invocations.length, 3);
});

test('queue enqueue accepts only a bounded exact-plan declaration', async () => {
	const projection = snapshot().queue[0];
	const fixture = await loadPreload(Array.from({ length: 7 }, () => projection));
	const request = {
		taskKind: 'encoded-export', planVersion: 7, derivedInputStageId: JOB_ID,
		planFingerprint: '12'.repeat(32),
		planPayload: '{"version":7}', projectId: 'project-1', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '34'.repeat(32) }],
		rootGrantId: 'cd'.repeat(8), relativeDestination: 'exports/programme.mov',
		reservations: { cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 2048,
			minimumFreeBytes: 0, hardwareBackend: null }, recoveryClass: 'atomic-restart',
	};
	assert.equal((await fixture.bridge.nativeServices.enqueue(request)).jobId, JOB_ID);
	assert.equal((await fixture.bridge.nativeServices.enqueue({
		...request, planVersion: 8,
		planPayload: '{"version":8,"inputs":[{"kind":"staged-audio-mix"}]}',
	})).jobId, JOB_ID);
	assert.equal((await fixture.bridge.nativeServices.enqueue({
		...request, planVersion: 8, derivedInputStageId: null,
		planPayload: '{"version":8,"inputs":[]}',
	})).jobId, JOB_ID);
	assert.equal(fixture.invocations[0][0], 'framescaper:v1:native-services:queue:enqueue');
	assert.throws(() => fixture.bridge.nativeServices.enqueue({ ...request, planVersion: 6 }), /enqueue plan/iu);
	for (const planVersion of [9, 10, 11, 12]) assert.equal((await fixture.bridge.nativeServices.enqueue({
		...request, planVersion, derivedInputStageId: null,
		planPayload: `{"version":${String(planVersion)}}`,
	})).jobId, JOB_ID);
	assert.throws(() => fixture.bridge.nativeServices.enqueue({
		...request, planVersion: 12, derivedInputStageId: JOB_ID, planPayload: '{"version":12}',
	}), /unified|derived-input stage|carrier/iu);
	assert.throws(() => fixture.bridge.nativeServices.enqueue({ ...request, state: 'running' }), /fields/iu);
	assert.throws(() => fixture.bridge.nativeServices.enqueue({
		...request, planVersion: 8, derivedInputStageId: null,
		planPayload: '{"version":8,"inputs":[{"kind":"staged-audio-mix"}]}',
	}), /derived-input stage|audio/iu);
	assert.equal(fixture.invocations.length, 7);
});

test('V8 audio-only input crosses preload through one digest-bound backpressured MessagePort', async () => {
	const bytes = new Blob([new Uint8Array([1, 2, 3, 4])]);
	const sha256 = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
	const binding = {
		dataPlaneVersion: 1, transport: 'message-port', streamId: '56'.repeat(20),
		direction: 'host-to-helper', byteLength: bytes.size, sha256,
		maximumChunkBytes: 2, maximumInFlightChunks: 1,
	};
	const fixture = await loadPreload([{
		stageVersion: 1, stageId: JOB_ID,
		inputs: [{ inputIndex: 0, role: 'staged-audio-mix', binding }],
	}, { stageId: JOB_ID }]);
	const result = await fixture.bridge.nativeServices.stageRenderInputs({
		stageVersion: 1, planVersion: 8, planFingerprint: '12'.repeat(32),
		planPayload: '{"version":8,"inputs":[{"kind":"staged-audio-mix"}]}',
		projectId: 'project-1', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '34'.repeat(32) }],
		derivedInputs: [{ role: 'staged-audio-mix', byteLength: bytes.size, sha256, bytes }],
	});
	assert.equal(result.stageId, JOB_ID);
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'framescaper:v1:native-services:render-inputs:begin',
		'framescaper:v1:native-services:render-inputs:port',
		'framescaper:v1:native-services:render-inputs:finalize',
	]);
	await assert.rejects(() => fixture.bridge.nativeServices.stageRenderInputs({
		stageVersion: 1, planVersion: 8, planFingerprint: '12'.repeat(32),
		planPayload: '{"version":8,"inputs":[{"kind":"staged-audio-mix"}]}',
		projectId: 'project-1', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '34'.repeat(32) }],
		derivedInputs: [{ role: 'evaluated-rgba-frame-pack', byteLength: bytes.size, sha256, bytes }],
	}), /role|audio|derived.*input/iu);
});

test('failed V7 staging preserves the primary transfer error while reporting abandon failure', async () => {
	const bytes = new Blob([Uint8Array.of(1, 2, 3)]);
	const sha256 = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
	const fixture = await loadPreload([{
		stageVersion: 1, stageId: JOB_ID,
		inputs: [{ inputIndex: 0, role: 'evaluated-rgba-frame-pack', binding: {
			dataPlaneVersion: 1, transport: 'message-port', streamId: '56'.repeat(20),
			direction: 'host-to-helper', byteLength: bytes.size + 1, sha256,
			maximumChunkBytes: 2, maximumInFlightChunks: 1,
		} }],
	}, false]);
	await assert.rejects(() => fixture.bridge.nativeServices.stageRenderInputs({
		stageVersion: 1, planVersion: 7, planFingerprint: '12'.repeat(32),
		planPayload: '{"version":7}', projectId: 'project-1', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '34'.repeat(32) }],
		derivedInputs: [{ role: 'evaluated-rgba-frame-pack', byteLength: bytes.size, sha256, bytes }],
	}), (error) => {
		assert.equal(error?.name, 'AggregateError');
		assert.equal(error.cause, error.errors[0]);
		assert.match(error.cause.message, /bytes changed/iu);
		assert.match(error.errors[1].message, /abandonment.*acknowledged/iu);
		return true;
	});
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'framescaper:v1:native-services:render-inputs:begin',
		'framescaper:v1:native-services:render-inputs:abandon',
	]);
});

test('the preload exposes only a pathless exact V7 stage-abandon request', async () => {
	const fixture = await loadPreload([true]);
	assert.equal(await fixture.bridge.nativeServices.abandonRenderInputs({ stageId: JOB_ID }), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, { ...request }]), [[
		'framescaper:v1:native-services:render-inputs:abandon', { stageId: JOB_ID },
	]]);
	await assert.rejects(() => fixture.bridge.nativeServices.abandonRenderInputs({
		stageId: JOB_ID, path: '/tmp/private-stage',
	}), /fields/iu);
	assert.equal(fixture.invocations.length, 1);
});

test('malformed main responses never become renderer state', async () => {
	const malformed = snapshot();
	malformed.queue[0].relativeDestination = '../escape.mov';
	const fixture = await loadPreload([malformed]);
	await assert.rejects(() => fixture.bridge.nativeServices.snapshot(), /destination|projection/iu);
});

test('checkpoint control envelopes over 64 KiB are refused before IPC', async () => {
	const fixture = await loadPreload([]);
	const manifest = Array.from({ length: 100 }, (_, frameIndex) => ({
		frameIndex, relativePath: `frames/${'a'.repeat(700)}-${String(frameIndex)}.png`,
		byteLength: 1, sha256: '12'.repeat(32), planFingerprint: '34'.repeat(32),
		sourceInventoryDigest: '56'.repeat(32),
	}));
	assert.throws(() => fixture.bridge.nativeServices.checkpoint({
		jobId: JOB_ID, sourceInventoryDigest: '56'.repeat(32),
		plannedFrameCount: manifest.length, manifest,
	}), /64 KiB|control|checkpoint/iu);
	assert.equal(fixture.invocations.length, 0);
});

test('watch mutation crosses preload only as an exact pathless claim and completion', async () => {
	const claim = {
		claimId: '12'.repeat(16), projectId: 'project-1', projectRevision: 7,
		importMode: 'link', locatorId: '34'.repeat(16), locatorRevision: '56'.repeat(16),
		name: 'clip.mp4', size: 4, mimeType: 'video/mp4', lastModified: 8,
		contentSha256: '78'.repeat(32),
	};
	const fixture = await loadPreload([claim, true]);
	const result = await fixture.bridge.nativeServices.claimWatchImport({
		projectId: 'project-1', projectRevision: 7,
	});
	assert.deepEqual({ ...result }, claim);
	assert.equal(Object.hasOwn(result, 'path'), false);
	assert.equal(await fixture.bridge.nativeServices.completeWatchImport({
		claimId: claim.claimId, projectId: claim.projectId,
		expectedProjectRevision: 7, committedProjectRevision: 8, success: true,
	}), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, { ...request }]), [
		['framescaper:v1:native-services:watch:claim', { projectId: 'project-1', projectRevision: 7 }],
		['framescaper:v1:native-services:watch:complete', {
			claimId: claim.claimId, projectId: 'project-1', expectedProjectRevision: 7,
			committedProjectRevision: 8, success: true,
		}],
	]);
	assert.throws(() => fixture.bridge.nativeServices.claimWatchImport({
		projectId: 'project-1', projectRevision: 7, path: '/tmp/private.mp4',
	}), /fields/iu);
	const hostile = await loadPreload([{ ...claim, path: '/tmp/private.mp4' }]);
	await assert.rejects(() => hostile.bridge.nativeServices.claimWatchImport({
		projectId: 'project-1', projectRevision: 7,
	}), /fields/iu);
});

for (const projectSchemaVersion of [28, 31]) test(`selected F${String(projectSchemaVersion)} watch mutation preserves exact target, source, and digest authority`, async () => {
	const claim = {
		claimId: '12'.repeat(16), projectId: `project-${String(projectSchemaVersion)}`, projectRevision: 3,
		projectSchemaVersion, binId: 'project-bin', generateProxies: true,
		existingSourceId: null, importMode: 'link', locatorId: '34'.repeat(16),
		locatorRevision: '56'.repeat(16), name: 'clip.mp4', size: 4,
		mimeType: 'video/mp4', lastModified: 8, contentSha256: '78'.repeat(32),
	};
	const completion = {
		claimId: claim.claimId, projectId: claim.projectId, projectSchemaVersion,
		binId: 'project-bin', sourceId: `source-${String(projectSchemaVersion)}`, contentSha256: claim.contentSha256,
		expectedProjectRevision: 3, committedProjectRevision: 5, success: true,
	};
	const fixture = await loadPreload([claim, true]);
	assert.deepEqual({ ...await fixture.bridge.nativeServices.claimWatchImport({
		projectId: claim.projectId, projectRevision: 3,
	}) }, claim);
	assert.equal(await fixture.bridge.nativeServices.completeWatchImport(completion), true);
	assert.equal(JSON.stringify(fixture.invocations).includes('/private'), false);
	assert.deepEqual({ ...fixture.invocations[1][1] }, completion);
	const hostile = await loadPreload([{ ...claim, path: '/private/clip.mp4' }]);
	await assert.rejects(() => hostile.bridge.nativeServices.claimWatchImport({
		projectId: 'project-28', projectRevision: 3,
	}), /fields/iu);
	assert.throws(() => fixture.bridge.nativeServices.completeWatchImport({
		...completion, binId: 'another-bin',
	}), /selected|completion/iu);
});

test('image-sequence selection crosses preload only as opaque files and exact ranges', async () => {
	const selection = {
		selectionId: '9a'.repeat(20),
		files: [{ fileId: '8b'.repeat(20), name: 'shot.0001.png', byteLength: 3 }],
	};
	const fixture = await loadPreload([selection, Uint8Array.of(1, 2, 3), true]);
	const selected = await fixture.bridge.nativeServices.selectImageSequence();
	assert.deepEqual(JSON.parse(JSON.stringify(selected)), selection);
	assert.equal(JSON.stringify(selected).includes('/'), false);
	assert.deepEqual([...await fixture.bridge.nativeServices.readImageSequenceFile({
		selectionId: selection.selectionId, fileId: selection.files[0].fileId,
		offset: 0, length: 3,
	})], [1, 2, 3]);
	assert.equal(await fixture.bridge.nativeServices.releaseImageSequence({
		selectionId: selection.selectionId,
	}), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, request && { ...request }]), [
		['framescaper:v1:native-services:image-sequence:select', {}],
		['framescaper:v1:native-services:image-sequence:read', {
			selectionId: selection.selectionId, fileId: selection.files[0].fileId,
			offset: 0, length: 3,
		}],
		['framescaper:v1:native-services:image-sequence:release', {
			selectionId: selection.selectionId,
		}],
	]);
	const hostile = await loadPreload([{ ...selection, path: '/private/shot.0001.png' }]);
	await assert.rejects(() => hostile.bridge.nativeServices.selectImageSequence(), /selection|fields/iu);
});

test('completed native proxy output crosses preload only as an authenticated range claim', async () => {
	const claim = {
		claimId: '7b'.repeat(20), byteLength: 3,
		sha256: createHash('sha256').update(Uint8Array.of(1, 2, 3)).digest('hex'),
		mimeType: 'video/quicktime',
	};
	const fixture = await loadPreload([claim, Uint8Array.of(1, 2, 3), true]);
	assert.deepEqual({ ...await fixture.bridge.nativeServices.claimProxyOutput({ jobId: JOB_ID }) }, claim);
	assert.deepEqual([...await fixture.bridge.nativeServices.readProxyOutput({
		claimId: claim.claimId, offset: 0, length: 3,
	})], [1, 2, 3]);
	assert.equal(await fixture.bridge.nativeServices.releaseProxyOutput({ claimId: claim.claimId }), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, { ...request }]), [
		['framescaper:v1:native-services:proxy-output:claim', { jobId: JOB_ID }],
		['framescaper:v1:native-services:proxy-output:read', {
			claimId: claim.claimId, offset: 0, length: 3,
		}],
		['framescaper:v1:native-services:proxy-output:release', { claimId: claim.claimId }],
	]);
	assert.throws(() => fixture.bridge.nativeServices.readProxyOutput({
		claimId: claim.claimId, offset: 0, length: 1024 * 1024 + 1,
	}), /range/iu);
	const hostile = await loadPreload([{ ...claim, path: '/private/proxy.mov' }]);
	await assert.rejects(() => hostile.bridge.nativeServices.claimProxyOutput({ jobId: JOB_ID }), /fields/iu);
});

test('image-sequence publication uses exact control and a digest-bound pathless data plane', async () => {
	const transactionId = '7a'.repeat(20);
	const bytes = Uint8Array.of(1, 2, 3);
	const fixture = await loadPreload([
		{ operation: 'begun', transactionId },
		{ operation: 'write-prepared' },
		{ operation: 'written', transactionId, asset: 'pack', offset: 3 },
		bytes,
	]);
	assert.deepEqual(await fixture.bridge.nativeServices.imageSequenceImport({
		operation: 'begin', candidateGeneration: 28,
		projectId: 'project-1', projectRevision: 4,
	}), { operation: 'begun', transactionId });
	assert.deepEqual(await fixture.bridge.nativeServices.writeImageSequenceImportChunk({
		transactionId, asset: 'pack', offset: 0, bytes,
	}), { operation: 'written', transactionId, asset: 'pack', offset: 3 });
	assert.deepEqual([...await fixture.bridge.nativeServices.readImageSequenceImportBody({
		transactionId, asset: 'pack', offset: 0, length: 3,
	})], [1, 2, 3]);
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'framescaper:v1:native-services:image-sequence:import',
		'framescaper:v1:native-services:image-sequence:import',
		'framescaper:v1:native-services:image-sequence:import-port',
		'framescaper:v1:native-services:image-sequence:import',
		'framescaper:v1:native-services:image-sequence:import',
	]);
	assert.deepEqual(fixture.dataPlaneChunks, [{ sequence: 0, offset: 0, byteLength: 3 }]);
	assert.throws(() => fixture.bridge.nativeServices.imageSequenceImport({
		operation: 'discard', transactionId, path: '/private/sequence.pack',
	}), /fields|image-sequence/iu);
});

test('OpenFX scan, inventory, and control cross the public bridge without plug-in paths', async () => {
	const projection = openFxProjection();
	const fixture = await loadPreload([projection, [projection], { ...projection, state: 'enabled' }]);
	const scanned = await fixture.bridge.nativeServices.scanOpenFxPlugin();
	assert.equal(scanned.pluginId, projection.pluginId);
	assert.equal(JSON.stringify(scanned).includes('/'), false);
	assert.equal((await fixture.bridge.nativeServices.listOpenFxPlugins()).length, 1);
	assert.equal((await fixture.bridge.nativeServices.controlOpenFxPlugin({
		pluginHandle: projection.pluginHandle, action: 'enable',
	})).state, 'enabled');
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, request && { ...request }]), [
		['framescaper:v1:native-services:openfx:scan', undefined],
		['framescaper:v1:native-services:openfx:inventory', undefined],
		['framescaper:v1:native-services:openfx:control', {
			pluginHandle: projection.pluginHandle, action: 'enable',
		}],
	]);
	assert.throws(() => fixture.bridge.nativeServices.controlOpenFxPlugin({
		pluginHandle: projection.pluginHandle, action: 'enable', path: '/private/plugin.ofx',
	}), /fields|control request/iu);
	const hostile = await loadPreload([{ ...projection, path: '/private/plugin.ofx' }]);
	await assert.rejects(() => hostile.bridge.nativeServices.scanOpenFxPlugin(), /fields|projection/iu);
});

test('default-off native preferences cross only the authenticated pathless bridge', async () => {
	const preferences = {
		nativeMediaEnabled: false, hardwareDecodeEnabled: false,
		hardwareEncodeEnabled: false, ofxConsentEnabled: false,
	};
	const fixture = await loadPreload([preferences, true]);
	assert.deepEqual({ ...await fixture.bridge.nativeServices.preferences() }, preferences);
	assert.equal(await fixture.bridge.nativeServices.setPreference({
		preference: 'hardware-decode', enabled: true,
	}), true);
	assert.deepEqual(fixture.invocations.map(([channel, request]) => [channel, request && { ...request }]), [
		['framescaper:v1:native-services:preferences', undefined],
		['framescaper:v1:native-services:preferences:set', {
			preference: 'hardware-decode', enabled: true,
		}],
	]);
	assert.throws(() => fixture.bridge.nativeServices.setPreference({
		preference: 'unknown', enabled: true,
	}), /preference/iu);
});

test('root, watch, scratch, publication, checkpoint, and display lifecycle stay pathless', async () => {
	const root = { grantId: 'cd'.repeat(8), displayName: 'Exports', revoked: false };
	const watch = {
		ruleId: 'ef'.repeat(8), grantId: root.grantId, projectId: 'project-1',
		binId: null,
		extensions: ['mov'], importMode: 'link', generateProxies: false, enabled: true,
	};
	const display = {
		displays: [{ displayId: 'display-2', label: 'Client monitor', primary: false,
			width: 1920, height: 1080, hdrCapable: false, colorManaged: true }],
		activeDisplayId: null,
	};
	const fixture = await loadPreload([
		root, snapshot().queue[0], true, true, watch, { ...watch, enabled: false }, true, snapshot(), [JOB_ID], 'released',
		{ outcome: 'published', relativeDestination: 'exports/programme.mov', byteLength: 12, sha256: '12'.repeat(32) },
		{ verifiedFrameCount: 1, plannedFrameCount: 1, complete: true },
		display, { ...display, activeDisplayId: 'display-2' }, { ...display, activeDisplayId: 'display-2' },
	]);
	assert.equal((await fixture.bridge.nativeServices.selectRoot()).grantId, root.grantId);
	assert.equal((await fixture.bridge.nativeServices.reauthorizeQueueRoot({ jobId: JOB_ID })).jobId, JOB_ID);
	assert.equal(await fixture.bridge.nativeServices.revalidateRoot({ grantId: root.grantId }), true);
	assert.equal(await fixture.bridge.nativeServices.revokeRoot({ grantId: root.grantId }), true);
	assert.equal((await fixture.bridge.nativeServices.createWatch({ grantId: root.grantId, projectId: 'project-1',
		binId: null, extensions: ['mov'], importMode: 'link', generateProxies: false })).ruleId, watch.ruleId);
	assert.equal((await fixture.bridge.nativeServices.setWatchEnabled({ ruleId: watch.ruleId, enabled: false })).enabled, false);
	assert.equal(await fixture.bridge.nativeServices.removeWatch({ ruleId: watch.ruleId }), true);
	await fixture.bridge.nativeServices.reconcileWatch();
	assert.deepEqual([...(await fixture.bridge.nativeServices.cleanupScratch())], [JOB_ID]);
	assert.equal(await fixture.bridge.nativeServices.settleScratch({ jobId: JOB_ID }), 'released');
	await fixture.bridge.nativeServices.publish({ jobId: JOB_ID, currentPlanFingerprint: '34'.repeat(32),
		finalized: true, declaredByteLength: 12, declaredSha256: '12'.repeat(32) });
	await fixture.bridge.nativeServices.checkpoint({ jobId: JOB_ID, sourceInventoryDigest: '56'.repeat(32),
		plannedFrameCount: 0, manifest: [] });
	assert.equal((await fixture.bridge.nativeServices.externalDisplays()).displays[0].displayId, 'display-2');
	await fixture.bridge.nativeServices.setExternalDisplay({ displayId: 'display-2' });
	const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
	await fixture.bridge.nativeServices.presentExternalDisplay({ sequence: 0,
		evaluationFingerprint: '78'.repeat(32), width: 2, height: 1, dynamicRange: 'sdr',
		rgbaSha256: createHash('sha256').update(rgba).digest('hex'), rgba });
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'framescaper:v1:native-services:root:select', 'framescaper:v1:native-services:queue:reauthorize-root',
		'framescaper:v1:native-services:root:revalidate',
		'framescaper:v1:native-services:root:revoke', 'framescaper:v1:native-services:watch:create',
		'framescaper:v1:native-services:watch:enabled', 'framescaper:v1:native-services:watch:remove',
		'framescaper:v1:native-services:watch:reconcile', 'framescaper:v1:native-services:scratch:cleanup',
		'framescaper:v1:native-services:scratch:settle', 'framescaper:v1:native-services:publication:publish',
		'framescaper:v1:native-services:publication:checkpoint', 'framescaper:v1:native-services:display:list',
		'framescaper:v1:native-services:display:set', 'framescaper:v1:native-services:display:frame-port',
	]);
	assert.throws(() => fixture.bridge.nativeServices.createWatch({ grantId: root.grantId, projectId: 'project-1',
		binId: null, extensions: ['mov'], importMode: 'link', generateProxies: false, recursive: true }), /fields/iu);
	assert.throws(() => fixture.bridge.nativeServices.presentExternalDisplay({ sequence: -1 }), /frame|fields|integer/iu);
});

test('clean-display frames larger than 16 MiB are transferred as sequential bounded chunks', async () => {
	const display = { displays: [{ displayId: 'display-2', label: 'Client monitor', primary: false,
		width: 2_048, height: 2_049, hdrCapable: false, colorManaged: true }],
		activeDisplayId: 'display-2' };
	const fixture = await loadPreload([display]);
	const width = 2_048;
	const height = 2_049;
	const rgba = new Uint8Array(width * height * 4);
	await fixture.bridge.nativeServices.presentExternalDisplay({ sequence: 1,
		evaluationFingerprint: '78'.repeat(32), width, height, dynamicRange: 'sdr',
		rgbaSha256: createHash('sha256').update(rgba).digest('hex'), rgba });
	assert.deepEqual(fixture.dataPlaneChunks, [
		{ sequence: 0, offset: 0, byteLength: 16 * 1024 * 1024 },
		{ sequence: 1, offset: 16 * 1024 * 1024, byteLength: 2_048 * 4 },
	]);
});

function openFxFrameRequest(requestNonce) {
	return {
		schemaVersion: 1, planPayload: '{}', planFingerprint: '12'.repeat(32),
		instanceId: 'effect-1', outputOrdinal: 0, requestedBackend: 'cpu',
		transitionProgress: null, inputs: [], inputBinding: null, requestNonce,
	};
}

function snapshot() {
	return {
		snapshotVersion: 1,
		runtimeAvailable: false,
		nativeMediaEnabled: false,
		queue: [{
			jobId: JOB_ID,
			taskKind: 'encoded-export',
			projectId: 'project-1',
			relativeDestination: 'exports/programme.mov',
			state: 'blocked',
			position: 0,
			progress: null,
			attempt: 0,
			lastFailureCode: 'licensing-row-blocked',
		}],
		roots: [{ grantId: 'cd'.repeat(8), displayName: 'Exports', revoked: false, rootPath: '/secret' }],
		watchRules: [{
			ruleId: 'ef'.repeat(8), grantId: 'cd'.repeat(8), projectId: 'project-1',
			binId: null,
			extensions: ['mov'], importMode: 'link', generateProxies: false, enabled: true,
		}],
		secretPath: '/tmp/native-services.sqlite',
	};
}

function capabilitySnapshot() {
	const rows = [
		['queue', 'persistent-render-queue'], ['watch', 'watch-folders'],
		['codec', 'encode-mov-prores-proxy'], ['operation', 'image-sequence-import'],
		['display', 'external-display'], ['ofx', 'isolated-host'],
	];
	return {
		snapshotVersion: 1, masterEnabled: false, buildFingerprint: null,
		entries: rows.map(([domain, id]) => ({
			domain, id, state: domain === 'watch' || domain === 'display' ? 'disabled' : 'blocked-policy',
			reason: domain === 'watch' || domain === 'display' ? 'master-switch-off' : 'policy-row-blocked',
			userEnabled: false, buildFingerprint: null, detail: 'Unavailable by exact production evidence.',
		})),
	};
}

function openFxProjection() {
	return {
		pluginHandle: '8b'.repeat(20), pluginId: 'net.example.Blur', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: '9c'.repeat(32),
		supportedContexts: ['filter'],
		parameters: [{ name: 'radius', type: 'double', animates: true }],
		components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
		state: 'consented', quarantined: false,
	};
}

async function loadPreload(results) {
	let bridge;
	const invocations = [];
	const dataPlaneChunks = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, Array, ArrayBuffer, JSON, Number, Object, Promise, RangeError, String,
		TypeError, Uint8Array, URL, Blob, MessageChannel, setTimeout, clearTimeout,
		crypto: webcrypto, structuredClone,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'framescaperDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) { invocations.push([channel, value]); return Promise.resolve(results.shift()); },
				postMessage(channel, value, ports) {
					invocations.push([channel, value]);
					const port = ports[0];
					port.on('message', (message) => {
						if (message.type === 'chunk') {
							dataPlaneChunks.push({ sequence: message.sequence, offset: message.offset,
								byteLength: message.bytes.byteLength });
							port.postMessage({ dataPlaneVersion: 1, type: 'ack', streamId: message.streamId, sequence: message.sequence, receivedBytes: message.offset + message.bytes.byteLength });
						}
						else if (message.type === 'complete' && !channel.endsWith(':image-sequence:import-port')) port.postMessage({ dataPlaneVersion: 1, type: 'result', streamId: message.streamId, projection: results.shift() });
					});
					port.start();
				},
				send: () => undefined,
				on: () => undefined,
				removeListener: () => undefined,
			},
		}),
	});
	return { bridge, invocations, dataPlaneChunks };
}
