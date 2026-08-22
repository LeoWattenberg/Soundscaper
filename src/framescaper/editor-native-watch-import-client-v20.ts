/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { LinkedVideoOriginalPort } from '../common/editor/storage/linked-video-original-resolver.ts';
import type {
	FramescaperNativeServicesBridge,
	FramescaperNativeWatchImportClaim,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';

const OPAQUE_ID = /^[a-f0-9]{16,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAXIMUM_VIDEO_BYTES = 512 * 1024 ** 2;

interface WatchImportProject extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: 20;
	readonly id: string;
	readonly revision: number;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<{ readonly clips: readonly Readonly<Record<string, unknown>>[] }>;
}

export interface FramescaperNativeWatchImportControllerV20 {
	readonly project: unknown;
	readonly actions: Readonly<{ readonly project: Readonly<{
		importFiles(files: readonly Blob[], options: Readonly<Record<string, unknown>>): Promise<void>;
		flush(options?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
	}> }>;
}

export interface FramescaperNativeWatchImportClientV20Options {
	readonly controller: FramescaperNativeWatchImportControllerV20;
	readonly linkedVideoOriginalPort: LinkedVideoOriginalPort | null;
	readonly bridge: Pick<FramescaperNativeServicesBridge, 'claimWatchImport' | 'completeWatchImport'> | null;
	readonly intervalMs?: number;
	readonly autoStart?: boolean;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly onError?: (error: unknown) => void;
}

export interface FramescaperNativeWatchImportClientV20 {
	readonly available: boolean;
	pollNow(): Promise<boolean>;
	dispose(): Promise<void>;
}

/** Menu-invisible selected-V20 consumer for pathless main-owned watch claims. */
export function createFramescaperNativeWatchImportClientV20(
	options: FramescaperNativeWatchImportClientV20Options,
): Readonly<FramescaperNativeWatchImportClientV20> {
	const controller = options?.controller;
	const port = options?.linkedVideoOriginalPort;
	const bridge = options?.bridge;
	const available = Boolean(controller && port
		&& typeof port.load === 'function'
		&& typeof bridge?.claimWatchImport === 'function'
		&& typeof bridge.completeWatchImport === 'function');
	const intervalMs = positiveInteger(options.intervalMs ?? 1_000, 'watch-import poll interval');
	const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
	const cancelSchedule = options.cancelSchedule ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
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
		const before = exactV20Project(controller.project);
		if (!before) return false;
		const claimValue = await bridge!.claimWatchImport!({
			projectId: before.id, projectRevision: before.revision,
		});
		if (claimValue === null) return false;
		const claim = watchClaim(claimValue);
		let committed: WatchImportProject | null = null;
		try {
			if (claim.projectId !== before.id || claim.projectRevision !== before.revision) {
				throw new Error('A watch-import claim targets a stale active project.');
			}
			assertSameProject(controller.project, before);
			const loaded = await port!.load(claim.locatorId, {
				expectedRevision: claim.locatorRevision,
			});
			if (!loaded || loaded.locatorRevision !== claim.locatorRevision) {
				throw new Error('The watched linked-video locator is unavailable or stale.');
			}
			const file = exactClaimFile(loaded.blob, claim);
			if (await digestMediaContent(file) !== claim.contentSha256) {
				throw new Error('The watched video digest changed before import.');
			}
			assertSameProject(controller.project, before);
			const sourceIds = new Set(before.sources.map((source) => String(source.id)));
			await controller.actions.project.importFiles([file], Object.freeze({
				destination: 'project-bin',
				...(claim.importMode === 'link' ? {
					linkedVideoLocatorId: claim.locatorId,
					linkedVideoLocatorRevision: claim.locatorRevision,
				} : {}),
			}));
			committed = committedImport(controller.project, claim, sourceIds);
			await controller.actions.project.flush({ forceCurrentSnapshot: true });
			assertSameProject(controller.project, committed);
			if (await acknowledge(claim, committed.revision, true)) return true;
			throw new Error('The watch-import completion was not acknowledged.');
		} catch (error) {
			report(error);
			if (committed !== null) {
				return retryCommitted(claim, committed);
			}
			await acknowledge(claim, claim.projectRevision + 1, false).catch(report);
			return false;
		}
	}

	async function retryCommitted(
		claim: FramescaperNativeWatchImportClaim,
		project: WatchImportProject,
	): Promise<boolean> {
		for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
			try {
				assertSameProject(controller.project, project);
				await controller.actions.project.flush({ forceCurrentSnapshot: true });
				if (await acknowledge(claim, project.revision, true)) return true;
			} catch (error) { report(error); }
		}
		return false;
	}

	async function acknowledge(
		claim: FramescaperNativeWatchImportClaim,
		committedProjectRevision: number,
		success: boolean,
	): Promise<boolean> {
		return bridge!.completeWatchImport!({
			claimId: claim.claimId, projectId: claim.projectId,
			expectedProjectRevision: claim.projectRevision,
			committedProjectRevision, success,
		});
	}

	function report(error: unknown): void {
		try { options.onError?.(error); } catch { /* Error reporting owns no authority. */ }
	}
}

