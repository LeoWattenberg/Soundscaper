/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopPresentationV1, type PhotoDevelopPresentationSnapshotV1 } from '../../controller/shared/photo-library-develop-presentation-v1.ts';
import type { PixelPreviewPresentationReaderV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV1 } from '../../photo-library-develop-proxy-port-v1.ts';
import type { PhotoLibraryDevelopSettingsV1 } from '../../photo-library-develop-port-v1.ts';
import type { PixelFrameHistogramV1 } from '../../imaging/pixel-frame-histogram-v1.ts';
import type { PhotoDevelopCopyV1 } from '../../../i18n/lightscaper-develop-copy.ts';

export interface PhotoDevelopPreviewPropsV1 {
	readonly photoId: string;
	readonly develop: PhotoLibraryDevelopSettingsV1;
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly loadProxy: LoadPhotoLibraryDevelopProxyRuntimeV1;
	readonly beforePresent: Promise<void>;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
	readonly messages: PhotoDevelopCopyV1;
	readonly locale: string;
}
export default function PhotoDevelopPreview(props: PhotoDevelopPreviewPropsV1) {
	const { readPreview, loadProxy, beforePresent, registerRetirement } = props;
	const owner = useMemo(() => new PhotoLibraryDevelopPresentationV1({ readPreview, loadProxy, beforePresent }), [readPreview, loadProxy, beforePresent]);
	const before = useRef<HTMLCanvasElement>(null), after = useRef<HTMLCanvasElement>(null);
	const [mode, setMode] = useState('compare'), [snapshot, setSnapshot] = useState<PhotoDevelopPresentationSnapshotV1>(() => owner.snapshot());
	useLayoutEffect(() => {
		const unsubscribe = owner.subscribe(setSnapshot), unregister = registerRetirement(() => owner.pause());
		return () => { unsubscribe(); unregister(); void owner.pause().catch(() => undefined); };
	}, [owner, registerRetirement]);
	useLayoutEffect(() => {
		let current = true;
		void owner.pause().then(() => {
			if (current && before.current && after.current) owner.setView({ photoId: props.photoId, develop: props.develop, before: before.current, after: after.current });
		}).catch(() => undefined);
		return () => { current = false; void owner.pause().catch(() => undefined); };
	}, [owner, props.photoId, props.develop]);
	const { messages } = props;
	return <section aria-label={messages.preview} data-photo-develop-preview data-state={snapshot.status}>
		<label>{messages.previewMode}<select value={mode} onChange={event => { setMode(event.currentTarget.value); }}>
			<option value="compare">{messages.compare}</option><option value="before">{messages.before}</option><option value="after">{messages.after}</option>
		</select></label>
		{snapshot.status === 'pending' && <p role="status">{messages.working}</p>}
		{snapshot.status === 'missing' && <p role="status">{messages.missing}</p>}
		{snapshot.status === 'failed' && <p role="alert">{messages.previewFailed}</p>}
		<div className="lightscaper-develop-images">
			<figure hidden={mode === 'after'}><figcaption>{messages.before}</figcaption><canvas ref={before} width={0} height={0} role="img" aria-label={messages.before} />
				{snapshot.before && <Histogram value={snapshot.before} label={messages.before} messages={messages} locale={props.locale} />}</figure>
			<figure hidden={mode === 'before'}><figcaption>{messages.after}</figcaption><canvas ref={after} width={0} height={0} role="img" aria-label={messages.after} />
				{snapshot.after && <Histogram value={snapshot.after} label={messages.after} messages={messages} locale={props.locale} />}</figure>
		</div>
	</section>;
}
function Histogram({ value, label, messages, locale }: Readonly<{ value: PixelFrameHistogramV1; label: string; messages: PhotoDevelopCopyV1; locale: string }>) {
	const maximum = Math.max(1, ...value.bins.red, ...value.bins.green, ...value.bins.blue), number = new Intl.NumberFormat(locale);
	return <div className="lightscaper-develop-histogram"><svg viewBox="0 0 255 100" role="img" aria-label={`${messages.histogram}: ${label}`}>
		{(['red', 'green', 'blue'] as const).map(channel => <polyline key={channel} fill="none" stroke={channel}
			points={value.bins[channel].map((count, index) => `${index},${100 - count / maximum * 100}`).join(' ')} />)}
	</svg><dl><dt>{messages.samples}</dt><dd>{number.format(value.sampledPixels)}</dd><dt>{messages.low}</dt><dd>{number.format(value.lowClippedPixels)}</dd>
		<dt>{messages.high}</dt><dd>{number.format(value.highClippedPixels)}</dd></dl></div>;
}
