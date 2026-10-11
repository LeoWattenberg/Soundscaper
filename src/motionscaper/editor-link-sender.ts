/* SPDX-License-Identifier: AGPL-3.0-only */
import { openMotionLinkSenderConnection, type MotionLinkSenderConnectionOptions } from '../common/editor/controller/composition/motion-link-connection.ts';
import { createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import type { MotionscaperDocumentSession } from './editor-document-session.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';
type Channel = Awaited<ReturnType<typeof openMotionLinkSenderConnection>>;
export interface MotionscaperLinkSenderState {
	readonly status: 'idle' | 'connecting' | 'sending' | 'connected'; readonly projectId: string | null;
	readonly compositionId: string | null; readonly lastDigest: string | null; readonly error: string | null;
}
/** Observe explicit saved heads; retain one in-flight offer and coalesce subsequent saves to the newest head. */
export function createMotionscaperLinkSender(options: Readonly<{
	session: MotionscaperDocumentSession; store: MotionscaperProjectStore; senderOrigin: string; receiverOrigin: string;
	locale?: 'en' | 'de'; openConnection?: (options: MotionLinkSenderConnectionOptions) => Promise<Channel>;
}>) {
	let state: MotionscaperLinkSenderState = Object.freeze({ status: 'idle', projectId: null, compositionId: null, lastDigest: null, error: null });
	let channel: Channel | null = null, lifetime: AbortController | null = null, generation = 0, pending: string | null = null;
	let draining: Promise<void> | null = null, closing: Promise<void> = Promise.resolve(); let disposed = false;
	const listeners = new Set<() => void>();
	const emit = (patch: Partial<MotionscaperLinkSenderState>) => { state = Object.freeze({ ...state, ...patch }); for (const listener of listeners) listener(); };
	function disconnect(): Promise<void> {
		generation++; lifetime?.abort(); lifetime = null; pending = null; const prior = channel; channel = null;
		emit({ status: 'idle', projectId: null, compositionId: null, lastDigest: null });
		closing = closing.catch(() => undefined).then(async () => { await prior?.dispose(); }); return closing;
	}
	async function fail(error: unknown, token: number): Promise<void> {
		if (token !== generation) return;
		try { await disconnect(); } catch (cleanup) { emit({ error: new AggregateError([error, cleanup], 'Saved composition connection and cleanup failed.', { cause: cleanup }).message }); return; }
		emit({ error: error instanceof Error ? error.message : String(error) });
	}
	function drain(): Promise<void> {
		if (draining) return draining; if (!channel || !pending) return Promise.resolve();
		const token = generation, sender = channel, projectId = state.projectId!, compositionId = state.compositionId!;
		draining = (async () => {
			while (pending && token === generation) {
				const desired = pending; pending = null; const saved = await options.store.load(projectId);
				if (token !== generation) return;
				if (!saved || (saved.digest !== desired && saved.digest !== options.session.getSnapshot().savedDigest)) throw new Error('The saved composition changed in another editor. Reopen its saved revision before reconnecting.');
				if (saved.digest === state.lastDigest) continue;
				emit({ status: 'sending' }); const accepted = await sender.send(createMotionCompositionOffer(compositionId, saved));
				if (token !== generation) return; emit({ status: 'connected', lastDigest: accepted, error: null });
			}
		})().catch(error => fail(error, token)).finally(() => { draining = null; if (pending && channel) void drain(); });
		return draining;
	}
	const unsubscribe = options.session.subscribe(() => {
		if (!state.projectId) return; const snapshot = options.session.getSnapshot();
		if (snapshot.project?.id !== state.projectId) { void disconnect().catch(error => emit({ error: String(error) })); return; }
		if (snapshot.savedDigest && snapshot.savedDigest !== state.lastDigest) { pending = snapshot.savedDigest; void drain(); }
	});
	return Object.freeze({ getSnapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async connect(connectionUrl: string, compositionId: string) {
			if (disposed || state.status !== 'idle') throw new Error('Disconnect the current composition session before connecting again.');
			const document = options.session.getSnapshot(); if (!document.project || !document.savedDigest) throw new Error('Save the composition before connecting.');
			const token = ++generation; lifetime = new AbortController(); const signal = lifetime.signal;
			emit({ status: 'connecting', projectId: document.project.id, compositionId, lastDigest: null, error: null }); pending = document.savedDigest;
			try {
				// Open synchronously from the explicit dialog button before awaiting any saved bytes.
				const opened = await (options.openConnection ?? openMotionLinkSenderConnection)({ senderOrigin: options.senderOrigin, receiverOrigin: options.receiverOrigin, connectionUrl,
					readAsset: asset => options.store.readAsset(asset), locale: options.locale, signal });
				if (token !== generation) { await opened.dispose(); return; } channel = opened;
				void opened.closed.then(() => { if (token === generation) return disconnect(); }).catch(error => fail(error, token)); await drain();
			} catch (error) { await fail(error, token); }
		},
		disconnect,
		async settled() { await draining; await closing; },
		async dispose() { if (disposed) return; disposed = true; unsubscribe(); try { await disconnect(); } finally { try { await draining; } finally { listeners.clear(); } } },
	});
}
export type MotionscaperLinkSender = ReturnType<typeof createMotionscaperLinkSender>;
