/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
	DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
} from '../../desktop/project-library-lease-smoke.js';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
export { awaitLeaseMatrixControlFile } from './desktop-project-library-lease-children.mjs';
import { createChildDriver, terminateTree } from './desktop-project-library-lease-children.mjs';
import { resolveSmokeArchitecture } from './desktop-smoke.mjs';

export const DESKTOP_PROJECT_LIBRARY_LEASE_MATRIX_PREFIX = 'SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_LEASE_MATRIX ';
export const DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS = Object.freeze([
	'same-project-simultaneous-open',
	'cross-product-simultaneous-open',
	'writer-lease-transfer',
	'stale-lease-takeover',
	'conflicting-canonical-commit',
	'renderer-loss-during-operation',
	'orderly-process-restart',
	'crash-restart-recovery',
]);

export const DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS = Object.freeze(
	DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS.filter(
		(workflowId) => workflowId !== 'cross-product-simultaneous-open',
	),
);

// The lease every case runs under. A live holder has to renew inside this
// window, and a packaged Electron instance on a shared runner can lose a whole
// second to scheduling — at a one-second lease that expired the lease under its
// own holder, and `writer-lease-transfer` failed with "lease holder no longer
// owns the lease". Nothing here tests how short a lease can be, so the window
// is wide enough that only a genuinely dead holder loses it. The cases that
// need expiry wait it out explicitly instead of racing it.
const TTL_MS = 5_000;
const LEASE_EXPIRY_MARGIN_MS = 500;
const MAXIMUM_EVIDENCE_CHARACTERS = 2_000;
/** Both catalogs raise a lease another live instance holds under these exact wordings. */
const WRITER_LEASE_BUSY = /(?:Soundscaper desktop baseline|Framescaper desktop 1\.0) writer lease is busy/u;

export function isDesktopProjectLibraryWriterLeaseBusy(output) {
	return WRITER_LEASE_BUSY.test(output);
}

export function removeDesktopProjectLibraryLeaseMatrixSmokeRoot(smokeRoot, remove = rm) {
	return remove(smokeRoot, {
		recursive: true, force: true, maxRetries: 10, retryDelay: 100,
	});
}

export function createDesktopProjectLibraryLeaseMatrixPlan({ action, control, productId, projectId, request }) {
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
		action,
		control,
		leaseTtlMs: TTL_MS,
		productId,
		projectId,
		request,
	});
}

export async function runDesktopProjectLibraryLeaseMatrix({
	repositoryRoot,
	arch = process.env.SOUNDSCAPER_SMOKE_ARCH || process.arch,
	platform = process.platform,
	environment = process.env,
	outputRoot = resolve(repositoryRoot, 'release/desktop-lease-matrix'),
} = {}) {
	const root = resolve(repositoryRoot);
	const targetArch = resolveSmokeArchitecture(arch, arch);
	const smokeRoot = await mkdtemp(join(tmpdir(), 'scape-lease-matrix-'));
	try {
		const runtime = { root, targetArch, platform, environment, outputRoot: resolve(outputRoot), smokeRoot };
		const cases = [];
		for (const productId of ['soundscaper', 'framescaper']) {
			for (const workflowId of DESKTOP_PROJECT_LIBRARY_LEASE_WORKFLOWS) {
				cases.push(await runCase(runtime, workflowId, [productId, productId]));
			}
		}
		cases.push(await runCase(
			runtime, 'cross-product-simultaneous-open', ['soundscaper', 'framescaper'],
		));
		return deepFreeze({
			schemaVersion: 1,
			mode: DESKTOP_PROJECT_LIBRARY_LEASE_SMOKE_MODE,
			platform,
			arch: targetArch,
			workflows: DESKTOP_PROJECT_LIBRARY_HISTORICAL_LEASE_WORKFLOWS,
			cases,
		});
	} finally {
		await removeDesktopProjectLibraryLeaseMatrixSmokeRoot(smokeRoot);
	}
}

export function formatDesktopProjectLibraryLeaseMatrix(value) {
	const line = `${DESKTOP_PROJECT_LIBRARY_LEASE_MATRIX_PREFIX}${JSON.stringify(value)}`;
	if (Buffer.byteLength(line, 'utf8') > 1024 * 1024) throw new RangeError('Lease matrix result exceeds 1 MiB');
	return line;
}

async function runCase(runtime, workflowId, order) {
	const caseRoot = join(runtime.smokeRoot, `${workflowId}-${order.join('-')}`);
	await mkdir(caseRoot, { recursive: true });
	const children = new Set();
	const scope = {
		...runtime, caseRoot, appDataPath: join(caseRoot, 'application-data'), childIndex: 0, children,
	};
	let result;
	let failure = null;
	try {
		result = await runDesktopProjectLibraryLeaseMatrixCase({
			driver: createChildDriver(scope), workflowId, order,
		});
	} catch (error) {
		failure = error;
	}
	let cleanupError = null;
	try {
		await cleanupDesktopProjectLibraryLeaseMatrixChildren(children, scope.platform);
	} catch (error) {
		cleanupError = error;
	}
	if (cleanupError !== null) {
		if (failure !== null) {
			throw new AggregateError(
				[failure, cleanupError], 'Lease matrix case and child cleanup both failed', { cause: failure },
			);
		}
		throw cleanupError;
	}
	if (failure !== null) throw failure;
	return result;
}

