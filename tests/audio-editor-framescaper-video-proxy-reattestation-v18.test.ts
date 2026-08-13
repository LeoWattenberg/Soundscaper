/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindVideoSourceTimingView,
	boundVideoSourceTimingViewInfo,
	type BoundVideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';
import {
	createFramescaperVideoProxyReattestationAuthorityV18,
	reattestFramescaperVideoProxyAttachmentV18,
	type FramescaperVideoProxyBodyIdentityV18,
	type FramescaperVideoProxyOriginalIdentityV18,
} from '../src/framescaper/editor-video-proxy-reattestation-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	selectFramescaperVideoProxyV18,
} from '../src/framescaper/editor-video-proxy-selection-v18.ts';
import type { FramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import {
	ARCHIVE_ORIGINAL_BYTES,
	ARCHIVE_ORIGINAL_SHA,
	ARCHIVE_PROJECT_ID,
	ARCHIVE_PROXY_BYTES,
	ARCHIVE_PROXY_SHA,
	ARCHIVE_SOURCE_ID,
	ARCHIVE_TIMING,
	archiveProject,
} from './helpers/framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('re-attests exact existing bodies and selects the proxy only for preview', async () => {
	const fixture = reattestationFixture();
	const result = await reattestFramescaperVideoProxyAttachmentV18(fixture.authority, {
		sourceId: ARCHIVE_SOURCE_ID,
	});

	assert.deepEqual(fixture.requests.map((request) => request.role), ['proxy', 'timing']);
	assert.equal(fixture.requests[0]?.expected.storageKey, `video-proxy-sha256:${ARCHIVE_PROXY_SHA}`);
	assert.equal(fixture.requests[1]?.expected.storageKey, ARCHIVE_TIMING.reference.storageKey);
	assert.equal(fixture.requests[1]?.expected.frameCount, 10);
	assert.deepEqual(result.choice, {
		kind: 'framescaper-video-proxy-choice',
		version: 1,
		rule: 'existing-attachment-reattested-v1',
		projectId: ARCHIVE_PROJECT_ID,
		sourceId: ARCHIVE_SOURCE_ID,
		proxy: fixture.proxyIdentity,
		timing: fixture.timingIdentity,
		original: fixture.originalIdentity,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	});
	assertDeepFrozen(result);
	assert.equal(fixture.counters.originalReleases, 1);
	assert.equal(fixture.counters.bodyReleases, 2);
	assert.ok(fixture.counters.taskChecks >= 8);
	assert.ok(fixture.counters.originalChecks >= 4);
	assert.ok(fixture.counters.bodyChecks >= 6);

	const preview = selectFramescaperVideoProxyV18({
		purpose: 'preview',
		trust: result.trust,
		choice: result.choice,
		currentOriginal: fixture.originalIdentity,
		currentProxy: fixture.proxyIdentity,
		currentTiming: fixture.timingIdentity,
	});
	assert.equal(preview.kind, 'proxy');
	assert.equal(preview.sourceId, ARCHIVE_SOURCE_ID);
	assert.equal(preview.storageKey, fixture.proxyIdentity.storageKey);
	assert.equal(preview.mimeType, 'video/mp4');
	assert.equal(preview.audioPolicy, 'ignore-proxy-container-audio-v1');
	assert.equal(preview.kind === 'proxy'
		? boundVideoSourceTimingViewInfo(preview.timing).frameCount
		: 0, 10);
	assertDeepFrozen(preview);

	for (const purpose of ['export', 'delivery'] as const) {
		assert.deepEqual(selectFramescaperVideoProxyV18({
			purpose,
			trust: result.trust,
			choice: result.choice,
			currentOriginal: fixture.originalIdentity,
			currentProxy: fixture.proxyIdentity,
			currentTiming: fixture.timingIdentity,
		}), {
			kind: 'original',
			sourceId: ARCHIVE_SOURCE_ID,
			storageKey: ARCHIVE_SOURCE_ID,
			mimeType: 'video/mp4',
		});
	}
});

