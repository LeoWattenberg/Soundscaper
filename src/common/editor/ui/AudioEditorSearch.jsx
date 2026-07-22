import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getLocaleDescriptor } from '../../i18n/locales.js';
import { searchAudioEditorEntries } from '../search.js';

const SEARCH_LIMIT = 50;
const EMPTY_GROUP_LIMIT = 4;
const SEARCH_GROUPS = Object.freeze([
	{ kind: 'command', copyKey: 'editorSearchCommands', fallback: 'Commands' },
	{ kind: 'timeline', copyKey: 'editorSearchTimelineClips', fallback: 'Timeline clips' },
	{ kind: 'project-bin', copyKey: 'editorSearchProjectBin', fallback: 'Project Bin' },
]);

const text = (copy, key, fallback) => copy?.[key] || fallback;

function formatCount(copy, count) {
	return text(copy, 'editorSearchResultCount', '{count} search results').replace('{count}', String(count));
}

export default function AudioEditorSearch({
	copy,
	entries = [],
	locale,
	onActivate,
	onOpenChange,
	open = false,
}) {
	const rootRef = useRef(null);
	const inputRef = useRef(null);
	const compactTriggerRef = useRef(null);
	const previousFocusRef = useRef(null);
	const optionRefs = useRef([]);
	const wasOpenRef = useRef(open);
	const listboxId = useId();
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState(-1);
	const direction = getLocaleDescriptor(locale)?.direction || 'ltr';
	const hasQuery = Boolean(query.trim());

	const rankedEntries = useMemo(() => (
		hasQuery ? searchAudioEditorEntries(entries, query, { limit: SEARCH_LIMIT }) : entries
	), [entries, hasQuery, query]);

	const { groups, orderedEntries } = useMemo(() => {
		let resultIndex = 0;
		const nextGroups = SEARCH_GROUPS.map((definition) => {
			const matchingEntries = rankedEntries.filter((entry) => entry.kind === definition.kind);
			const visibleEntries = hasQuery ? matchingEntries : matchingEntries.slice(0, EMPTY_GROUP_LIMIT);
			return {
				...definition,
				entries: visibleEntries.map((entry) => ({ entry, index: resultIndex++ })),
			};
		}).filter((group) => group.entries.length);
		return {
			groups: nextGroups,
			orderedEntries: nextGroups.flatMap((group) => group.entries.map(({ entry }) => entry)),
		};
	}, [hasQuery, rankedEntries]);

	const rememberFocus = useCallback((candidate) => {
		if (candidate && candidate !== inputRef.current && typeof candidate.focus === 'function') {
			previousFocusRef.current = candidate;
		}
	}, []);

	const focusInput = useCallback(() => {
		requestAnimationFrame(() => inputRef.current?.focus?.({ preventScroll: true }));
	}, []);

	const requestOpen = useCallback((focusCandidate) => {
		if (!open) rememberFocus(focusCandidate || document.activeElement);
		onOpenChange?.(true);
		focusInput();
	}, [focusInput, onOpenChange, open, rememberFocus]);

	const close = useCallback(({ restoreFocus = false } = {}) => {
		setQuery('');
		setActiveIndex(-1);
		onOpenChange?.(false);
		if (!restoreFocus) return;
		const previousFocus = previousFocusRef.current;
		requestAnimationFrame(() => {
			if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });
			else compactTriggerRef.current?.focus?.({ preventScroll: true });
		});
	}, [onOpenChange]);

	const activate = useCallback((entry) => {
		if (!entry || entry.disabled) return;
		setQuery('');
		setActiveIndex(-1);
		onOpenChange?.(false);
		queueMicrotask(() => onActivate?.(entry));
	}, [onActivate, onOpenChange]);

	useEffect(() => {
		if (wasOpenRef.current && !open) {
			setQuery('');
			setActiveIndex(-1);
		}
		wasOpenRef.current = open;
	}, [open]);

	useEffect(() => {
		if (!open) return;
		setActiveIndex(orderedEntries.findIndex((entry) => !entry.disabled));
	}, [open, orderedEntries]);

	useEffect(() => {
		const openFromShortcut = (event) => {
			const commandFind = event.key.toLowerCase() === 'f'
				&& (event.ctrlKey || event.metaKey)
				&& !event.altKey
				&& !event.shiftKey;
			const plainF3 = event.key === 'F3'
				&& !event.ctrlKey
				&& !event.metaKey
				&& !event.altKey
				&& !event.shiftKey;
			if (!commandFind && !plainF3) return;
			event.preventDefault();
			event.stopPropagation();
			requestOpen(event.target);
		};
		document.addEventListener('keydown', openFromShortcut, true);
		return () => document.removeEventListener('keydown', openFromShortcut, true);
	}, [requestOpen]);

	useEffect(() => {
		if (!open) return undefined;
		const closeOnOutsidePointer = (event) => {
			if (rootRef.current?.contains(event.target)) return;
			close();
		};
		document.addEventListener('pointerdown', closeOnOutsidePointer, true);
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
	}, [close, open]);

	useEffect(() => {
		optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
	}, [activeIndex]);

	const moveActive = (delta) => {
		const enabledIndexes = orderedEntries
			.map((entry, index) => entry.disabled ? -1 : index)
			.filter((index) => index >= 0);
		if (!enabledIndexes.length) return;
		const enabledPosition = enabledIndexes.indexOf(activeIndex);
		const nextPosition = enabledPosition < 0
			? delta > 0 ? 0 : enabledIndexes.length - 1
			: (enabledPosition + delta + enabledIndexes.length) % enabledIndexes.length;
		setActiveIndex(enabledIndexes[nextPosition]);
	};

	const onInputKeyDown = (event) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			moveActive(event.key === 'ArrowDown' ? 1 : -1);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			event.stopPropagation();
			const enabledIndexes = orderedEntries
				.map((entry, index) => entry.disabled ? -1 : index)
				.filter((index) => index >= 0);
			setActiveIndex(event.key === 'Home' ? enabledIndexes[0] ?? -1 : enabledIndexes.at(-1) ?? -1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			activate(orderedEntries[activeIndex]);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close({ restoreFocus: true });
		} else if (event.key === 'Tab') {
			setTimeout(() => close(), 0);
		}
	};

	const activeDescendant = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
	const searchLabel = text(copy, 'editorSearchLabel', 'Search commands and media');
	const searchPlaceholder = text(copy, 'editorSearchPlaceholder', 'Search commands and media');

	return (
		<div
			ref={rootRef}
			className="kw-audio-editor__search"
			data-editor-search
			data-editor-search-open={open ? 'true' : 'false'}
			dir={direction}
			onPointerDownCapture={(event) => {
				if (!open) rememberFocus(document.activeElement || event.target);
			}}
		>
			<button
				ref={compactTriggerRef}
				type="button"
				className="kw-audio-editor__search-compact-trigger"
				data-editor-search-trigger
				aria-label={text(copy, 'editorSearchOpen', 'Open search')}
				aria-expanded={open}
				aria-controls={open ? listboxId : undefined}
				onClick={(event) => requestOpen(event.currentTarget)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<circle cx="6.75" cy="6.75" r="4.25" />
					<path d="m10 10 3.5 3.5" />
				</svg>
			</button>

			<div className="kw-audio-editor__search-surface">
				<div className="kw-audio-editor__search-field">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="6.75" cy="6.75" r="4.25" />
						<path d="m10 10 3.5 3.5" />
					</svg>
					<input
						ref={inputRef}
						type="search"
						role="combobox"
						data-editor-search-input
						value={query}
						placeholder={searchPlaceholder}
						aria-label={searchLabel}
						aria-autocomplete="list"
						aria-expanded={open}
						aria-haspopup="listbox"
						aria-controls={open ? listboxId : undefined}
						aria-activedescendant={open ? activeDescendant : undefined}
						autoComplete="off"
						spellCheck="false"
						onFocus={(event) => {
							if (!open) {
								rememberFocus(event.relatedTarget);
								onOpenChange?.(true);
							}
						}}
						onChange={(event) => {
							setQuery(event.currentTarget.value);
							if (!open) onOpenChange?.(true);
						}}
						onKeyDown={onInputKeyDown}
					/>
					<kbd aria-hidden="true">{text(copy, 'editorSearchShortcut', 'Ctrl/⌘ F')}</kbd>
				</div>

				{open && (
					<div
						id={listboxId}
						className="kw-audio-editor__search-popup"
						data-editor-search-popup
						role="listbox"
						aria-label={text(copy, 'editorSearchResults', 'Search results')}
					>
						{groups.map((group) => {
							const groupLabelId = `${listboxId}-${group.kind}-label`;
							return (
								<div
									key={group.kind}
									className="kw-audio-editor__search-group"
									data-editor-search-group={group.kind}
									role="group"
									aria-labelledby={groupLabelId}
								>
									<div id={groupLabelId} className="kw-audio-editor__search-group-label" role="presentation">
										{text(copy, group.copyKey, group.fallback)}
									</div>
									{group.entries.map(({ entry, index }) => (
										<div
											key={entry.key || `${entry.kind}-${index}`}
											ref={(element) => { optionRefs.current[index] = element; }}
											id={`${listboxId}-option-${index}`}
											className="kw-audio-editor__search-option"
											data-editor-search-option
											data-editor-search-key={entry.key || ''}
											data-editor-search-kind={entry.kind}
											data-disabled={entry.disabled ? 'true' : 'false'}
											role="option"
											aria-selected={activeIndex === index}
											aria-disabled={entry.disabled || undefined}
											onMouseMove={() => { if (!entry.disabled) setActiveIndex(index); }}
											onPointerDown={(event) => event.preventDefault()}
											onClick={() => activate(entry)}
										>
											<span className="kw-audio-editor__search-option-copy">
												<span className="kw-audio-editor__search-option-label">{entry.label}</span>
												{(entry.detail || entry.disabledReason) && (
													<span className="kw-audio-editor__search-option-detail">
														{entry.disabledReason || entry.detail}
													</span>
												)}
											</span>
											{entry.shortcut && <kbd>{entry.shortcut}</kbd>}
										</div>
									))}
								</div>
							);
						})}
						{!orderedEntries.length && (
							<div className="kw-audio-editor__search-empty" role="presentation">
								{text(copy, 'editorSearchNoResults', 'No results')}
							</div>
						)}
					</div>
				)}
			</div>

			<span
				className="kw-audio-editor-sr-only"
				data-editor-search-count={orderedEntries.length}
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>
				{open ? formatCount(copy, orderedEntries.length) : ''}
			</span>
		</div>
	);
}
