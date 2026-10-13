/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { captureImageBrushMaskResourcePortV1, type ImageBrushMaskResourceAcknowledgementV1,
	type ImageBrushMaskResourcePortV1, type WithImageBrushMaskDraftFrameV1 } from '../../image-brush-mask-resource-port-v1.ts';
import { normalizeBrushMaskResourceReferenceV1, type BrushMaskResourceReferenceV1 } from '../../imaging/brush-mask-resource-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import { framescaperImageBrushMaskCopyV1 } from '../../../i18n/framescaper-image-brush-mask-copy-v1.ts';
import ImageBrushMaskEditorV1 from './ImageBrushMaskEditorV1.tsx';

interface FrameAcknowledgement extends ImageBrushMaskResourceAcknowledgementV1 { readonly projectId: string }
export interface FramescaperImageBrushMaskEditorPropsV1 {
	readonly port: Readonly<ImageBrushMaskResourcePortV1<FrameAcknowledgement> & { readonly projectId: string }>;
	readonly develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly withBrushDraftFrame?: WithImageBrushMaskDraftFrameV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: Readonly<ImageDevelopStateCurrentV1>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
const FIELDS = ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const;

/** The genuine project capability remains product-owned. Only its captured
 * resource functions and typed acknowledgement validator enter the neutral UI. */
export default function FramescaperImageBrushMaskEditorV1(props: FramescaperImageBrushMaskEditorPropsV1) {
	const admitted = useMemo(() => {
		const native = props.port, input = record(native, 'Frame brush capability', ['schemaVersion', 'projectId', 'source', 'install']);
		const projectId = field(input, 'projectId', 'Frame brush capability');
		if (typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId)) throw new TypeError('Frame brush capability requires its genuine project identity.');
		const install = field(input, 'install', 'Frame brush capability');
		if (typeof install !== 'function') throw new TypeError('Frame brush installation requires a data method.');
		const port = captureImageBrushMaskResourcePortV1<FrameAcknowledgement>({ schemaVersion: field(input, 'schemaVersion', 'Frame brush capability'),
			source: field(input, 'source', 'Frame brush capability'), install: (...args: Parameters<typeof native.install>) => Reflect.apply(install, native, args) as ReturnType<typeof native.install> });
		return { port, prepareAcknowledgement(value: unknown, expected: Readonly<BrushMaskResourceReferenceV1>): Readonly<FrameAcknowledgement> {
			const ack = record(value, 'Frame brush acknowledgement', ['schemaVersion', 'projectId', 'reference', 'created', 'notices']);
			const created = field(ack, 'created', 'Frame brush acknowledgement');
			if (field(ack, 'schemaVersion', 'Frame brush acknowledgement') !== 1 || field(ack, 'projectId', 'Frame brush acknowledgement') !== projectId || typeof created !== 'boolean') throw new TypeError('Frame brush acknowledgement differs from its admitted owner.');
			const raw = record(field(ack, 'reference', 'Frame brush acknowledgement'), 'Frame brush acknowledged reference', FIELDS);
			const reference = normalizeBrushMaskResourceReferenceV1(field(raw, 'storageKey', 'Frame brush acknowledged reference'));
			for (const key of FIELDS) if (field(raw, key, 'Frame brush acknowledged reference') !== reference[key] || reference[key] !== expected[key]) throw new TypeError('Frame brush acknowledgement differs from its exact body.');
			const notices = array(field(ack, 'notices', 'Frame brush acknowledgement'), 'Frame brush notices', 0, 1).map((notice): 'cleanup-failed' => {
				if (notice !== 'cleanup-failed') throw new TypeError('Frame brush acknowledgement has an unsupported notice.'); return notice;
			});
			return Object.freeze({ schemaVersion: 1, projectId, reference, created, notices: Object.freeze(notices) });
		} };
	}, [props.port]);
	const close = () => { Reflect.apply(props.onClose, props, []); };
	return <ImageBrushMaskEditorV1 port={admitted.port} prepareAcknowledgement={admitted.prepareAcknowledgement} develop={props.develop}
		locale={props.locale} messages={framescaperImageBrushMaskCopyV1(props.locale)} disabled={props.disabled} isCurrent={props.isCurrent}
		withBrushDraftFrame={props.withBrushDraftFrame} registerRetirement={props.registerRetirement}
		onApply={value => { Reflect.apply(props.onApply, props, [value]); }} onClose={close} onJoinedClose={close} />;
}