test('keeps imported and handed-off attachments preservation-only until process-local re-attestation', async () => {
	const fixture = reattestationFixture();
	const current = availability(fixture);

	for (const candidate of [
		{ trust: null, choice: null },
		{ trust: { kind: 'framescaper-video-proxy-trust', version: 1 }, choice: null },
	]) {
		assert.equal(selectFramescaperVideoProxyV18({
			purpose: 'preview',
			...candidate,
			...current,
		}).kind, 'original');
	}

	const result = await reattestFramescaperVideoProxyAttachmentV18(fixture.authority, {
		sourceId: ARCHIVE_SOURCE_ID,
	});
	const clonedTrust = structuredClone(result.trust);
	const clonedChoice = structuredClone(result.choice);
	for (const candidate of [
		{ trust: clonedTrust, choice: result.choice },
		{ trust: result.trust, choice: clonedChoice },
		{ trust: result.trust, choice: null },
	]) {
		assert.equal(selectFramescaperVideoProxyV18({
			purpose: 'preview',
			...candidate,
			...current,
		}).kind, 'original');
	}
});

test('rejects corrupt proxy or timing bodies and exact row metadata drift', async () => {
	const cases = [
		['proxy digest', reattestationFixture({
			proxyBody: new Blob(['corrupt'], { type: 'video/mp4' }),
		})],
		['timing digest', reattestationFixture({
			timingBody: new Blob([new Uint8Array(ARCHIVE_TIMING.bytes.byteLength)], {
				type: VIDEO_TIMING_ASSET_MIME_TYPE,
			}),
		})],
		['proxy metadata', reattestationFixture({
			proxyIdentity: { generationToken: 'proxy-generation', mimeType: 'video/webm' },
		})],
		['timing summary', reattestationFixture({
			timingIdentity: { generationToken: 'timing-generation', timescale: 11 },
		})],
	] as const;

	for (const [name, fixture] of cases) {
		await assert.rejects(
			reattestFramescaperVideoProxyAttachmentV18(fixture.authority, {
				sourceId: ARCHIVE_SOURCE_ID,
			}),
			/digest|body|metadata|summary|identity|timing|proxy|length|MIME/iu,
			name,
		);
		assert.equal(fixture.counters.originalReleases, 1, name);
		assert.equal(fixture.counters.bodyReleases, fixture.requests.length, name);
	}
});

test('validates timing bytes then reruns exact 3B-6a boundary conformance', async () => {
	const drift = createVideoTimingAssetPublication(ARCHIVE_PROXY_SHA, {
		timescale: 10,
		presentationTicks: [0n, 1n, 2n, 4n, 5n, 6n, 7n, 8n, 9n, 10n],
		finalFrameDurationTicks: 1n,
	});
	const project = withTiming(archiveProject(), drift.reference);
	const fixture = reattestationFixture({
		project,
		timingBody: new Blob([exactBuffer(drift.bytes)], { type: VIDEO_TIMING_ASSET_MIME_TYPE }),
		timingIdentity: {
			generationToken: 'timing-generation',
			storageKey: drift.reference.storageKey,
			sha256: drift.reference.sha256,
			byteLength: drift.reference.byteLength,
			frameCount: drift.reference.frameCount,
			timescale: drift.reference.timescale,
			finalFrameDurationTicks: drift.reference.finalFrameDurationTicks,
		},
	});

	await assert.rejects(
		reattestFramescaperVideoProxyAttachmentV18(fixture.authority, {
			sourceId: ARCHIVE_SOURCE_ID,
		}),
		/boundary|conform|exact|timing/iu,
	);
	assert.equal(fixture.counters.originalReleases, 1);
	assert.equal(fixture.counters.bodyReleases, 2);
});

