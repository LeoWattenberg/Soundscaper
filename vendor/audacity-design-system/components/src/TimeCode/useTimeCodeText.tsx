import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TimeCodeProps } from './TimeCode';
import { parseTimeText } from './time-code-text';

interface TextEntryProps extends Pick<TimeCodeProps, 'value' | 'format' | 'sampleRate' | 'disabled' | 'ariaLabel' | 'onChange' | 'onCommit'> {
	containerRef: React.RefObject<HTMLDivElement | null>;
}

/** Double click or the format menu opts into one selected, free text field. */
export function useTimeCodeText({ value, format = 'hh:mm:ss', sampleRate = 44100, disabled, ariaLabel, onChange, onCommit, containerRef }: TextEntryProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const editing = draft !== null;
	const commitPending = useRef(false);
	useLayoutEffect(() => {
		if (commitPending.current) { commitPending.current = false; onCommit?.(); }
		if (!editing) return;
		inputRef.current?.focus();
		inputRef.current?.select?.();
	}, [editing, onCommit]);
	const begin = useCallback(() => {
		if (disabled || !onChange) return;
		setDraft(String(format === 'samples' ? value * sampleRate : value));
	}, [disabled, onChange, format, value, sampleRate]);
	useEffect(() => {
		const host = containerRef.current;
		host?.addEventListener('timecode-enter-value', begin);
		return () => host?.removeEventListener('timecode-enter-value', begin);
	}, [begin, containerRef]);
	const cancel = () => { setDraft(null); containerRef.current?.focus(); };
	return {
		begin,
		input: draft === null ? null : <input
			ref={inputRef}
			className="timecode__free-text"
			aria-label={ariaLabel}
			aria-invalid={parseTimeText(draft, format, sampleRate) === null}
			value={draft}
			onChange={event => setDraft(event.currentTarget.value)}
			onBlur={() => setDraft(null)}
			onClick={event => event.stopPropagation()}
			onDoubleClick={event => event.stopPropagation()}
			onKeyDown={event => {
				event.stopPropagation();
				if (event.key === 'Escape') { event.preventDefault(); cancel(); }
				if (event.key !== 'Enter') return;
				event.preventDefault();
				const parsed = parseTimeText(draft, format, sampleRate);
				if (parsed === null) return;
				onChange?.(parsed);
				commitPending.current = true;
				cancel();
			}}
		/>,
	};
}
