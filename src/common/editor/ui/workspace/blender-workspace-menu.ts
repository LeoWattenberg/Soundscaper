/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveAudioEditorDesktopBridge } from '../../file-service.js';
import { resolveBlenderCopy } from '../../../i18n/editor-blender-copy.ts';
import type { BlenderBridge } from '../../blender-contract.ts';
import type { BlenderSessionController, createBlenderLiveSession } from '../../controller/export/blender-live-session.ts';
import type { BlenderMenuPort } from '../blender-application-menu.ts';

interface Controller extends Pick<BlenderSessionController, 'getSnapshot' | 'subscribe'> {
	readonly actions: { readonly export: { readonly publishBlenderTracks: BlenderSessionController['publish'] } };
}
type Session = ReturnType<typeof createBlenderLiveSession>;
interface Entry { session: Session | null; pending: Promise<Session> | null; busy: boolean; disposed: boolean }
const sessions = new WeakMap<Controller, Entry>();

export function createBlenderWorkspaceMenuPort(input: Readonly<{
	controller: Controller;
	productId: string;
	fileService: { readonly isDesktop: boolean };
	copy: Readonly<Record<string, unknown>>;
	run(action: () => unknown): unknown;
}>): BlenderMenuPort | null {
	if (!input.fileService.isDesktop || input.productId !== 'soundscaper') return null;
	const bridge = (resolveAudioEditorDesktopBridge() as { blender?: BlenderBridge } | null)?.blender;
	if (!bridge) return null;
	let entry = sessions.get(input.controller);
	if (!entry) { entry = { session: null, pending: null, busy: false, disposed: false }; sessions.set(input.controller, entry); }
	const current = entry;
	const copy = resolveBlenderCopy(input.copy);
	const load = () => {
		current.pending ??= import('../../controller/export/blender-live-session.ts').then(({ createBlenderLiveSession }) => {
			const session = createBlenderLiveSession({ bridge,
				getSnapshot: () => input.controller.getSnapshot(),
				subscribe: (listener) => input.controller.subscribe(listener),
				publish: (request) => input.controller.actions.export.publishBlenderTracks(request),
				onError: (error) => { input.run(() => { throw error; }); },
			});
			current.session = session;
			return session;
		}).catch((error: unknown) => { current.pending = null; throw error; });
		return current.pending;
	};
	const execute = (action: (session: Session) => Promise<string | undefined>) => input.run(async () => {
		if (current.busy || current.disposed) return;
		current.busy = true;
		let notice: string | undefined;
		try {
			const session = await load();
			if (!current.disposed) notice = await action(session);
		}
		finally { current.busy = false; }
		if (notice && !current.disposed) globalThis.alert?.(notice);
	});
	return {
		active: () => current.session?.active() === true,
		busy: () => current.busy,
		exportTracks: () => execute(async (session) => await session.export() ? copy.exportReady : undefined),
		toggleLiveSync: () => current.session?.active()
			? input.run(() => current.session?.stop())
			: execute(async (session) => await session.start() ? copy.syncReady : undefined),
	};
}

export function disposeBlenderWorkspaceSession(controller: Controller): void {
	const entry = sessions.get(controller);
	if (!entry) return;
	entry.disposed = true;
	sessions.delete(controller);
	void entry.session?.dispose().catch(() => undefined);
	void entry.pending?.then((session) => session.dispose()).catch(() => undefined);
}
