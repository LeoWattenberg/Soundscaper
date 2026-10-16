/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	BLENDER_CHANNELS, validateBlenderBegin, validateBlenderPublication,
	validateBlenderSelect, validateBlenderSession, validateBlenderWrite,
} from '../src/common/editor/blender-contract.ts';
import { BlenderExportStore } from './blender-export-store.ts';

export interface BlenderIpcOptions {
	handle(channel: string, listener: (event: unknown, value: unknown) => Promise<unknown>): void;
	removeHandler?(channel: string): void;
	ownerFor(event: unknown): object;
	isOwnerCurrent(owner: object): boolean;
	windowFor(event: unknown): unknown;
	dialog: {
		showOpenDialog(window: unknown, options: {
			title: string; properties: ['openDirectory', 'createDirectory'];
		}): Promise<{ canceled: boolean; filePaths: string[] }>;
	};
	addonPath?: string;
}

/** The renderer receives only owner-bound IDs; directory authority comes from a native chooser. */
export function registerBlenderIpc(options: BlenderIpcOptions): {
	revokeOwner(owner: object): Promise<void>;
	dispose(): Promise<void>;
} {
	const store = new BlenderExportStore(options);
	let disposed = false;
	options.handle(BLENDER_CHANNELS.select, async (event, value) => {
		const request = validateBlenderSelect(value);
		const owner = options.ownerFor(event);
		if (disposed || !options.isOwnerCurrent(owner)) throw new Error('Blender renderer owner is no longer current');
		const selected = await options.dialog.showOpenDialog(options.windowFor(event), {
			title: request.live ? 'Connect project to Blender' : 'Export project to Blender',
			properties: ['openDirectory', 'createDirectory'],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return store.create(owner, selected.filePaths[0], request.live);
	});
	options.handle(BLENDER_CHANNELS.begin, async (event, value) => store.begin(options.ownerFor(event), validateBlenderBegin(value)));
	options.handle(BLENDER_CHANNELS.write, async (event, value) => store.write(options.ownerFor(event), validateBlenderWrite(value)));
	options.handle(BLENDER_CHANNELS.commit, async (event, value) => store.commit(options.ownerFor(event), validateBlenderPublication(value)));
	options.handle(BLENDER_CHANNELS.abort, async (event, value) => store.abort(options.ownerFor(event), validateBlenderPublication(value)));
	options.handle(BLENDER_CHANNELS.stop, async (event, value) => store.stop(options.ownerFor(event), validateBlenderSession(value).sessionId));
	return {
		revokeOwner: (owner) => store.revokeOwner(owner),
		async dispose() {
			if (disposed) return;
			disposed = true;
			for (const channel of Object.values(BLENDER_CHANNELS)) options.removeHandler?.(channel);
			await store.dispose();
		},
	};
}
