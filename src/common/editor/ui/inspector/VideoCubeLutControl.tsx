/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { VideoCubeLutReferenceV1 } from '../../video-color-cube-lut-v27.ts';
import { takeSelectedFile } from '../file-input-selection.ts';

export interface VideoCubeLutControlProps {
	readonly reference: VideoCubeLutReferenceV1 | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly isCurrent: () => boolean;
	readonly onImport: (file: File) => PromiseLike<void> | void;
	readonly onClear: () => PromiseLike<void> | void;
}

/** Resource IO/body authentication belongs to the captured caller. This control
 * lives inside the existing opted-in effect workflow and carries no LUT body. */
export default function VideoCubeLutControl(props: VideoCubeLutControlProps) {
	const binding = useMemo(() => ({ reference: props.reference, disabled: props.disabled, isCurrent: props.isCurrent,
		onImport: props.onImport, onClear: props.onClear, copy: props.copy }),
	[props.reference, props.disabled, props.isCurrent, props.onImport, props.onClear, props.copy]);
	const latest = useRef(binding); latest.current = binding;
	const live = useRef(true), active = useRef<object | null>(null);
	const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useLayoutEffect(() => { setError(null); }, [binding]);
	const ownsBinding = () => live.current && latest.current === binding && !binding.disabled;
	const current = () => ownsBinding() && Reflect.apply(binding.isCurrent, binding, []) === true && ownsBinding();
	function run(work: () => PromiseLike<void> | void): void {
		if (active.current) return;
		const task = {}; active.current = task;
		try {
			if (!current()) { active.current = null; return; }
			setPending(true); setError(null);
			const result = work();
			void Promise.resolve(result).catch(() => {
				if (live.current && latest.current === binding) setError(binding.copy.videoEffectCubeLutFailed!);
			}).finally(() => {
				if (active.current === task) { active.current = null; if (live.current) setPending(false); }
			});
		} catch {
			active.current = null;
			if (live.current && latest.current === binding) { setPending(false); setError(binding.copy.videoEffectCubeLutFailed!); }
		}
	}
	function choose(event: ChangeEvent<HTMLInputElement>): void {
		run(() => {
			const file = takeSelectedFile(event.currentTarget);
			if (file) return Reflect.apply(binding.onImport, binding, [file]) as PromiseLike<void> | void;
		});
	}
	return <div data-video-cube-lut-control>
		<label>{props.copy.videoEffectCubeLutImport}<input type="file" accept=".cube" aria-label={props.copy.videoEffectCubeLutImport}
			disabled={props.disabled || pending} onChange={choose} /></label>
		<p role="status">{props.reference === null ? props.copy.videoEffectCubeLutNone : props.copy.videoEffectCubeLutAttached}</p>
		<button type="button" disabled={props.disabled || pending || props.reference === null}
			onClick={() => { if (binding.reference !== null) run(() => Reflect.apply(binding.onClear, binding, []) as PromiseLike<void> | void); }}>{props.copy.videoEffectCubeLutClear}</button>
		{error && <p role="alert">{error}</p>}
	</div>;
}