export async function cleanupDesktopProjectLibraryLeaseMatrixChildren(
	children,
	platform,
	terminate = terminateTree,
) {
	const failures = [];
	for (const launched of [...children]) {
		try {
			await terminate(launched.child, platform);
			await launched.exit;
		} catch (error) {
			failures.push(error);
		}
	}
	children.clear();
	if (failures.length > 0) {
		throw new AggregateError(failures, 'Lease matrix child cleanup failed');
	}
}

export async function runDesktopProjectLibraryLeaseMatrixCase({ driver, workflowId, order }) {
	const projectId = `lease-matrix-${workflowId}`;
	const primary = order[0];
	const secondary = order[1];
	const initial = createDesktopProjectLibraryLeaseMatrixDocument(
		projectId, 1, `${workflowId} initial`, primary,
	);
	let results;
	if (workflowId === 'cross-product-simultaneous-open') {
		if (primary === secondary) throw new Error('Cross-product isolation requires two products');
		const isolated = createDesktopProjectLibraryLeaseMatrixDocument(
			projectId, 1, `${workflowId} isolated`, secondary,
		);
		const seed = await driver.commit(primary, 'commit', projectId, request(initial, null));
		const holder = await driver.hold(primary, 'observe-hold', projectId, null);
		await holder.start();
		await holder.waitResult();
		const admitted = await driver.commit(secondary, 'commit', projectId, request(isolated, null));
		await holder.release();
		const primaryVerification = await driver.commit(primary, 'verify', projectId, null);
		const secondaryVerification = await driver.commit(secondary, 'verify', projectId, null);
		if (admitted.renderer?.status !== 'committed'
			|| primaryVerification.renderer?.document !== initial
			|| secondaryVerification.renderer?.document !== isolated) {
			throw new Error('Cross-product catalogs did not remain independently writable and isolated');
		}
		results = [seed, holder.result, admitted, primaryVerification, secondaryVerification];
	} else if (workflowId === 'same-project-simultaneous-open') {
		const seed = await driver.commit(primary, 'commit', projectId, request(initial, null));
		const holder = await driver.hold(primary, 'observe-hold', projectId, null);
		await holder.start();
		await holder.waitResult();
		// One writer per library for the life of the process: the instance that
		// arrives second is refused rather than admitted alongside the holder.
		const refused = await driver.refuse(primary, 'observe-hold', projectId, null);
		await holder.release();
		results = [seed, holder.result, refused];
	} else if (workflowId === 'writer-lease-transfer') {
		const holder = await driver.hold(primary, 'commit-hold', projectId, request(initial, null));
		await holder.start();
		await holder.waitResult();
		// The lease only transfers once its holder has given it up.
		await holder.release();
		const advanced = createDesktopProjectLibraryLeaseMatrixDocument(
			projectId, 4, `${workflowId} advanced`, primary,
		);
		const transferred = await driver.commit(secondary, 'commit', projectId, request(advanced, 1));
		results = [holder.result, transferred];
	} else if (workflowId === 'stale-lease-takeover') {
		const crashed = await driver.crash(primary, 'crash-prepared', projectId, request(initial, null));
		await awaitAbandonedLeaseExpiry();
		const takeover = await driver.commit(secondary, 'commit', projectId, request(initial, null));
		results = [crashed, takeover];
		if (takeover.host?.writer?.tookOverStaleLease !== true) {
			throw new Error(`Stale takeover was not evidenced: ${evidence(takeover)}`);
		}
	} else if (workflowId === 'conflicting-canonical-commit') {
		const seed = await driver.commit(primary, 'commit', projectId, request(initial, null));
		const left = createDesktopProjectLibraryLeaseMatrixDocument(projectId, 8, `${workflowId} left`, primary);
		const right = createDesktopProjectLibraryLeaseMatrixDocument(projectId, 8, `${workflowId} right`, primary);
		// Both contenders are handed the seeded base, so the one that reaches the
		// library second publishes against a base the winner already superseded.
		const winner = await driver.commit(primary, 'commit-contend', projectId, request(left, 1));
		const loser = await driver.commit(secondary, 'commit-contend', projectId, request(right, 1));
		if (winner.renderer?.status !== 'committed') {
			throw new Error(`Canonical conflict did not select one winner: ${evidence(winner)}`);
		}
		if (loser.renderer?.status !== 'conflict' || loser.renderer.reason !== 'compare-and-swap') {
			throw new Error(
				`Canonical conflict did not refuse the second contender by compare-and-swap: ${evidence(loser)}`,
			);
		}
		results = [seed, winner, loser];
	} else if (workflowId === 'renderer-loss-during-operation') {
		const [checkpoint, recovered] = await driver.rendererLoss(primary, projectId, request(initial, null));
		if (checkpoint.phase !== 'prepared' || checkpoint.host?.activePublication !== true) {
			throw new Error(`Renderer loss did not land on an in-flight publication: ${evidence(checkpoint)}`);
		}
		if (recovered.renderer?.status !== 'committed') {
			throw new Error(`Renderer loss left its abandoned publication canonical: ${evidence(recovered)}`);
		}
		results = [checkpoint, recovered];
	} else if (workflowId === 'orderly-process-restart') {
		results = [
			await driver.commit(primary, 'commit', projectId, request(initial, null)),
			await driver.commit(primary, 'verify', projectId, null),
		];
	} else {
		const crashed = await driver.crash(primary, 'crash-committed', projectId, request(initial, null));
		await awaitAbandonedLeaseExpiry();
		results = [crashed, await driver.commit(secondary, 'commit', projectId, request(initial, null))];
		if (results[1].host?.writer?.recovery?.outcome !== 'committed') {
			throw new Error(`Committed crash journal was not recovered: ${evidence(results[1])}`);
		}
	}
	const tokens = fencingTokens(results);
	const winningDocumentSha256 = winningDigest(results);
	const finalCatalog = results.toReversed().find((result) => result.catalog)?.catalog;
	if (!winningDocumentSha256 || finalCatalog?.projectSha256 !== winningDocumentSha256) {
		throw new Error('Lease matrix catalog does not advertise the exact winning document');
	}
	const bodyCounts = results.flatMap((result) => (
		Number.isSafeInteger(result.catalog?.managedMediaBodyCount) ? [result.catalog.managedMediaBodyCount] : []
	));
	if (bodyCounts.some((count) => count !== 0)) {
		throw new Error('Source-free lease matrix advertised a managed-media body');
	}
	return deepFreeze({
		workflowId,
		order: order.join('-then-'),
		fencingTokens: tokens,
		refusedInstances: results.filter((result) => result.refused).length,
		winningDocumentSha256,
		losingManagedMediaBodyCounts: bodyCounts,
	});
}

