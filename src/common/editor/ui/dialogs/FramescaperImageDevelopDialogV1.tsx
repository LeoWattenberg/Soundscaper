/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useRef } from 'react';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../imaging/image-develop-state-v4.ts';
import { prepareImageDevelopAuthoringCurrentV1, retainImageDevelopRawDevelopmentCurrentV1 } from '../../imaging/image-develop-authoring-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { WithFramescaperImageDevelopDraftFrameCurrentV1, WithFramescaperImageBrushDraftFrameCurrentV1 } from '../../../../framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from '../../controller/shared/image-repair-spots-authoring-v1.ts';
import ImageRepairSpotsEditorV1 from './ImageRepairSpotsEditorV1.tsx';
import FramescaperImageDevelopMaskEditorV1 from './FramescaperImageDevelopMaskEditorV1.tsx';
import type { ImageDevelopDraftFrameRequestV1, WithImageDevelopDraftFrameV1 } from '../../controller/shared/image-develop-draft-presentation-v1.ts';
import type { ImageBrushMaskDraftFrameRequestV1, ImageBrushMaskResourceAcknowledgementV1, ImageBrushMaskResourcePortV1, WithImageBrushMaskDraftFrameV1 } from '../../image-brush-mask-resource-port-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../../imaging/image-develop-frame-core.ts';
import FramescaperImageBrushMaskEditorV1 from './FramescaperImageBrushMaskEditorV1.tsx';

export interface FramescaperImageDevelopDialogPropsV1 {
	readonly nativeCurrent?: true;
	readonly kind: 'repairs' | 'masks' | 'brush';
	readonly develop: ImageDevelopStateThroughV4;
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	readonly withDraftFrame?: WithFramescaperImageDevelopDraftFrameCurrentV1;
	readonly brushMasks?: Readonly<ImageBrushMaskResourcePortV1<ImageBrushMaskResourceAcknowledgementV1 & { readonly projectId: string }> & { readonly projectId: string }>;
	readonly withBrushDraftFrame?: WithFramescaperImageBrushDraftFrameCurrentV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateThroughV4>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
/** Menu-selected editors hold a local draft; the caller owns publication. */
export default function FramescaperImageDevelopDialogV1(props: FramescaperImageDevelopDialogPropsV1) {
	if (props.kind !== 'repairs' && props.kind !== 'masks' && props.kind !== 'brush') throw new TypeError('Unknown Frame image editor.');
	const captured = useRef(props);
	if (captured.current.develop !== props.develop || captured.current.withDraftFrame !== props.withDraftFrame
		|| captured.current.withBrushDraftFrame !== props.withBrushDraftFrame) captured.current = props;
	const receiver = captured.current;
	const editor = useMemo(() => captureEditor(receiver), [receiver]);
	const apply = (value: Readonly<ImageDevelopStateCurrentV1>) => {
		const edited = normalizeImageDevelopStateCurrentV1(value);
		const before = editor.develop.processVersion === 3 ? editor.develop.repairs.spots : [];
		const after = edited.processVersion === 3 ? edited.repairs.spots : [];
		const develop = props.kind === 'repairs' && JSON.stringify(before) === JSON.stringify(after)
			? editor.original : retainImageDevelopRawDevelopmentCurrentV1(editor.saved, edited);
		Reflect.apply(props.onApply, props, [develop]);
	};
	const close = () => { Reflect.apply(props.onClose, props, []); };
	if (props.kind === 'brush') {
		if (!props.brushMasks) throw new TypeError('Frame brush authoring requires its native resource owner.');
		return <FramescaperImageBrushMaskEditorV1 port={props.brushMasks} develop={editor.develop} locale={props.locale} disabled={props.disabled}
			withBrushDraftFrame={editor.withBrushDraftFrame} isCurrent={props.isCurrent} onApply={apply} onClose={close} registerRetirement={props.registerRetirement} />;
	}
	return props.kind === 'repairs'
		? <ImageRepairSpotsEditorV1 develop={editor.develop} withOriginalFrame={props.withOriginalFrame} locale={props.locale} disabled={props.disabled} nativeCurrent={props.nativeCurrent}
			isCurrent={props.isCurrent} onApply={apply} onClose={close} registerRetirement={props.registerRetirement} />
		: <FramescaperImageDevelopMaskEditorV1 develop={editor.develop} locale={props.locale} disabled={props.disabled} withDraftFrame={editor.withDraftFrame}
			isCurrent={props.isCurrent} onApply={apply} onClose={close} registerRetirement={props.registerRetirement} />;
}

/** Fixed widgets edit only their established metadata. Native preview requests
 * reattach the captured RAW group before reaching the actual Current owner. */
function captureEditor(receiver: FramescaperImageDevelopDialogPropsV1) {
	const original = receiver.develop, saved = normalizeImageDevelopStateThroughV4(original), develop = prepareImageDevelopAuthoringCurrentV1(saved);
	const render = receiver.withDraftFrame, brushRender = receiver.withBrushDraftFrame;
	const withDraftFrame: WithImageDevelopDraftFrameV1 | undefined = render
		? <Result,>(request: Readonly<ImageDevelopDraftFrameRequestV1>, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => {
			const input = record(request, 'Frame local Develop draft', ['develop', 'maskOverlay'], ['develop']);
			const captured = Object.freeze({ develop: retainImageDevelopRawDevelopmentCurrentV1(saved, field(input, 'develop', 'Frame local Develop draft')),
				...(Object.hasOwn(input, 'maskOverlay') ? { maskOverlay: field(input, 'maskOverlay', 'Frame local Develop draft') as ImageDevelopDraftFrameRequestV1['maskOverlay'] } : {}) });
			return Reflect.apply(render, receiver, [captured, consume, options]) as Promise<Result>;
		} : undefined;
	const withBrushDraftFrame: WithImageBrushMaskDraftFrameV1 | undefined = brushRender
		? <Result,>(request: Readonly<ImageBrushMaskDraftFrameRequestV1>, consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => {
			const input = record(request, 'Frame local brush draft', ['develop', 'reference', 'bytes', 'maskOverlay'], ['develop', 'reference', 'bytes']);
			const captured = Object.freeze({ develop: retainImageDevelopRawDevelopmentCurrentV1(saved, field(input, 'develop', 'Frame local brush draft')),
				reference: field(input, 'reference', 'Frame local brush draft') as ImageBrushMaskDraftFrameRequestV1['reference'],
				bytes: field(input, 'bytes', 'Frame local brush draft') as ImageBrushMaskDraftFrameRequestV1['bytes'],
				...(Object.hasOwn(input, 'maskOverlay') ? { maskOverlay: field(input, 'maskOverlay', 'Frame local brush draft') as ImageBrushMaskDraftFrameRequestV1['maskOverlay'] } : {}) });
			return Reflect.apply(brushRender, receiver, [captured, consume, options]) as Promise<Result>;
		} : undefined;
	return Object.freeze({ original, saved, develop, withDraftFrame, withBrushDraftFrame });
}
