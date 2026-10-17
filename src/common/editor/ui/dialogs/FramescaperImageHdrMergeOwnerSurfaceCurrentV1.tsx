/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { framescaperImageHdrMergeForCurrentV1, type FramescaperImageHdrMergeSessionCurrentV1 } from '../../../../framescaper/editor-selected-image-hdr-merge-current-v1.ts';
import { imageHdrMergeCopy } from '../../../i18n/image-hdr-merge-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import ImageHdrMergeDialogCurrentV1 from './ImageHdrMergeDialogCurrentV1.tsx';

interface Props {
	readonly controller: object; readonly locale: string; readonly disabled: boolean; readonly onClose: () => void;
}
interface Scope {
	readonly controller: object; readonly stop: AbortController;
	readonly children: Set<() => Promise<void>>; readonly retiring: Set<Promise<void>>;
	opening: Promise<void>; native: Readonly<FramescaperImageHdrMergeSessionCurrentV1> | null;
	closing: Promise<void> | null; sealed: boolean; dismissing: boolean; acknowledged: boolean;
}
interface View { readonly scope: Scope; readonly failed: boolean; readonly notices?: readonly string[] }

/** Join the shared dialog and the selected native project scope before another
 * presentation generation opens or a Close gesture dismisses this surface. */
export default function FramescaperImageHdrMergeOwnerSurfaceCurrentV1(props: Props) {
	const latest = useRef(props); latest.current = props;
	const active = useRef<Scope | null>(null), predecessor = useRef<Promise<void>>(Promise.resolve());
	const [view, setView] = useState<View | null>(null);
	useEffect(() => {
		const scope: Scope = { controller: props.controller, stop: new AbortController(), children: new Set(), retiring: new Set(),
			opening: Promise.resolve(), native: null, closing: null, sealed: false, dismissing: false, acknowledged: false };
		active.current = scope; setView({ scope, failed: false });
		const port = framescaperImageHdrMergeForCurrentV1(scope.controller), open = port?.open;
		scope.opening = predecessor.current.then(async () => {
			if (scope.sealed || active.current !== scope || latest.current.controller !== scope.controller) return;
			scope.stop.signal.throwIfAborted();
			if (!port || typeof open !== 'function') throw new Error('The selected Frame HDR operation is unavailable.');
			scope.native = await Reflect.apply(open, port, [{ signal: scope.stop.signal }]) as Readonly<FramescaperImageHdrMergeSessionCurrentV1>;
			scope.stop.signal.throwIfAborted();
			if (!scope.sealed && active.current === scope && latest.current.controller === scope.controller) setView({ scope, failed: false });
		});
		void scope.opening.catch(() => {
			if (!scope.sealed && active.current === scope && latest.current.controller === scope.controller) setView({ scope, failed: true });
		});
		return () => {
			scope.sealed = true; predecessor.current = retire(scope);
			void predecessor.current.catch(() => undefined);
		};
	}, [props.controller]);
	const scope = view?.scope;
	const presented = () => Boolean(scope && active.current === scope && latest.current.controller === scope.controller);
	const current = () => Boolean(scope && presented() && !scope.sealed && !latest.current.disabled && (scope.acknowledged || scope.native?.isCurrent()));
	const close = () => {
		if (!scope || !presented() || scope.dismissing) return;
		scope.dismissing = true;
		const dismiss = () => { if (presented()) latest.current.onClose(); };
		void retire(scope).then(dismiss, dismiss);
	};
	const registerRetirement = (child: () => Promise<void>) => {
		if (!scope || !presented()) return () => undefined;
		const retain = () => { const work = Promise.resolve().then(child); scope.retiring.add(work); void work.catch(() => undefined); };
		if (scope.sealed) retain(); else scope.children.add(child);
		return () => { scope.children.delete(child); retain(); };
	};
	if (!scope || !presented()) return null;
	if (scope.native && !view.failed) return <ImageHdrMergeDialogCurrentV1 port={scope.native.port} locale={props.locale}
		isCurrent={current} registerRetirement={registerRetirement} publicationNotices={view.notices}
		onAcknowledged={value => { scope.acknowledged = true; if (presented()) setView({ scope, failed: false, notices: value.notices }); }} onClose={close} />;
	const copy = imageHdrMergeCopy(props.locale);
	return <AudioEditorDialogShell title={copy.title} onClose={close} closeOnOutside={false} className="lightscaper-dialog" overlayClassName="kw-audio-editor-dialog-backdrop audio-editor-controlled-dialog__backdrop lightscaper-dialog-backdrop">
		{view.failed ? <p role="alert">{copy.failed}</p> : <p role="status">{copy.working}</p>}
		<button type="button" onClick={close}>{copy.close}</button>
	</AudioEditorDialogShell>;
}

function retire(scope: Scope): Promise<void> {
	if (scope.closing) return scope.closing;
	let resolve!: () => void, reject!: (error: unknown) => void;
	scope.closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); scope.sealed = true; scope.stop.abort();
	void (async () => {
		const failures: unknown[] = [];
		const add = (error: unknown) => { if (!Object.is(error, scope.stop.signal.reason) && !failures.some(value => Object.is(value, error))) failures.push(error); };
		const join = async (work: readonly Promise<unknown>[]) => {
			for (const result of await Promise.allSettled(work)) if (result.status === 'rejected') add(result.reason);
		};
		const children = [...scope.children]; scope.children.clear();
		await join([scope.opening, ...children.map(child => Promise.resolve().then(child))]);
		const joinLate = async () => { while (scope.retiring.size) { const work = [...scope.retiring]; scope.retiring.clear(); await join(work); } };
		await joinLate();
		try { await scope.native?.closeAndJoin(); } catch (error) { add(error); }
		await joinLate();
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Frame HDR authoring retirement failed.', { cause: failures[0] });
	})().then(resolve, reject);
	return scope.closing;
}
