/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { LinkedVideoOriginalPort } from '../common/editor/storage/linked-video-original-resolver.ts';
import type {
	FramescaperNativeServicesBridge,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';
import type {
	FramescaperNativeWatchImportClaim,
} from '../common/editor/ui/framescaper-native-project-assets-bridge.ts';
import { framescaperVideoProxyActionRuntimeFor } from './editor-video-proxy-action-runtime.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SELECTED_BIN_ID = 'project-bin';
const MAXIMUM_VIDEO_BYTES = 512 * 1024 ** 2;

interface WatchVideoSource extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly contentSha256: string;
	readonly proxyAttachment: Readonly<Record<string, unknown>> | null;
}

interface WatchImportProject extends Readonly<Record<string, unknown>> {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly id: string;
	readonly revision: number;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<{ readonly clips: readonly Readonly<Record<string, unknown>>[] }>;
}

export interface FramescaperNativeWatchImportController {
	readonly project: unknown;
	readonly actions: Readonly<{ readonly project: Readonly<{
		importFiles(files: readonly Blob[], options: Readonly<Record<string, unknown>>): Promise<void>;
		flush(options?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	}> }>;
}

export interface FramescaperNativeWatchImportClientOptions {
	readonly controller: FramescaperNativeWatchImportController;
	readonly linkedVideoOriginalPort: LinkedVideoOriginalPort | null;
	readonly bridge: Pick<FramescaperNativeServicesBridge, 'claimWatchImport' | 'completeWatchImport'> | null;
	readonly intervalMs?: number;
	readonly autoStart?: boolean;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly onError?: (error: unknown) => void;
}

export interface FramescaperNativeWatchImportClient {
	readonly available: boolean;
	pollNow(): Promise<boolean>;
	dispose(): Promise<void>;
}

/** Menu-invisible baseline consumer of strict pathless main-owned watch claims. */
export function createFramescaperNativeWatchImportClient(
	options: FramescaperNativeWatchImportClientOptions,
): Readonly<FramescaperNativeWatchImportClient> {
	const controller = options?.controller;
	const port = options?.linkedVideoOriginalPort;
	const bridge = options?.bridge;
	const available = Boolean(controller && port && typeof port.load === 'function'
		&& typeof bridge?.claimWatchImport === 'function'
		&& typeof bridge.completeWatchImport === 'function');
	const intervalMs = positiveInteger(options.intervalMs ?? 1_000, 'watch-import poll interval');
	const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
	const cancelSchedule = options.cancelSchedule
		?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	let disposed = false;
	let closing = false;
	let timer: unknown = null;
	let tail: Promise<boolean> | null = null;

	const pollNow = (): Promise<boolean> => {
		if (!available || closing || disposed) return Promise.resolve(false);
		tail ??= poll().finally(() => { tail = null; });
		return tail;
	};
	const queueNext = (): void => {
		if (!available || closing || disposed || timer !== null) return;
		timer = schedule(() => {
			timer = null;
			void pollNow().catch(report).finally(queueNext);
		}, intervalMs);
	};
	if (available && options.autoStart !== false) queueNext();

	return Object.freeze({
		available,
		pollNow,
		async dispose(): Promise<void> {
			if (closing || disposed) return;
			closing = true;
			if (timer !== null) cancelSchedule(timer);
			timer = null;
			await tail?.catch(report);
			disposed = true;
		},
	});

	async function poll(): Promise<boolean> {
		const before = exactProject(controller.project);
		if (!before) return false;
		const claimValue = await bridge!.claimWatchImport!({
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: before.id, projectRevision: before.revision,
		});
		if (claimValue === null) return false;
		let claim: WatchImportClaim;
		try { claim = watchClaim(claimValue); } catch (error) { report(error); return false; }
		let committed: WatchImportProject | null = null;
		let sourceId: string | null = null;
		try {
			assertClaimTarget(claim, before);
			let source: WatchVideoSource;
			if (claim.existingSourceId === null) {
				const file = await materializeClaim(claim, before);
				const previousSourceIds = new Set(before.sources.map((candidate) => String(candidate.id)));
				await controller.actions.project.importFiles([file], Object.freeze({
					destination: claim.binId,
					...(claim.importMode === 'link' ? {
						linkedVideoLocatorId: claim.locatorId,
						linkedVideoLocatorRevision: claim.locatorRevision,
					} : {}),
				}));
				committed = exactRevision(controller.project, before, before.revision + 1);
				source = newlyImportedSource(committed, claim, previousSourceIds);
				sourceId = source.id;
				await flushExact(committed);
			} else {
				source = sourceInSelectedBin(before, claim.existingSourceId, claim.contentSha256);
				sourceId = source.id;
			}
			if (claim.generateProxies) {
				if (proxyAttached(source, claim.contentSha256)) {
					throw new Error('The main process offered already-complete proxy work.');
				}
				const proxy = framescaperVideoProxyActionRuntimeFor(controller);
				if (!proxy) throw new Error('The selected authenticated proxy scheduler is unavailable.');
				const prior = committed ?? before;
				await proxy.generate(source.id);
				committed = exactRevision(controller.project, prior, prior.revision + 1);
				source = sourceInSelectedBin(committed, source.id, claim.contentSha256);
				if (!proxyAttached(source, claim.contentSha256)) {
					throw new Error('Requested proxy generation did not publish an exact attachment.');
				}
				await flushExact(committed);
			}
			committed ??= before;
			if (committed === before) throw new Error('A watch claim carried no pending baseline work.');
			if (await acknowledge(claim, sourceId, committed.revision, true)) return true;
			throw new Error('The watch-import completion was not acknowledged.');
		} catch (error) {
			report(error);
			if (committed !== null && sourceId !== null) return retryCommitted(claim, sourceId, committed);
			if (sameProject(controller.project, before)) {
				await acknowledge(claim, null, before.revision, false).catch(report);
			}
			return false;
		}
	}

	async function materializeClaim(
		claim: WatchImportClaim,
		before: WatchImportProject,
	): Promise<Blob> {
		assertSameProject(controller.project, before);
		const loaded = await port!.load(claim.locatorId, { expectedRevision: claim.locatorRevision });
		if (!loaded || loaded.locatorRevision !== claim.locatorRevision) {
			throw new Error('The watched linked-video locator is unavailable or stale.');
		}
		const file = exactClaimFile(loaded.blob, claim);
		if (await digestMediaContent(file) !== claim.contentSha256) {
			throw new Error('The watched video digest changed before import.');
		}
		assertSameProject(controller.project, before);
		return file;
	}

	async function flushExact(project: WatchImportProject): Promise<void> {
		await controller.actions.project.flush({ forceCurrentSnapshot: true });
		assertSameProject(controller.project, project);
	}

	async function retryCommitted(
		claim: WatchImportClaim,
		committedSourceId: string,
		project: WatchImportProject,
	): Promise<boolean> {
		for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
			try {
				await flushExact(project);
				if (await acknowledge(claim, committedSourceId, project.revision, true)) return true;
			} catch (error) { report(error); }
		}
		return false;
	}

