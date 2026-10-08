/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BlenderBridge } from '../../blender-contract.ts';
import type { BlenderPublishRequest } from './blender-publication.ts';

interface ProjectRevision { readonly id: string; readonly revision: number }
export interface BlenderSessionController {
	getSnapshot(): { readonly project: ProjectRevision | null; readonly disposed?: boolean };
	subscribe(listener: () => void): () => void;
	publish(request: BlenderPublishRequest): Promise<{ readonly revision: number }>;
}
export interface BlenderLiveSessionRuntime extends BlenderSessionController {
	readonly bridge: BlenderBridge;
	onError(error: unknown): void;
	schedule?(callback: () => void): () => void;
}

/** One selected project owns the connection; edits coalesce while complete publications remain serialized. */
export function createBlenderLiveSession(runtime: BlenderLiveSessionRuntime) {
	let session: { readonly id: string; readonly projectId: string; revision: number } | null = null;
	let unsubscribe: (() => void) | null = null;
	let cancelTimer: (() => void) | null = null;
	let abort: AbortController | null = null;
	let work: Promise<void> | null = null;
	let exportWork: Promise<boolean> | null = null;
	let exportAbort: AbortController | null = null;
	let requested = false;
	let disposed = false;
	let selecting = false;
	const schedule = runtime.schedule ?? ((callback: () => void) => {
		const timer = setTimeout(callback, 250);
		return () => clearTimeout(timer);
	});
	const report = (error: unknown) => { runtime.onError(error); };
	async function publish() {
		requested = true;
		if (work) return await work;
		work = (async () => {
			while (requested && session) {
				requested = false;
				const owner = session;
				const snapshot = runtime.getSnapshot();
				if (snapshot.disposed || snapshot.project?.id !== owner.projectId) return;
				const currentAbort = new AbortController();
				abort = currentAbort;
				try {
					await runtime.publish({ bridge: runtime.bridge, sessionId: owner.id, projectId: owner.projectId,
						revision: snapshot.project.revision, signal: currentAbort.signal });
				} catch (error) {
					if (!currentAbort.signal.aborted && session === owner) throw error;
				} finally { if (abort === currentAbort) abort = null; }
			}
		})().finally(() => { work = null; });
		return await work;
	}
	async function stop() {
		const owner = session;
		session = null;
		requested = false;
		unsubscribe?.(); unsubscribe = null;
		cancelTimer?.(); cancelTimer = null;
		abort?.abort();
		await work?.catch(() => undefined);
		if (owner) await runtime.bridge.stop({ sessionId: owner.id });
	}
	function changed() {
		if (!session) return;
		const snapshot = runtime.getSnapshot();
		if (snapshot.disposed || snapshot.project?.id !== session.projectId) {
			void stop().catch(report);
			return;
		}
		if (snapshot.project.revision === session.revision) return;
		session.revision = snapshot.project.revision;
		abort?.abort();
		cancelTimer?.();
		cancelTimer = schedule(() => {
			cancelTimer = null;
			void publish().catch((error: unknown) => { report(error); void stop().catch(report); });
		});
	}
	return {
		active: () => session !== null,
		async start(): Promise<boolean> {
			if (disposed) throw new Error('The Blender session has been disposed.');
			if (session || selecting || exportWork) return false;
			const project = runtime.getSnapshot().project;
			if (!project) throw new Error('Blender sync requires an open project.');
			selecting = true;
			try {
				const selected = await runtime.bridge.select({ live: true });
				if (!selected) return false;
				const current = runtime.getSnapshot();
				if (disposed || current.disposed || current.project?.id !== project.id) {
					await runtime.bridge.stop(selected);
					return false;
				}
				session = { id: selected.sessionId, projectId: project.id, revision: current.project.revision };
				unsubscribe = runtime.subscribe(changed);
				try { await publish(); }
				catch (error) { await stop(); throw error; }
				return session !== null;
			} finally { selecting = false; }
		},
		stop,
		export(): Promise<boolean> {
			if (disposed) throw new Error('The Blender session has been disposed.');
			if (selecting || session || exportWork) return Promise.resolve(false);
			const project = runtime.getSnapshot().project;
			if (!project) throw new Error('Blender export requires an open project.');
			const currentAbort = new AbortController();
			exportAbort = currentAbort;
			exportWork = (async () => {
				const selected = await runtime.bridge.select({ live: false });
				if (!selected) return false;
				try {
					const current = runtime.getSnapshot();
					if (disposed || current.disposed || currentAbort.signal.aborted || current.project?.id !== project.id) return false;
					await runtime.publish({ bridge: runtime.bridge, sessionId: selected.sessionId,
						projectId: project.id, revision: current.project.revision, signal: currentAbort.signal });
					return !currentAbort.signal.aborted;
				} finally { await runtime.bridge.stop(selected); }
			})().finally(() => { exportWork = null; exportAbort = null; });
			return exportWork;
		},
		async dispose() {
			disposed = true;
			exportAbort?.abort();
			await stop();
			await exportWork?.catch(() => undefined);
		},
	};
}
