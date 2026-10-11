/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionSavedFileConnection, type MotionSavedFileConnectionState } from '../motion-saved-file-connection.ts';
import type { MotionSavedFileCapabilities } from '../motion-saved-file-contract.ts';
import type { SuccessorController, SuccessorContext } from './framescaper-composition-link-connection.ts';
interface NativeController {
	readonly project: Readonly<{ id: string }> | null;
	getSnapshot(): Readonly<{ readOnly: boolean }>;
	subscribe: SuccessorController['subscribe'];
}
interface NativeContext { readonly links: Readonly<{ receive(...args: Parameters<SuccessorContext['links']['receive']>): Promise<unknown> }> }
export function framescaperNativeMotionFiles(): MotionSavedFileCapabilities | null {
	const scope = globalThis as typeof globalThis & { framescaperSuccessorDesktop?: { v1?: { motionSavedFiles?: MotionSavedFileCapabilities } } };
	return scope.framescaperSuccessorDesktop?.v1?.motionSavedFiles ?? null;
}
/** Selected native files remain connected while their menu dialog is closed. */
export function createFramescaperNativeCompositionConnection(controller: NativeController, context: NativeContext, files: MotionSavedFileCapabilities) {
	let owner: string | null = null; let source: Readonly<{ projectId: string; compositionId: string }> | null = null; let state: MotionSavedFileConnectionState;
	const listeners = new Set<() => void>();
	const connection = createMotionSavedFileConnection({ files, receive: async (offer, receive) => {
		if (!owner || controller.project?.id !== owner) throw new Error('The receiving project changed. Select the saved composition again.');
		if (source && (source.projectId !== offer.revision.projectId || source.compositionId !== offer.compositionId)) throw new Error('The saved file now names a different project or composition. Disconnect and select it again.');
		await context.links.receive(offer, receive);
		source = Object.freeze({ projectId: offer.revision.projectId, compositionId: offer.compositionId });
	}, onState(next) { state = next; for (const listener of listeners) listener(); } });
	state = connection.state();
	// The connection publishes cleanup failures in its state; keep the capability for explicit retry.
	const unsubscribe = controller.subscribe(() => { if (owner && controller.project?.id !== owner) { owner = null; void connection.disconnect().catch(() => undefined); } });
	return Object.freeze({ snapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async connect() {
			const project = controller.project; if (!project || controller.getSnapshot().readOnly) throw new Error('Open a writable successor project before connecting.');
			owner = project.id; source = null; await connection.connect(); if (state.status === 'disconnected') owner = null;
		},
		async disconnect() { owner = null; await connection.disconnect(); },
		refresh: () => connection.refresh(),
		async dispose() { owner = null; unsubscribe(); await connection.dispose(); listeners.clear(); },
	});
}
