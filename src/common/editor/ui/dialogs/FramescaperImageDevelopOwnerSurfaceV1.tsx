/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import { framescaperImageDevelopAuthoringForCurrentV1 } from '../../../../framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from '../../controller/shared/image-repair-spots-authoring-v1.ts';
import type { PixelFrameV1 } from '../../imaging/pixel-frame-contract-v1.ts';
import { photoDevelopRepairSpotsCopy } from '../../../i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../../i18n/lightscaper-develop-mask-management-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import FramescaperImageDevelopSurfaceV1 from './FramescaperImageDevelopSurfaceV1.tsx';

export interface FramescaperImageDevelopOwnerSurfacePropsV1 {
	readonly controller: object;
	readonly locale: string;
	readonly kind: 'repairs' | 'masks';
	readonly disabled: boolean;
	readonly onClose: () => void;
}
type Port = NonNullable<ReturnType<typeof framescaperImageDevelopAuthoringForCurrentV1>>;
type Session = Awaited<ReturnType<Port['open']>>;
interface NativeSession {
	readonly value: Session;
	readonly develop: Readonly<ImageDevelopStateCurrentV1>;
	readonly withOriginalFrame: WithImageRepairSpotsOriginalFrameV1;
	readonly isCurrent: () => boolean;
	readonly apply: (develop: Readonly<ImageDevelopStateCurrentV1>) => void;
	readonly close: () => Promise<void>;
}
interface Scope {
	readonly controller: object;
	readonly kind: 'repairs' | 'masks';
	readonly stop: AbortController;
	readonly children: Set<() => Promise<void>>;
	readonly retiring: Set<Promise<void>>;
	readonly predecessor: Promise<void>;
	opening: Promise<void>;
	native: NativeSession | null;
	sealed: boolean;
	closing: Promise<void> | null;
	failed: Readonly<{ value: unknown }> | null;
}
interface View { readonly scope: Scope; readonly failed: boolean; readonly closing: boolean }
const CHECK = AbortSignal.prototype.throwIfAborted, ABORT = AbortController.prototype.abort;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** The selected controller owns source admission, history and preview release.
 * Presentation generations only capture methods, seal callbacks and join owners. */
export default function FramescaperImageDevelopOwnerSurfaceV1(props: FramescaperImageDevelopOwnerSurfacePropsV1) {
	if (props.kind !== 'repairs' && props.kind !== 'masks') throw new TypeError('Unknown Frame image authoring surface.');
	const latest = useRef(props); latest.current = props;
	const live = useRef(true), active = useRef<Scope | null>(null), predecessor = useRef<Promise<void>>(Promise.resolve());
	const [view, setView] = useState<View | null>(null);
	const presented = useCallback((scope: Scope) => live.current && active.current === scope && latest.current.controller === scope.controller && latest.current.kind === scope.kind, []);
	const publishFailure = useCallback((scope: Scope, value: unknown) => {
		scope.failed = { value };
		if (presented(scope)) setView({ scope, failed: true, closing: scope.sealed });
	}, [presented]);
	useEffect(() => {
		live.current = true;
		const scope: Scope = { controller: props.controller, kind: props.kind, stop: new AbortController(), children: new Set(), retiring: new Set(),
			predecessor: predecessor.current.then(() => undefined, () => undefined), opening: Promise.resolve(), native: null, sealed: false, closing: null, failed: null };
		active.current = scope; setView({ scope, failed: false, closing: false });
		let port: Port | null = null, open: Port['open'] | null = null;
		try { port = framescaperImageDevelopAuthoringForCurrentV1(scope.controller); open = port?.open ?? null; }
		catch (error) { publishFailure(scope, error); }
		scope.opening = scope.predecessor.then(async () => {
			if (!presented(scope) || scope.sealed) return;
			Reflect.apply(CHECK, scope.stop.signal, []);
			if (!port || !open) throw new Error('Selected image authoring is unavailable.');
			const session = await Reflect.apply(open, port, [{ signal: scope.stop.signal }]) as Session;
			scope.native = captureSession(session);
			Reflect.apply(CHECK, scope.stop.signal, []);
			if (presented(scope) && !scope.sealed) setView({ scope, failed: false, closing: false });
		});
		void scope.opening.catch((error: unknown) => {
			if (!scope.sealed && presented(scope)) publishFailure(scope, error);
		});
		return () => {
			scope.sealed = true; predecessor.current = retire(scope);
			void predecessor.current.catch(() => undefined);
		};
	}, [props.controller, props.kind, presented, publishFailure]);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const scope = view?.scope;
	const current = () => Boolean(scope && presented(scope) && !scope.sealed && !latest.current.disabled && scope.native?.isCurrent());
	const close = () => {
		if (!scope || !presented(scope)) return;
		scope.sealed = true; setView({ scope, failed: false, closing: true });
		void retire(scope).then(() => {
			if (presented(scope)) Reflect.apply(latest.current.onClose, latest.current, []);
		}, (error: unknown) => { publishFailure(scope, error); });
	};
	const apply = (develop: Readonly<ImageDevelopStateCurrentV1>) => {
		if (!scope || !current()) return;
		try { scope.native!.apply(develop); close(); }
		catch (error) { publishFailure(scope, error); }
	};
	const registerRetirement = (retirement: () => Promise<void>) => {
		if (!scope || !presented(scope) || scope.sealed) {
			const work = Promise.resolve().then(retirement); if (scope) scope.retiring.add(work);
			void work.catch((error: unknown) => { if (scope) publishFailure(scope, error); }); return () => undefined;
		}
		scope.children.add(retirement); return () => { scope.children.delete(retirement); };
	};
	if (!scope || !presented(scope)) return null;
	if (scope.native && !view.failed && !view.closing) return <FramescaperImageDevelopSurfaceV1 kind={props.kind} locale={props.locale}
		develop={scope.native.develop} withOriginalFrame={scope.native.withOriginalFrame} disabled={props.disabled} isCurrent={current}
		onApply={apply} onClose={close} registerRetirement={registerRetirement} />;
	const repair = photoDevelopRepairSpotsCopy(props.locale), mask = photoDevelopMaskManagementCopy(props.locale);
	return <div data-frame-image-develop-surface><AudioEditorDialogShell title={props.kind === 'repairs' ? repair.title : mask.title}
		onClose={close} closeOnOutside={false} overlayClassName="lightscaper-dialog-backdrop" className="lightscaper-dialog">
		{view.failed ? <p role="alert">{diagnostic(scope.failed?.value, repair.failed)}</p> : <p role="status">{repair.working}</p>}
		<button type="button" onClick={close}>{repair.close}</button>
	</AudioEditorDialogShell></div>;
}

