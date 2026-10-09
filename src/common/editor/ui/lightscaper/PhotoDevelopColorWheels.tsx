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
	const gestures = useRef(new Map<VideoColorWheelGroupV1, readonly VideoEffectLeaf[]>());
	const current = () => !props.disabled && props.isCurrent() && owner.snapshot().draft?.effects === effects;
	const settle = (group: VideoColorWheelGroupV1, cancel: boolean) => {
		const expected = gestures.current.get(group); gestures.current.delete(group);
		if (expected && props.isCurrent() && owner.snapshot().draft?.effects === expected) {
			if (cancel) owner.cancelGesture(); else owner.commitGesture();
		}
	};
	return <VideoColorWheelsControls params={effect.params} copy={props.copy} disabled={props.disabled} isCurrent={current}
		onBegin={group => { if (current()) { owner.beginGesture(); gestures.current.set(group, effects); } }}
		onPreview={(group, params) => { if (current() && gestures.current.has(group)) {
			owner.previewEffect(effect.id, params); const next = owner.snapshot().draft?.effects; if (next) gestures.current.set(group, next);
		} }} onCommit={group => { settle(group, false); }} onCancel={group => { settle(group, true); }} />;
}