test('stale generations, offline bodies, and untrusted evidence fall back to original or unavailable', async () => {
	const fixture = reattestationFixture();
	const result = await reattestFramescaperVideoProxyAttachmentV18(fixture.authority, {
		sourceId: ARCHIVE_SOURCE_ID,
	});
	const exact = {
		purpose: 'preview' as const,
		trust: result.trust,
		choice: result.choice,
		...availability(fixture),
	};
	const changedOriginal = { ...fixture.originalIdentity, generationToken: 'original-generation-2' };
	const changedProxy = { ...fixture.proxyIdentity, generationToken: 'proxy-generation-2' };
	const changedTiming = { ...fixture.timingIdentity, generationToken: 'timing-generation-2' };

	for (const changes of [
		{ currentProxy: null },
		{ currentTiming: null },
		{ currentProxy: changedProxy },
		{ currentTiming: changedTiming },
		{ currentOriginal: changedOriginal },
	]) {
		assert.equal(selectFramescaperVideoProxyV18({ ...exact, ...changes }).kind, 'original');
	}
	assert.deepEqual(selectFramescaperVideoProxyV18({
		...exact,
		currentOriginal: null,
		currentProxy: null,
		currentTiming: null,
	}), { kind: 'unavailable', sourceId: ARCHIVE_SOURCE_ID });
	assert.deepEqual(selectFramescaperVideoProxyV18({
		...exact,
		purpose: 'delivery',
		currentOriginal: null,
	}), { kind: 'unavailable', sourceId: ARCHIVE_SOURCE_ID });
});

test('invalidates old trust across relink but permits fresh exact-content relink re-attestation', async () => {
	const first = reattestationFixture();
	const oldResult = await reattestFramescaperVideoProxyAttachmentV18(first.authority, {
		sourceId: ARCHIVE_SOURCE_ID,
	});
	const relinkedProject = structuredClone(archiveProject()) as unknown as Record<string, unknown>;
	const relinkedSource = (relinkedProject.sources as Record<string, unknown>[])[0]!;
	relinkedSource.storageKey = 'linked-exact-original';
	const relinked = reattestationFixture({
		project: relinkedProject as unknown as FramescaperProjectV18,
		originalIdentity: {
			authority: 'linked',
			storageKey: 'linked-exact-original',
			generationToken: 'linked-original-generation',
		},
	});

	assert.equal(selectFramescaperVideoProxyV18({
		purpose: 'preview', trust: oldResult.trust, choice: oldResult.choice,
		currentOriginal: relinked.originalIdentity,
		currentProxy: relinked.proxyIdentity,
		currentTiming: relinked.timingIdentity,
	}).kind, 'original');
	const fresh = await reattestFramescaperVideoProxyAttachmentV18(relinked.authority, {
		sourceId: ARCHIVE_SOURCE_ID,
	});
	assert.equal(fresh.choice.original.authority, 'linked');
	assert.equal(fresh.choice.original.sha256, ARCHIVE_ORIGINAL_SHA);
	assert.equal(selectFramescaperVideoProxyV18({
		purpose: 'preview', trust: fresh.trust, choice: fresh.choice,
		...availability(relinked),
	}).kind, 'proxy');

	const changedContent = reattestationFixture({
		originalIdentity: { sha256: 'de'.repeat(32), generationToken: 'changed-content' },
	});
	await assert.rejects(
		reattestFramescaperVideoProxyAttachmentV18(changedContent.authority, {
			sourceId: ARCHIVE_SOURCE_ID,
		}),
		/original|digest|identity|current|source/iu,
	);
});