	async function acknowledge(
		claim: WatchImportClaim,
		committedSourceId: string | null,
		committedProjectRevision: number,
		success: boolean,
	): Promise<boolean> {
		return bridge!.completeWatchImport!({
			schemaFamily: 'framescaper', schemaVersion: 1,
			claimId: claim.claimId, projectId: claim.projectId,
			binId: claim.binId, sourceId: committedSourceId, contentSha256: claim.contentSha256,
			expectedProjectRevision: claim.projectRevision, committedProjectRevision, success,
		});
	}

	function report(error: unknown): void {
		try { options.onError?.(error); } catch { /* Error reporting owns no authority. */ }
	}
}

type WatchImportClaim = FramescaperNativeWatchImportClaim;

function watchClaim(value: unknown): WatchImportClaim {
	const fields = [
		'schemaFamily', 'schemaVersion', 'claimId', 'projectId', 'projectRevision', 'binId',
		'generateProxies', 'existingSourceId', 'importMode', 'locatorId', 'locatorRevision',
		'name', 'size', 'mimeType', 'lastModified', 'contentSha256',
	];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('A selected watch-import claim must be an exact pathless record.');
	}
	const claim = value as WatchImportClaim;
	if (claim.schemaFamily !== 'framescaper' || claim.schemaVersion !== 1
		|| claim.binId !== SELECTED_BIN_ID
		|| typeof claim.generateProxies !== 'boolean'
		|| (claim.existingSourceId !== null && !IDENTIFIER.test(claim.existingSourceId))
		|| !OPAQUE_ID.test(claim.claimId) || !OPAQUE_ID.test(claim.locatorId)
		|| !OPAQUE_ID.test(claim.locatorRevision) || !IDENTIFIER.test(claim.projectId)
		|| !Number.isSafeInteger(claim.projectRevision) || claim.projectRevision < 0
		|| (claim.importMode !== 'link' && claim.importMode !== 'copy')
		|| typeof claim.name !== 'string' || !claim.name || claim.name.length > 255
		|| /[\0/\\]/u.test(claim.name) || !Number.isSafeInteger(claim.size)
		|| claim.size < 1 || claim.size > MAXIMUM_VIDEO_BYTES
		|| typeof claim.mimeType !== 'string' || !claim.mimeType.startsWith('video/')
		|| !Number.isSafeInteger(claim.lastModified) || claim.lastModified < 0
		|| !SHA256.test(claim.contentSha256)) throw new TypeError('A selected watch-import claim is invalid.');
	return Object.freeze({ ...claim });
}