function captureSession(value: Session): NativeSession {
	const current = value.isCurrent, withOriginalFrame = value.withOriginalFrame, apply = value.apply, close = value.closeAndJoin;
	if ([current, withOriginalFrame, apply, close].some(method => typeof method !== 'function')) throw new TypeError('Invalid selected image authoring owner.');
	let closing: Promise<void> | null = null;
	return { value, develop: value.develop,
		isCurrent: () => Reflect.apply(current, value, []) === true,
		withOriginalFrame: <Result,>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) =>
			Reflect.apply(withOriginalFrame, value, [consume, options]) as Promise<Result>,
		apply: develop => { Reflect.apply(apply, value, [develop]); },
		close: () => { closing ??= Promise.resolve().then(() => Reflect.apply(close, value, []) as Promise<void>); return closing; },
	};
}
function retire(scope: Scope): Promise<void> {
	if (scope.closing) return scope.closing;
	let resolve!: () => void, reject!: (error: unknown) => void;
	scope.closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; }); scope.sealed = true;
	const children = [...scope.children]; scope.children.clear();
	Reflect.apply(ABORT, scope.stop, []);
	void (async () => {
		const failures: unknown[] = [];
		const add = (error: unknown) => { if (!failures.some(value => Object.is(value, error))) failures.push(error); };
		const expected = (error: unknown) => Reflect.apply(ABORTED, scope.stop.signal, []) === true && Object.is(error, Reflect.apply(REASON, scope.stop.signal, []));
		const opening = scope.opening.catch((error: unknown) => { if (!expected(error)) scope.failed ??= { value: error }; });
		const joined = await Promise.allSettled([scope.predecessor, opening, ...children.map(child => Promise.resolve().then(child))]);
		for (const outcome of joined) if (outcome.status === 'rejected' && !expected(outcome.reason)) add(outcome.reason);
		const joinLate = async () => {
			while (scope.retiring.size) {
				const held = [...scope.retiring]; for (const work of held) scope.retiring.delete(work);
				for (const outcome of await Promise.allSettled(held)) if (outcome.status === 'rejected' && !expected(outcome.reason)) add(outcome.reason);
			}
		};
		await joinLate();
		try { await scope.native?.close(); } catch (error) { add(error); }
		await joinLate();
		if (failures.length === 1) throw failures[0];
		if (failures.length) throw new AggregateError(failures, 'Frame image authoring retirement failed.', { cause: failures[0] });
	})().then(resolve, reject);
	return scope.closing;
}
function diagnostic(value: unknown, fallback: string): string {
	try { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
		return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2048) : fallback;
	} catch { return fallback; }
}
