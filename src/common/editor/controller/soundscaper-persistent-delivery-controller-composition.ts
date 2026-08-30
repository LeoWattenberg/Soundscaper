/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DeliveryReport } from '../delivery-report.ts';
import type { SoundscaperDeliveryProjectIdentityV1 } from '../soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentDeliveryUiService,
	type SoundscaperPersistentDeliveryRendererBridge,
} from './soundscaper-persistent-delivery-ui-service.ts';
import {
	createSoundscaperPersistentDeliveryPrivateTransport,
	type SoundscaperPersistentDeliveryPrivateTransport,
} from './soundscaper-persistent-delivery-private-transport.ts';
import { createSoundscaperPersistentDeliveryWorker } from './soundscaper-persistent-delivery-worker.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface PersistentExportService {
	persistentAudioDeliveryAvailable(): Awaitable<boolean>;
	whenPersistentAudioDeliveryAvailable(): Awaitable<void>;
	derivePersistentAudioDeliveryPlan(settings: Readonly<Record<string, unknown>>): PromiseLike<Readonly<{
		settings: Readonly<Record<string, unknown>>;
		exportPlan: Readonly<Record<string, unknown>>;
	}>>;
	executePersistentAudioDeliveryPlan(value: Readonly<Record<string, unknown>>): PromiseLike<unknown>;
}

export interface SoundscaperPersistentDeliveryControllerRuntime {
	readonly productId?: string;
	readonly bridge: (SoundscaperPersistentDeliveryRendererBridge & Readonly<Record<string, unknown>>) | null;
	readonly workerTransport?: SoundscaperPersistentDeliveryPrivateTransport;
	readonly exportService: PersistentExportService;
	readonly getProject: () => Readonly<{ id?: unknown; revision?: unknown; title?: unknown }> | null | undefined;
	readonly getSaveState: () => unknown;
	readonly captureProjectGeneration: () => unknown;
	readonly assertProjectGeneration: (token: unknown) => void;
	readonly deliveryReport: () => DeliveryReport | null;
	readonly cancelExport?: () => Awaitable<unknown>;
	readonly publishDocumentSnapshot?: () => void;
	readonly subscribe?: (listener: () => void) => (() => void);
	readonly onBackgroundError?: (error: unknown) => void;
}

