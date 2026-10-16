/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { cancelDraftEditOnEscape, createDraftBlurCommitGuard, draftBlurShouldCommit } from '../draft-blur-commit.ts';

interface Props {
	readonly clip: Readonly<{ id: string }>;
	readonly name: string;
	readonly copy: Readonly<{ projectBinRename: string }>;
	readonly disabled: boolean;
	readonly onCommit: (name: string) => void;
}

export default function ProjectBinNameEditor({ clip, name, copy, disabled, onCommit }: Props) {
	const [draft, setDraft] = useState(name);
	const blurCommitGuard = useRef(createDraftBlurCommitGuard()).current;
	useEffect(() => setDraft(name), [clip.id, name]);
	const commit = () => {
		if (!draftBlurShouldCommit(blurCommitGuard)) return;
		const nextName = draft.trim();
		if (!nextName) {
			setDraft(name);
			return;
		}
		if (nextName !== name) onCommit(nextName);
	};
	return (
		<label className="kw-audio-editor__project-bin-name">
			<span className="kw-audio-editor-sr-only">{copy.projectBinRename}</span>
			<input
				data-project-bin-name
				aria-label={`${copy.projectBinRename}: ${name}`}
				value={draft}
				disabled={disabled}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						cancelDraftEditOnEscape(
							blurCommitGuard,
							event,
							() => setDraft(name),
						);
					}
				}}
			/>
		</label>
	);
}
