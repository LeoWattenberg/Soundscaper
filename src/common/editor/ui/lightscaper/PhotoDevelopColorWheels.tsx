/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';
import type { VideoEffectLeaf } from '../../project-media-types.ts';
import type { PhotoLibraryDevelopWorkflowV1 } from '../../controller/shared/photo-library-develop-workflow-v1.ts';
import VideoColorWheelsControls, { type VideoColorWheelGroupV1 } from '../inspector/VideoColorWheelsControls.tsx';

/** Each live gesture follows only its own preview array. External replacement
 * retires its authority; captured settlement can still finish after rerenders. */
export default function PhotoDevelopColorWheels(props: Readonly<{ effect: VideoEffectLeaf; effects: readonly VideoEffectLeaf[];
	owner: PhotoLibraryDevelopWorkflowV1; copy: Readonly<Record<string, string>>; disabled: boolean; isCurrent: () => boolean }>) {
	const { owner, effect, effects } = props;
	const gestures = useRef(new Map<VideoColorWheelGroupV1, { readonly original: readonly VideoEffectLeaf[]; expected: readonly VideoEffectLeaf[] }>());
	const restored = useRef<{ readonly from: readonly VideoEffectLeaf[]; readonly to: readonly VideoEffectLeaf[] } | null>(null);
	if (restored.current?.from !== effects) restored.current = null;
	const current = () => {
		if (props.disabled || !props.isCurrent()) return false;
		const value = owner.snapshot().draft?.effects;
		return value === effects || (restored.current?.from === effects && value === restored.current.to);
	};
	const settle = (group: VideoColorWheelGroupV1, cancel: boolean) => {
		const gesture = gestures.current.get(group); gestures.current.delete(group);
		if (gesture && props.isCurrent() && owner.snapshot().draft?.effects === gesture.expected) {
			if (cancel) {
				owner.cancelGesture();
				// The same pointerdown may continue after its numeric cancellation.
				// Borrow only the exact restored original, never a foreign replacement.
				if (owner.snapshot().draft?.effects === gesture.original) restored.current = { from: gesture.expected, to: gesture.original };
			} else owner.commitGesture();
		}
	};
	return <VideoColorWheelsControls params={effect.params} copy={props.copy} disabled={props.disabled} isCurrent={current}
		onBegin={group => { if (current()) { const original = owner.snapshot().draft!.effects; owner.beginGesture(); gestures.current.set(group, { original, expected: original }); } }}
		onPreview={(group, params) => { const gesture = gestures.current.get(group); if (current() && gesture) {
			owner.previewEffect(effect.id, params); const next = owner.snapshot().draft?.effects; if (next) gesture.expected = next;
		} }} onCommit={group => { settle(group, false); }} onCancel={group => { settle(group, true); }} />;
}