/** Soundscaper-desktop-only composition for the menu-owned durable queue. */
export function createSoundscaperPersistentDeliveryControllerComposition(
	runtime: SoundscaperPersistentDeliveryControllerRuntime,
) {
	if (!runtime?.bridge || (runtime.productId !== undefined && runtime.productId !== 'soundscaper')) return null;
	if (!runtime.exportService || typeof runtime.getProject !== 'function'
		|| typeof runtime.getSaveState !== 'function' || typeof runtime.deliveryReport !== 'function'
		|| typeof runtime.captureProjectGeneration !== 'function'
		|| typeof runtime.assertProjectGeneration !== 'function') {
		throw new TypeError('Persistent delivery controller composition requires exact project and export seams.');
	}
	const bridge = runtime.bridge as unknown as SoundscaperPersistentDeliveryRendererBridge
		& Parameters<typeof createSoundscaperPersistentDeliveryWorker>[0]['bridge'];
	const managedBridge = Object.freeze({
		...bridge,
		async currentProjectIdentity(request: Readonly<{ projectId: string | null }>) {
			if (request.projectId === null) return bridge.currentProjectIdentity({ projectId: null });
			const project = runtime.getProject();
			if (!project || runtime.getSaveState() !== 'saved' || project.id !== request.projectId
				|| !Number.isSafeInteger(project.revision) || Number(project.revision) < 0
				|| typeof project.title !== 'string' || !project.title.trim()) {
				await bridge.currentProjectIdentity({ projectId: null });
				return null;
			}
			const persisted = await bridge.currentProjectIdentity({ projectId: request.projectId });
			if (persisted?.projectId === request.projectId
				&& persisted.projectRevision === Number(project.revision)) return persisted;
			await bridge.currentProjectIdentity({ projectId: null });
			return null;
		},
	});
	const workerTransport = runtime.workerTransport
		?? createSoundscaperPersistentDeliveryPrivateTransport();
	const ui = createSoundscaperPersistentDeliveryUiService({
		bridge: managedBridge,
		getProject: runtime.getProject,
		getSaveState: runtime.getSaveState,
		captureProjectGeneration: runtime.captureProjectGeneration,
		assertProjectGeneration: runtime.assertProjectGeneration,
		describeMember: ({ settings }) => runtime.exportService.derivePersistentAudioDeliveryPlan(settings),
		publishDocumentSnapshot: runtime.publishDocumentSnapshot,
	});
	const worker = createSoundscaperPersistentDeliveryWorker({
		bridge: managedBridge,
		workerTransport,
		exportService: runtime.exportService,
		currentProjectIdentity,
		deliveryReport: runtime.deliveryReport,
		cancelExport: runtime.cancelExport,
		onChange: () => { background(ui.refresh()); runtime.publishDocumentSnapshot?.(); },
	});
	let projectToken = openProjectToken(runtime);
	let disposed = false;
	let authorityTransition: Promise<void> = Promise.resolve();
	const background = (operation: PromiseLike<unknown>): void => {
		void Promise.resolve(operation).catch((error: unknown) => runtime.onBackgroundError?.(error));
	};
	const transitionProjectAuthority = async (): Promise<void> => {
		await managedBridge.currentProjectIdentity({ projectId: null });
		await worker.projectChanged();
		await synchronizeOpenProject();
		await ui.refresh();
		await worker.wake();
	};
	const unsubscribe = runtime.subscribe?.(() => {
		const next = openProjectToken(runtime);
		if (next === projectToken) return;
		projectToken = next;
		authorityTransition = authorityTransition.then(
			transitionProjectAuthority, transitionProjectAuthority,
		);
		background(authorityTransition);
	}) ?? (() => undefined);
	const startupAuthority = synchronizeOpenProject();
	const ready = startupAuthority.then(() => ui.refresh()).then(() => worker.wake());
	background(ready);

	async function currentProjectIdentity(): Promise<SoundscaperDeliveryProjectIdentityV1 | null> {
		return synchronizeOpenProject();
	}

	async function synchronizeOpenProject(): Promise<SoundscaperDeliveryProjectIdentityV1 | null> {
		const project = runtime.getProject();
		if (!project || runtime.getSaveState() !== 'saved' || typeof project.id !== 'string'
			|| !project.id || !Number.isSafeInteger(project.revision) || Number(project.revision) < 0
			|| typeof project.title !== 'string' || !project.title.trim()) {
			await managedBridge.currentProjectIdentity({ projectId: null });
			return null;
		}
		return managedBridge.currentProjectIdentity({ projectId: project.id });
	}

	const queue = Object.freeze({
		...ui,
		async enqueueBatch(...args: Parameters<typeof ui.enqueueBatch>) {
			const result = await ui.enqueueBatch(...args); await worker.wake(); return result;
		},
		async resume() { await ui.resume(); await worker.wake(); },
		async retry(...args: Parameters<typeof ui.retry>) { await ui.retry(...args); await worker.wake(); },
		async retryBatchFailures(...args: Parameters<typeof ui.retryBatchFailures>) {
			const result = await ui.retryBatchFailures(...args); await worker.wake(); return result;
		},
		async reauthorizeDestination(...args: Parameters<typeof ui.reauthorizeDestination>) {
			const result = await ui.reauthorizeDestination(...args); await worker.wake(); return result;
		},
		async cancel(...args: Parameters<typeof ui.cancel>) {
			await worker.cancelJob(args[0]);
			await ui.cancel(...args);
			await worker.wake();
		},
	});

	return Object.freeze({
		queue,
		ready,
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			await startupAuthority.catch(() => undefined);
			await authorityTransition.catch(() => undefined);
			await managedBridge.currentProjectIdentity({ projectId: null }).catch(() => undefined);
			await worker.dispose();
		},
	});
}

function openProjectToken(runtime: Pick<SoundscaperPersistentDeliveryControllerRuntime, 'getProject' | 'getSaveState'>): string {
	const project = runtime.getProject();
	return project && typeof project.id === 'string'
		? `${String(runtime.getSaveState())}:${project.id}:${String(project.revision)}` : 'none';
}