function committedImport(
	value: unknown,
	claim: FramescaperNativeWatchImportClaim,
	previousSourceIds: ReadonlySet<string>,
): WatchImportProject {
	const project = exactV20Project(value);
	if (!project || project.id !== claim.projectId || project.revision !== claim.projectRevision + 1) {
		throw new Error('The watched video did not commit one exact V20 project revision.');
	}
	const source = project.sources.find((candidate) => candidate.kind === 'video'
		&& typeof candidate.id === 'string' && !previousSourceIds.has(candidate.id)
		&& candidate.contentSha256 === claim.contentSha256);
	if (!source || !project.projectBin.clips.some((clip) => clip.sourceId === source.id)) {
		throw new Error('The watched video did not land in the exact project bin.');
	}
	return project;
}

function exactClaimFile(blob: unknown, claim: FramescaperNativeWatchImportClaim): Blob {
	const file = blob as Blob & Readonly<{ name?: string; lastModified?: number }>;
	if (!(blob instanceof Blob) || file.size !== claim.size || file.type !== claim.mimeType
		|| file.name !== claim.name || file.lastModified !== claim.lastModified) {
		throw new Error('The watched locator materialized different file metadata.');
	}
	return file;
}

function exactV20Project(value: unknown): WatchImportProject | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const project = value as Partial<WatchImportProject>;
	if (project.schemaVersion !== 20 || typeof project.id !== 'string' || !PROJECT_ID.test(project.id)
		|| !Number.isSafeInteger(project.revision) || Number(project.revision) < 0
		|| !Array.isArray(project.sources) || !project.projectBin
		|| !Array.isArray(project.projectBin.clips)) return null;
	return project as WatchImportProject;
}

function assertSameProject(value: unknown, expected: WatchImportProject): void {
	const current = exactV20Project(value);
	if (!current || current.id !== expected.id || current.revision !== expected.revision) {
		throw new Error('The active Framescaper project changed during watch import.');
	}
}

function watchClaim(value: unknown): FramescaperNativeWatchImportClaim {
	const fields = [
		'claimId', 'projectId', 'projectRevision', 'importMode', 'locatorId', 'locatorRevision',
		'name', 'size', 'mimeType', 'lastModified', 'contentSha256',
	];
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('A watch-import claim must be an exact pathless record.');
	}
	const claim = value as unknown as FramescaperNativeWatchImportClaim;
	if (!OPAQUE_ID.test(claim.claimId) || !OPAQUE_ID.test(claim.locatorId)
		|| !OPAQUE_ID.test(claim.locatorRevision) || !PROJECT_ID.test(claim.projectId)
		|| !Number.isSafeInteger(claim.projectRevision) || claim.projectRevision < 0
		|| !['link', 'copy'].includes(claim.importMode)
		|| typeof claim.name !== 'string' || !claim.name || claim.name.length > 255
		|| /[\0/\\]/u.test(claim.name) || !Number.isSafeInteger(claim.size)
		|| claim.size < 1 || claim.size > MAXIMUM_VIDEO_BYTES
		|| typeof claim.mimeType !== 'string' || !claim.mimeType.startsWith('video/')
		|| !Number.isSafeInteger(claim.lastModified) || claim.lastModified < 0
		|| !SHA256.test(claim.contentSha256)) throw new TypeError('A watch-import claim is invalid.');
	return Object.freeze({ ...claim });
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 60_000) {
		throw new RangeError(`Invalid ${label}.`);
	}
	return Number(value);
}