test('holds task, project, source, original, and both body fences through proof and cleanup', async () => {
	const staleBody = reattestationFixture({ proxyCurrent: false });
	await assert.rejects(
		reattestFramescaperVideoProxyAttachmentV18(staleBody.authority, {
			sourceId: ARCHIVE_SOURCE_ID,
		}),
		/current|generation|stale|body/iu,
	);
	assert.equal(staleBody.counters.originalReleases, 1);
	assert.equal(staleBody.counters.bodyReleases, 1);

	const staleProject = reattestationFixture({ mutateAfterTimingAcquire: true });
	await assert.rejects(
		reattestFramescaperVideoProxyAttachmentV18(staleProject.authority, {
			sourceId: ARCHIVE_SOURCE_ID,
		}),
		/project|source|target|changed|stale|current/iu,
	);
	assert.equal(staleProject.counters.originalReleases, 1);
	assert.equal(staleProject.counters.bodyReleases, 2);

	const controller = new AbortController();
	controller.abort(new DOMException('offline', 'AbortError'));
	const cancelled = reattestationFixture();
	assert.throws(
		() => reattestFramescaperVideoProxyAttachmentV18(cancelled.authority, {
			sourceId: ARCHIVE_SOURCE_ID,
			signal: controller.signal,
		}),
		/AbortError|offline|cancel/iu,
	);
	assert.deepEqual(cancelled.counters, zeroCounters());
});

interface FixtureOptions {
	readonly project?: FramescaperProjectV18;
	readonly proxyBody?: Blob;
	readonly timingBody?: Blob;
	readonly proxyIdentity?: Partial<FramescaperVideoProxyBodyIdentityV18>;
	readonly timingIdentity?: Partial<FramescaperVideoProxyBodyIdentityV18>;
	readonly originalIdentity?: Partial<FramescaperVideoProxyOriginalIdentityV18>;
	readonly proxyCurrent?: boolean;
	readonly mutateAfterTimingAcquire?: boolean;
}

function reattestationFixture(options: FixtureOptions = {}) {
	let project = options.project ?? archiveProject();
	const source = project.sources.find((candidate) => candidate.id === ARCHIVE_SOURCE_ID)!;
	const proxyIdentity = Object.freeze({
		role: 'proxy' as const,
		kind: 'video-proxy' as const,
		encoding: 'video-proxy-v1' as const,
		storageKey: `video-proxy-sha256:${ARCHIVE_PROXY_SHA}`,
		mimeType: 'video/mp4',
		byteLength: ARCHIVE_PROXY_BYTES.byteLength,
		sha256: ARCHIVE_PROXY_SHA,
		generationToken: 'proxy-generation',
		...options.proxyIdentity,
	}) as Readonly<FramescaperVideoProxyBodyIdentityV18>;
	const attachment = source.kind === 'video' ? source.proxyAttachment : null;
	assert.ok(attachment);
	const timingIdentity = Object.freeze({
		role: 'timing' as const,
		kind: 'video-timing' as const,
		encoding: 'soundscaper-video-timing-v1' as const,
		storageKey: attachment.timingAsset.storageKey,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength: attachment.timingAsset.byteLength,
		sha256: attachment.timingAsset.sha256,
		frameCount: attachment.timingAsset.frameCount,
		timescale: attachment.timingAsset.timescale,
		finalFrameDurationTicks: attachment.timingAsset.finalFrameDurationTicks,
		generationToken: 'timing-generation',
		...options.timingIdentity,
	}) as Readonly<FramescaperVideoProxyBodyIdentityV18>;
	const originalIdentity = Object.freeze({
		authority: 'owned' as const,
		projectId: ARCHIVE_PROJECT_ID,
		sourceId: ARCHIVE_SOURCE_ID,
		storageKey: ARCHIVE_SOURCE_ID,
		mimeType: 'video/mp4',
		byteLength: ARCHIVE_ORIGINAL_BYTES.byteLength,
		sha256: ARCHIVE_ORIGINAL_SHA,
		generationToken: 'original-generation',
		...options.originalIdentity,
	}) as Readonly<FramescaperVideoProxyOriginalIdentityV18>;
	const proxyBody = options.proxyBody ?? new Blob([exactBuffer(ARCHIVE_PROXY_BYTES)], { type: 'video/mp4' });
	const timingBody = options.timingBody ?? new Blob([exactBuffer(ARCHIVE_TIMING.bytes)], {
		type: VIDEO_TIMING_ASSET_MIME_TYPE,
	});
	let task: Readonly<{ generation: number }> = Object.freeze({ generation: 1 });
	let proxyCurrent = options.proxyCurrent ?? true;
	let timingCurrent = true;
	let originalCurrent = true;
	const requests: Array<Readonly<Record<string, unknown>> & {
		readonly role: 'proxy' | 'timing';
		readonly expected: Readonly<Record<string, unknown>>;
	}> = [];
	const counters = zeroCounters();
	const originalTiming = bindOriginalTiming(source as Readonly<Record<string, unknown>>);
	const authority = createFramescaperVideoProxyReattestationAuthorityV18({
		profile: PROFILE,
		getProject: () => project,
		captureTask: () => { counters.captureTask += 1; return task; },
		assertTaskCurrent: (token: unknown) => {
			counters.taskChecks += 1;
			if (token !== task) throw new DOMException('Task generation changed.', 'AbortError');
		},
		observeOriginal: (request) => {
			counters.originalOpens += 1;
			assert.equal(request.projectId, ARCHIVE_PROJECT_ID);
			assert.equal(request.sourceId, ARCHIVE_SOURCE_ID);
			let released = false;
			return Object.freeze({
				identity: originalIdentity,
				timing: originalTiming,
				assertCurrent() {
					counters.originalChecks += 1;
					if (!originalCurrent) throw new DOMException('Original generation stale.', 'AbortError');
				},
				release() {
					if (released) return;
					released = true;
					counters.originalReleases += 1;
				},
			});
		},
		acquireBody: (request) => {
			counters.bodyOpens += 1;
			requests.push(request);
			const proxy = request.role === 'proxy';
			const identity = proxy ? proxyIdentity : timingIdentity;
			const body = proxy ? proxyBody : timingBody;
			let released = false;
			if (!proxy && options.mutateAfterTimingAcquire) {
				project = { ...project, title: 'Changed during re-attestation' };
			}
			return Object.freeze({
				identity,
				body,
				assertCurrent() {
					counters.bodyChecks += 1;
					if (!(proxy ? proxyCurrent : timingCurrent)) {
						throw new DOMException('Body generation stale.', 'AbortError');
					}
				},
				release() {
					if (released) return;
					released = true;
					counters.bodyReleases += 1;
				},
			});
		},
	});
	return {
		authority, counters, originalIdentity, proxyIdentity, requests, timingIdentity,
		advanceTask: () => { task = Object.freeze({ generation: 2 }); },
		setOriginalCurrent: (value: boolean) => { originalCurrent = value; },
		setProxyCurrent: (value: boolean) => { proxyCurrent = value; },
		setTimingCurrent: (value: boolean) => { timingCurrent = value; },
	};
}