function assertClaimTarget(claim: WatchImportClaim, before: WatchImportProject): void {
	if (claim.projectId !== before.id || claim.projectRevision !== before.revision) {
		throw new Error('A watch-import claim targets a stale selected project.');
	}
	assertSameProject(before, before);
}

function newlyImportedSource(
	project: WatchImportProject,
	claim: WatchImportClaim,
	previousSourceIds: ReadonlySet<string>,
): WatchVideoSource {
	const matching = project.sources.filter((candidate) => candidate.kind === 'video'
		&& typeof candidate.id === 'string' && !previousSourceIds.has(candidate.id)
		&& candidate.contentSha256 === claim.contentSha256);
	if (matching.length !== 1) throw new Error('The watched digest did not create one exact video source.');
	return sourceInSelectedBin(project, String(matching[0]!.id), claim.contentSha256);
}

function sourceInSelectedBin(
	project: WatchImportProject, sourceId: string, contentSha256: string,
): WatchVideoSource {
	const matching = project.sources.filter((candidate) => candidate.kind === 'video'
		&& candidate.id === sourceId && candidate.contentSha256 === contentSha256
		&& Object.hasOwn(candidate, 'proxyAttachment'));
	const clips = project.projectBin.clips.filter((clip) => clip.kind === 'video' && clip.sourceId === sourceId);
	if (matching.length !== 1 || clips.length !== 1) {
		throw new Error('The watched video is not uniquely committed in the selected project bin.');
	}
	return matching[0] as WatchVideoSource;
}

function proxyAttached(source: WatchVideoSource, contentSha256: string): boolean {
	const attachment = source.proxyAttachment;
	return !!attachment && attachment.originalSha256 === contentSha256
		&& typeof attachment.sha256 === 'string' && SHA256.test(attachment.sha256);
}

function exactClaimFile(blob: unknown, claim: WatchImportClaim): Blob {
	const file = blob as Blob & Readonly<{ name?: string; lastModified?: number }>;
	if (!(blob instanceof Blob) || file.size !== claim.size || file.type !== claim.mimeType
		|| file.name !== claim.name || file.lastModified !== claim.lastModified) {
		throw new Error('The watched locator materialized different file metadata.');
	}
	return file;
}

function exactProject(value: unknown): WatchImportProject | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const project = value as Partial<WatchImportProject>;
	if (project.schemaFamily !== 'framescaper' || project.schemaVersion !== 1
		|| typeof project.id !== 'string' || !IDENTIFIER.test(project.id)
		|| !Number.isSafeInteger(project.revision) || Number(project.revision) < 0
		|| !Array.isArray(project.sources) || !project.projectBin
		|| Reflect.ownKeys(project.projectBin).length !== 1
		|| !Array.isArray(project.projectBin.clips)) return null;
	return project as WatchImportProject;
}

function exactRevision(
	value: unknown, previous: WatchImportProject, revision: number,
): WatchImportProject {
	const current = exactProject(value);
	if (!current || current.id !== previous.id || current.revision !== revision) {
		throw new Error('The selected watch mutation did not commit one exact project revision.');
	}
	return current;
}

function sameProject(value: unknown, expected: WatchImportProject): boolean {
	const current = exactProject(value);
	return current?.id === expected.id && current.revision === expected.revision;
}

function assertSameProject(value: unknown, expected: WatchImportProject): void {
	if (!sameProject(value, expected)) {
		throw new Error('The active selected project changed during watch import.');
	}
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 60_000) {
		throw new RangeError(`Invalid ${label}.`);
	}
	return Number(value);
}
