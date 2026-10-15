/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from '../../controller/shared/image-repair-spots-authoring-v1.ts';
import ImageRepairSpotsEditorV1 from './ImageRepairSpotsEditorV1.tsx';
import FramescaperImageDevelopMaskEditorV1 from './FramescaperImageDevelopMaskEditorV1.tsx';
import type { WithImageDevelopDraftFrameV1 } from '../../controller/shared/image-develop-draft-presentation-v1.ts';
import type { ImageBrushMaskResourceAcknowledgementV1, ImageBrushMaskResourcePortV1, WithImageBrushMaskDraftFrameV1 } from '../../image-brush-mask-resource-port-v1.ts';
import FramescaperImageBrushMaskEditorV1 from './FramescaperImageBrushMaskEditorV1.tsx';

export interface FramescaperImageDevelopDialogPropsV1 {
	readonly nativeCurrent?: true;
	readonly kind: 'repairs' | 'masks' | 'brush';
	readonly develop: ImageDevelopStateCurrentV1;
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	readonly withDraftFrame?: WithImageDevelopDraftFrameV1;
	readonly brushMasks?: Readonly<ImageBrushMaskResourcePortV1<ImageBrushMaskResourceAcknowledgementV1 & { readonly projectId: string }> & { readonly projectId: string }>;
	readonly withBrushDraftFrame?: WithImageBrushMaskDraftFrameV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateCurrentV1>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
/** Menu-selected editors hold a local draft; the caller owns publication. */
export default function FramescaperImageDevelopDialogV1(props: FramescaperImageDevelopDialogPropsV1) {
	if (props.kind !== 'repairs' && props.kind !== 'masks' && props.kind !== 'brush') throw new TypeError('Unknown Frame image editor.');
	const apply = (value: Readonly<ImageDevelopStateCurrentV1>) => {
		const before = props.develop.processVersion === 3 ? props.develop.repairs.spots : [];
		const after = value.processVersion === 3 ? value.repairs.spots : [];
		const develop = props.kind === 'repairs' && JSON.stringify(before) === JSON.stringify(after) ? props.develop : value;
		Reflect.apply(props.onApply, props, [develop]);
	};
	const close = () => { Reflect.apply(props.onClose, props, []); };
	if (props.kind === 'brush') {
		if (!props.brushMasks) throw new TypeError('Frame brush authoring requires its native resource owner.');
		return <FramescaperImageBrushMaskEditorV1 port={props.brushMasks} develop={props.develop} locale={props.locale} disabled={props.disabled}
			withBrushDraftFrame={props.withBrushDraftFrame} isCurrent={props.isCurrent} onApply={apply} onClose={close} registerRetirement={props.registerRetirement} />;
	}
	return props.kind === 'repairs'
		? <ImageRepairSpotsEditorV1 develop={props.develop} withOriginalFrame={props.withOriginalFrame} locale={props.locale} disabled={props.disabled} nativeCurrent={props.nativeCurrent}
			isCurrent={props.isCurrent} onApply={apply} onClose={close} registerRetirement={props.registerRetirement} />
		: <FramescaperImageDevelopMaskEditorV1 develop={props.develop} locale={props.locale} disabled={props.disabled} withDraftFrame={props.withDraftFrame}
			isCurrent={props.isCurrent} onApply={apply} onClose={close} registerRetirement={props.registerRetirement} />;
}
