/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useState } from 'react';
import { TrackCrossfadeVisual } from '@soundscaper/design-system/Track/TrackCrossfadeVisual';
import { CROSSFADE_SHAPE_PRESETS, selectedCrossfadeShapePreset } from '../../clip-fade-presets.ts';
import { crossfadeShapesAtKey, crossfadeShapesChanged } from './crossfade-visual-geometry.ts';
import { FadeShapeMenu, isFadeShapeMenuKey, keyboardFadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import type { FadeShapeMenuCopy, FadeShapeMenuPosition } from './FadeShapeMenu.tsx';

interface CrossfadeOverlay {
	readonly id: string;
	readonly left: number;
	readonly width: number;
	readonly outgoingPath: string;
	readonly incomingPath: string;
	readonly intersectionPosition: number;
	readonly intersectionGain: number;
	readonly minimumPosition: number;
	readonly maximumPosition: number;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly label: string;
}

interface CrossfadeClip {
	readonly id: string;
	readonly fadeOutShape?: number;
	readonly fadeInShape?: number;
}

interface Props {
	readonly overlays: readonly CrossfadeOverlay[];
	readonly clipLookup: ReadonlyMap<string, CrossfadeClip>;
	readonly selectedIds: ReadonlySet<string>;
	readonly top: number;
	readonly height: number;
	readonly blocked: boolean;
	readonly copy: FadeShapeMenuCopy;
	readonly controller: { readonly actions: { readonly edit: { commit(command: unknown): unknown } } };
	readonly run: (operation: () => unknown) => unknown;
	readonly onTabOut: (index: number, backwards: boolean) => void;
}

export function CrossfadeOverlays({
	overlays, clipLookup, selectedIds, top, height, blocked, copy, controller, run, onTabOut,
}: Props) {
	const [menu, setMenu] = useState<(FadeShapeMenuPosition & { readonly overlayId: string }) | null>(null);
	const close = useCallback(() => setMenu(null), []);
	const activeOverlay = menu && overlays.find(overlay => overlay.id === menu.overlayId);
	const outgoing = activeOverlay && clipLookup.get(activeOverlay.outgoingClipId);
	const incoming = activeOverlay && clipLookup.get(activeOverlay.incomingClipId);
	const commit = (overlay: CrossfadeOverlay, shapes: Readonly<{ outShape: number; inShape: number }>) => {
		if (blocked) return;
		const outClip = clipLookup.get(overlay.outgoingClipId);
		const inClip = clipLookup.get(overlay.incomingClipId);
		if (!outClip || !inClip || !crossfadeShapesChanged(outClip.fadeOutShape ?? 1, inClip.fadeInShape ?? 1, shapes)) return;
		run(() => controller.actions.edit.commit({
			type: 'batch',
			commands: [
				{ type: 'clip/update', clipId: outClip.id, changes: { fadeOutShape: shapes.outShape } },
				{ type: 'clip/update', clipId: inClip.id, changes: { fadeInShape: shapes.inShape } },
			],
		}));
	};
	return <>
		{overlays.map((overlay, index) => <div key={overlay.id} style={{ display: 'contents' }}
			onContextMenu={event => {
				const target = (event.target as Element).closest<HTMLElement>('[data-crossfade-handle]');
				if (!target) return;
				event.preventDefault();
				event.stopPropagation();
				if (blocked) return;
				target.focus({ preventScroll: true });
				setMenu({ target, x: event.clientX, y: event.clientY, overlayId: overlay.id });
			}}
			onKeyDown={event => {
				if (!isFadeShapeMenuKey(event) || blocked) return;
				const target = (event.target as Element).closest<HTMLElement>('[data-crossfade-handle]');
				if (!target) return;
				event.preventDefault();
				event.stopPropagation();
				setMenu({ ...keyboardFadeShapeMenuPosition(target), overlayId: overlay.id });
			}}>
			<TrackCrossfadeVisual left={overlay.left} top={top} width={overlay.width} height={height}
				outgoingPath={overlay.outgoingPath} incomingPath={overlay.incomingPath}
				intersectionPosition={overlay.intersectionPosition} intersectionGain={overlay.intersectionGain}
				minimumPosition={overlay.minimumPosition} maximumPosition={overlay.maximumPosition}
				outgoingClipId={overlay.outgoingClipId} incomingClipId={overlay.incomingClipId}
				outgoingSelected={selectedIds.has(overlay.outgoingClipId)} incomingSelected={selectedIds.has(overlay.incomingClipId)}
				label={overlay.label} disabled={blocked}
				onKeyboardAdjust={(key, fine) => {
					const shapes = crossfadeShapesAtKey({
						key, shiftKey: fine, initialPosition: overlay.intersectionPosition,
						initialGain: overlay.intersectionGain, width: overlay.width, height,
					});
					if (shapes) commit(overlay, shapes);
				}}
				onTabOut={backwards => onTabOut(index, backwards)} />
		</div>)}
		{menu && activeOverlay && outgoing && incoming && !blocked && <FadeShapeMenu
			position={menu} presets={CROSSFADE_SHAPE_PRESETS} copy={copy}
			selectedId={selectedCrossfadeShapePreset(outgoing.fadeOutShape, incoming.fadeInShape)}
			onClose={close} onSelect={preset => {
				if (preset.shape !== undefined) commit(activeOverlay, { outShape: preset.shape, inShape: preset.shape });
			}} />}
	</>;
}