/**
 * V10 takes one writer lease per process lifetime and renews it without minting
 * a new token, so a holder reports the same token for every result it produces.
 * Fencing only guarantees that the next acquisition outranks every token the
 * library issued before it.
 */
function fencingTokens(results) {
	const tokens = [];
	const holders = new Map();
	const highestByProduct = new Map();
	for (const result of results) {
		const token = result.host?.writer?.fencingToken;
		if (!Number.isSafeInteger(token)) continue;
		const holder = result.host?.owner?.instanceId;
		const productId = result.host?.owner?.product;
		if (typeof holder !== 'string' || !holder) {
			throw new Error('Lease matrix fencing evidence does not identify its lease holder');
		}
		if (productId !== 'soundscaper' && productId !== 'framescaper') {
			throw new Error('Lease matrix fencing evidence does not identify its product scope');
		}
		const holderKey = `${productId}:${holder}`;
		const held = holders.get(holderKey);
		const highest = highestByProduct.get(productId) ?? null;
		if (held === undefined) {
			if (highest !== null && token <= highest) {
				throw new Error('Lease matrix fencing token did not advance across acquisitions');
			}
		} else if (token < held) {
			throw new Error('Lease matrix fencing token regressed within one lease holder');
		}
		holders.set(holderKey, token);
		highestByProduct.set(productId, highest === null || token > highest ? token : highest);
		tokens.push(token);
	}
	return tokens;
}

function awaitAbandonedLeaseExpiry() {
	return delay(TTL_MS + LEASE_EXPIRY_MARGIN_MS);
}

function request(document, expectedRevision) { return { document, expectedRevision }; }
/**
 * A refused workflow is only actionable if it says what it saw. These assertions run once a
 * night against a packaged product, so a failure that reports the claim without the payload
 * costs a full nightly to learn anything from. The slice is bounded because the payload
 * carries a whole project document.
 */
function evidence(value) {
	const text = JSON.stringify(value) ?? String(value);
	return text.length > MAXIMUM_EVIDENCE_CHARACTERS
		? `${text.slice(0, MAXIMUM_EVIDENCE_CHARACTERS)}…` : text;
}
/** The digest main published, so the assertion compares stored bytes rather than re-encoded text. */
function winningDigest(results) {
	for (const result of results.toReversed()) {
		if (result.renderer?.status === 'committed') return result.renderer.projectSha256;
	}
	for (const result of results.toReversed()) {
		if (typeof result.renderer?.projectSha256 === 'string') return result.renderer.projectSha256;
	}
	return null;
}
export function createDesktopProjectLibraryLeaseMatrixDocument(
	id,
	revision,
	title,
	productId = 'soundscaper',
) {
	if (productId === 'framescaper') {
		return JSON.stringify(createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
			id, title, revision, now: '2026-08-24T12:00:00.000Z',
		}));
	}
	if (productId !== 'soundscaper') throw new TypeError('Lease matrix document product is unsupported');
	const base = createSoundscaperProject({ id, title });
	return JSON.stringify({ ...base, revision, metadata: { ...base.metadata, title } });
}
function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}
