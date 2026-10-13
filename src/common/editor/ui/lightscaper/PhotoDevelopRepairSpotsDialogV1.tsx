/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useRef } from 'react';
import { capturePhotoLibraryRepairSpotsOriginalFrameV1 } from '../../controller/shared/photo-library-repair-spots-authoring-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateV3 } from '../../imaging/image-develop-state-v3.ts';
import ImageRepairSpotsEditorV1 from '../dialogs/ImageRepairSpotsEditorV1.tsx';

export interface PhotoDevelopRepairSpotsDialogPropsV1 {
	readonly photoId: string;
	readonly revision: number;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly original: Readonly<PhotoLibraryDevelopOriginalPortV1>;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateV3>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
/** Photo binding authority stays with the captured native Original adapter. */
export default function PhotoDevelopRepairSpotsDialogV1(props: PhotoDevelopRepairSpotsDialogPropsV1) {
	const latest = useRef(props); latest.current = props;
	const { original, photoId, revision } = props;
	const withOriginalFrame = useMemo(() => capturePhotoLibraryRepairSpotsOriginalFrameV1({ original, photoId, expectedRevision: revision }), [original, photoId, revision]);
	return <ImageRepairSpotsEditorV1 withOriginalFrame={withOriginalFrame} develop={props.develop} locale={props.locale} disabled={props.disabled}
		isCurrent={() => latest.current.original === original && latest.current.photoId === photoId && latest.current.revision === revision && latest.current.isCurrent()}
		onApply={value => { Reflect.apply(props.onApply, props, [value]); }} onClose={() => { Reflect.apply(props.onClose, props, []); }}
		registerRetirement={props.registerRetirement} />;
}
