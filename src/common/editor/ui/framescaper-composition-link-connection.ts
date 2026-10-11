/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLinkReceiverConnection, type MotionLinkReceiverConnection } from '../controller/composition/motion-link-connection.ts';
import { resolveMotionLinkOrigins } from '../motion-link-connection-urls.ts';
import type { createFramescaperSuccessorController, framescaperSuccessorControllerContext } from '../../../framescaper/editor-successor-controller.ts';
export type SuccessorController = ReturnType<typeof createFramescaperSuccessorController>;
export type SuccessorContext = ReturnType<typeof framescaperSuccessorControllerContext>;
interface State { readonly status: 'idle' | 'pending' | 'ready' | 'received'; readonly url: string | null; readonly error: string | null }
/** A pairing belongs to the selected owner for its lifetime, including while its dialog is closed. */
export function createFramescaperCompositionConnection(controller: SuccessorController, context: SuccessorContext) {
	let connection: MotionLinkReceiverConnection | null = null, owner: string | null = null;
	let state: State = Object.freeze({ status: 'idle', url: null, error: null }); const listeners = new Set<() => void>();
	const emit = (patch: Partial<State>) => { state = Object.freeze({ ...state, ...patch }); for (const listener of listeners) listener(); };
	const disconnect = () => { const prior = connection; connection = null; owner = null; prior?.dispose(); emit({ status: 'idle', url: null, error: null }); };
	const unsubscribe = controller.subscribe(() => { if (owner && controller.project?.id !== owner) disconnect(); });
	return Object.freeze({ snapshot: () => state, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, disconnect,
		connect() {
			disconnect(); const project = controller.project; if (!project || controller.getSnapshot().readOnly) throw new Error('Open a writable successor project before connecting.');
			owner = project.id; const origins = resolveMotionLinkOrigins('framescaper', location.origin, import.meta.env.PUBLIC_MOTION_LINK_PEER_ORIGIN);
			const current = createMotionLinkReceiverConnection({ ...origins, receive: async (offer, receive) => {
				if (connection !== current || controller.project?.id !== owner) throw new Error('The receiving project changed. Create a new pairing URL.');
				await context.links.receive(offer, receive); emit({ status: 'received', error: null });
			} }); connection = current; emit({ status: 'pending', url: current.url, error: null });
			void current.ready.then(() => { if (connection === current) emit({ status: 'ready' }); }).catch(() => undefined);
			void current.completion.then(() => { if (connection === current) disconnect(); }).catch((error: unknown) => {
				if (connection !== current) return; disconnect(); emit({ error: error instanceof Error ? error.message : String(error) });
			});
		},
		dispose() { disconnect(); unsubscribe(); listeners.clear(); },
	});
}
