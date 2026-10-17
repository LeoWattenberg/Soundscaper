/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LoadPhotoSavedFilterRuntimeV1, PhotoSavedFilterRuntimeV1 } from '../../photo-library-saved-filter-runtime-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoSavedFiltersDialog, { type PhotoSavedFiltersDialogPropsV1 } from './PhotoSavedFiltersDialog.tsx';

type DialogProps = Omit<PhotoSavedFiltersDialogPropsV1, 'runtime'>;
export interface PhotoSavedFiltersSurfacePropsV1 extends DialogProps { readonly loadSavedFilterRuntime: LoadPhotoSavedFilterRuntimeV1 }
interface LoaderOwner {
	promise: Promise<PhotoSavedFilterRuntimeV1> | null;
	readonly load: LoadPhotoSavedFilterRuntimeV1;
	readonly generation: unknown;
	readonly Ready: (props: PhotoSavedFiltersDialogPropsV1) => React.JSX.Element;
}
interface Loaded { readonly owner: LoaderOwner; readonly runtime: PhotoSavedFilterRuntimeV1 | null; readonly failed: boolean }

/** A pure codec loads on menu demand. The closeable shell holds no Session or recipe while it waits. */
export default function PhotoSavedFiltersSurface({ loadSavedFilterRuntime, ...props }: PhotoSavedFiltersSurfacePropsV1) {
	const owner = useMemo<LoaderOwner>(() => ({ promise: null, load: loadSavedFilterRuntime, generation: props.generation,
		Ready: dialog => <PhotoSavedFiltersDialog {...dialog} /> }),
		[loadSavedFilterRuntime, props.generation]);
	const latest = useRef(owner); latest.current = owner;
	const currentProps = useRef(props); currentProps.current = props;
	const live = useRef(false), retired = useRef(false);
	const [loaded, setLoaded] = useState<Loaded | null>(null), [closed, setClosed] = useState(false);
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useEffect(() => {
		let current = true;
		owner.promise ??= Promise.resolve().then(owner.load);
		void owner.promise.then(runtime => {
			if (current && live.current && !retired.current && latest.current === owner) setLoaded({ owner, runtime, failed: false });
		}, () => {
			if (current && live.current && !retired.current && latest.current === owner) setLoaded({ owner, runtime: null, failed: true });
		});
		return () => { current = false; };
	}, [owner]);
	const close = () => {
		if (!live.current || retired.current || latest.current !== owner) return;
		retired.current = true; setClosed(true); currentProps.current.onClose();
	};
	if (closed) return null;
	if (loaded?.owner === owner && loaded.runtime) return <owner.Ready {...props} runtime={loaded.runtime} onClose={close} />;
	return <AudioEditorDialogShell title={props.copy.photoSavedFiltersTitle} onClose={close} className="lightscaper-dialog"
		overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false} initialFocus="[data-saved-surface-close]">
		{props.error && <p role="alert">{props.error}</p>}
		{loaded?.owner === owner && loaded.failed ? <p role="alert">{props.copy.photoDefinitionFailed}</p> : <p role="status">{props.copy.photoWorking}</p>}
		<div className="lightscaper-dialog-actions">
			{(props.busy || props.savedFilters.busy) && <button type="button" onClick={() => {
				if (live.current && !retired.current && latest.current === owner) currentProps.current.onCancel();
			}}>{props.copy.photoCancelAction}</button>}
			<button type="button" data-saved-surface-close onClick={close}>{props.copy.photoCloseMetadata}</button>
		</div>
	</AudioEditorDialogShell>;
}