function bindOriginalTiming(source: Readonly<Record<string, unknown>>): BoundVideoSourceTimingView {
	const sourceId = String(source.id);
	return bindVideoSourceTimingView(new Map([[sourceId, Object.freeze({
		kind: 'cfr' as const,
		rate: source.frameRate as Readonly<{ num: number; den: number }>,
		frameCount: Number(source.sourceFrameCount),
	})]]), source);
}

function availability(fixture: ReturnType<typeof reattestationFixture>) {
	return {
		currentOriginal: fixture.originalIdentity,
		currentProxy: fixture.proxyIdentity,
		currentTiming: fixture.timingIdentity,
	};
}

function withTiming(
	projectValue: FramescaperProjectV18,
	reference: Readonly<Record<string, unknown>>,
): FramescaperProjectV18 {
	const project = structuredClone(projectValue) as unknown as Record<string, unknown>;
	const source = (project.sources as Record<string, unknown>[])[0]!;
	const attachment = source.proxyAttachment as Record<string, unknown>;
	attachment.timingAsset = reference;
	return project as unknown as FramescaperProjectV18;
}

function zeroCounters() {
	return {
		captureTask: 0,
		taskChecks: 0,
		originalOpens: 0,
		originalChecks: 0,
		originalReleases: 0,
		bodyOpens: 0,
		bodyChecks: 0,
		bodyReleases: 0,
	};
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	assert.equal(Object.isFrozen(value), true);
	for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}
