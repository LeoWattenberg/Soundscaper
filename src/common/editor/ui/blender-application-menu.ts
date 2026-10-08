/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveBlenderCopy } from '../../i18n/editor-blender-copy.ts';

export interface BlenderMenuPort {
	active(): boolean;
	busy(): boolean;
	exportTracks(): unknown;
	toggleLiveSync(): unknown;
}

/** Blender connection controls remain opt-in entries in the existing menus. */
export function createBlenderApplicationMenuItems(port: BlenderMenuPort | null, context: Readonly<{
	copy: Readonly<Record<string, unknown>>;
	blocked: boolean;
	materialAvailable: boolean;
}>) {
	if (!port) return { file: [], tools: [] };
	const copy = resolveBlenderCopy(context.copy);
	const resolveExport = () => ({ disabled: context.blocked || !context.materialAvailable || port.busy() || port.active() });
	const resolveStart = () => ({ disabled: port.busy() || port.active() || context.blocked || !context.materialAvailable });
	const resolveStop = () => ({ disabled: !port.active() });
	return {
		file: [{ id: 'blender-export-tracks', label: copy.exportTracks, preserveLabel: true,
			...resolveExport(), resolve: resolveExport,
			onClick: () => { if (!resolveExport().disabled) return port.exportTracks(); return undefined; } }],
		tools: [{ id: 'blender-start-live-sync', label: copy.startSync, preserveLabel: true, ...resolveStart(), resolve: resolveStart,
			onClick: () => { if (!resolveStart().disabled) return port.toggleLiveSync(); return undefined; } },
			{ id: 'blender-stop-live-sync', label: copy.stopSync, preserveLabel: true, ...resolveStop(), resolve: resolveStop,
				onClick: () => { if (!resolveStop().disabled) return port.toggleLiveSync(); return undefined; } }],
	};
}
