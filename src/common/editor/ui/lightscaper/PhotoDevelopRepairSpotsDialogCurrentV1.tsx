/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useRef } from 'react';
import { capturePhotoLibraryRepairSpotsOriginalFrameV1 } from '../../controller/shared/photo-library-repair-spots-authoring-v1.ts';
import type { PhotoDevelopRepairSpotsDialogPropsV1 } from './PhotoDevelopRepairSpotsDialogV1.tsx';
import ImageRepairSpotsEditorV1 from '../dialogs/ImageRepairSpotsEditorV1.tsx';

/** Current Workspace opts into native Original processing explicitly. */
export default function PhotoDevelopRepairSpotsDialogCurrentV1(props: PhotoDevelopRepairSpotsDialogPropsV1) {
	const latest = useRef(props); latest.current = props;
	const { original, photoId, revision } = props;
	const withOriginalFrame = useMemo(() => capturePhotoLibraryRepairSpotsOriginalFrameV1({ original, photoId, expectedRevision: revision }), [original, photoId, revision]);
	return <ImageRepairSpotsEditorV1 nativeCurrent withOriginalFrame={withOriginalFrame} develop={props.develop} locale={props.locale} disabled={props.disabled}
		isCurrent={() => latest.current.original === original && latest.current.photoId === photoId && latest.current.revision === revision && latest.current.isCurrent()}
		onApply={value => { Reflect.apply(props.onApply, props, [value]); }} onClose={() => { Reflect.apply(props.onClose, props, []); }}
		registerRetirement={props.registerRetirement} />;
}
