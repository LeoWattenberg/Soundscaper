/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoDevelopRawDevelopmentCopy } from '../../../i18n/lightscaper-raw-development-copy.ts';
import { PhotoLibraryRawDevelopmentAuthoringCurrentV1, type PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1 } from '../../controller/shared/photo-library-raw-development-authoring-current-v1.ts';
import type { ImageDevelopStateThroughV4 } from '../../imaging/image-develop-state-v4.ts';
import type { PhotoLibraryDevelopOriginalCapabilityCurrentV1 } from '../../photo-library-develop-port-current-v1.ts';

export interface PhotoDevelopRawDevelopmentDialogPropsCurrentV1 {
	readonly photoId: string;
	readonly revision: number;
	readonly develop: Readonly<ImageDevelopStateThroughV4>;
	readonly original: Readonly<PhotoLibraryDevelopOriginalCapabilityCurrentV1>;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateThroughV4>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}

/** The opted-in dialog owns presentation only. Its controller owns native
 * choice admission, proof serialization, cancellation and joined retirement. */
export default function PhotoDevelopRawDevelopmentDialogCurrentV1(props: PhotoDevelopRawDevelopmentDialogPropsCurrentV1) {
	const text = photoDevelopRawDevelopmentCopy(props.locale), latest = useRef(props); latest.current = props;
	const predecessor = useRef<Promise<void>>(Promise.resolve()), active = useRef<PhotoLibraryRawDevelopmentAuthoringCurrentV1 | null>(null), live = useRef(false);
	const [lifecycle, setLifecycle] = useState(0);
	const { photoId, revision, develop, original } = props;
	const generation = useMemo(() => ({ lifecycle, owner: new PhotoLibraryRawDevelopmentAuthoringCurrentV1({ photoId, revision, develop, original }) }), [photoId, revision, develop, original, lifecycle]);
	const { owner } = generation; active.current = owner;
	const [saved, setSaved] = useState<{ owner: PhotoLibraryRawDevelopmentAuthoringCurrentV1; view: Readonly<PhotoLibraryRawDevelopmentAuthoringSnapshotCurrentV1> }>(() => ({ owner, view: owner.snapshot() }));
	const view = saved.owner === owner ? saved.view : owner.snapshot(), rendered = useRef(view); rendered.current = view;
	const same = () => live.current && active.current === owner;
	const current = () => same() && !owner.snapshot().closed && !latest.current.disabled && latest.current.photoId === photoId
		&& latest.current.revision === revision && latest.current.develop === develop && latest.current.original === original && latest.current.isCurrent();
	useLayoutEffect(() => {
		live.current = true;
		if (owner.snapshot().closed) { setLifecycle(value => value + 1); return; }
		let mounted = true;
		const unsubscribe = owner.subscribe(value => { if (mounted) setSaved({ owner, view: value }); });
		const unregister = latest.current.registerRetirement?.(() => owner.close());
		// The preceding layout cleanup installs the actual predecessor join.
		void owner.open(predecessor.current).catch(() => undefined);
		return () => {
			mounted = false; live.current = false; unsubscribe(); predecessor.current = owner.close();
			void predecessor.current.catch(() => undefined); unregister?.();
		};
	}, [owner]);
	const apply = () => {
		if (!current() || rendered.current !== view || !view.ready || view.working || view.failed) return;
		Reflect.apply(latest.current.onApply, latest.current, [view.ready]);
	};
	const close = () => {
		if (!same()) return;
		const dismiss = () => { if (same()) Reflect.apply(latest.current.onClose, latest.current, []); };
		// The registered retirement preserves an independent native error;
		// dismissal still happens after the complete failed operation joins.
		void owner.close().then(dismiss, dismiss);
	};
	return <AudioEditorDialogShell title={text.title} onClose={close} className="lightscaper-dialog lightscaper-raw-development-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<label>{text.mode}<select aria-label={text.mode} value={view.mode} disabled={props.disabled || view.closed} onChange={event => {
			const mode = event.currentTarget.value;
			if (current() && (mode === 'canonical' || mode === 'headroom' || mode === 'recovery')) void owner.choose(mode).catch(() => undefined);
		}}><option value="canonical">{text.canonical}</option><option value="headroom">{text.headroom}</option><option value="recovery">{text.recovery}</option></select></label>
		{view.working && <p role="status">{text.working}</p>}{view.failed && <p role="alert">{text.failed}</p>}
		<div className="lightscaper-develop-actions"><button type="button" onClick={apply} disabled={props.disabled || !view.ready || view.working || view.failed || view.closed}>{text.apply}</button>
			<button type="button" onClick={close}>{text.close}</button></div>
	</AudioEditorDialogShell>;
}
