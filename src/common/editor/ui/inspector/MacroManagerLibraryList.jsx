/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { Icon } from '@soundscaper/design-system/Icon';

/**
 * The saved macros, beside the steps of whichever one is open.
 *
 * Creating, importing, exporting, and deleting all act on this list rather than
 * on a single anonymous draft, so the file actions live in its header next to
 * the macro they apply to.
 */
export default function MacroManagerLibraryList({
	copy,
	macros,
	selectedId,
	exportDisabled,
	templates,
	onSelect,
	onCreate,
	onDelete,
	onExport,
	onImport,
}) {
	return (
		<section className="audio-editor-macro-manager__library" aria-label={copy.macros}>
			<header className="audio-editor-macro-manager__library-header">
				<h3>{copy.macros}</h3>
				<div className="audio-editor-macro-manager__library-actions">
					<LibraryAction icon="plus" label={copy.newMacro} onClick={onCreate} />
					<LibraryAction icon="import" label={copy.importMacro} onClick={onImport} />
					<LibraryAction icon="export" label={copy.exportMacro} disabled={exportDisabled} onClick={onExport} />
					<LibraryAction icon="trash" label={copy.deleteMacro} disabled={!selectedId} onClick={onDelete} />
				</div>
			</header>
			{macros.length
				? <ul className="audio-editor-macro-manager__macro-list" data-macro-list>
					{macros.map((macro) => (
						<li key={macro.id}>
							<button
								type="button"
								className="audio-editor-macro-manager__macro"
								data-macro-id={macro.id}
								aria-current={macro.id === selectedId ? 'true' : undefined}
								onClick={() => onSelect(macro.id)}
							>{macro.name}</button>
						</li>
					))}
				</ul>
				: <p className="audio-editor-panel-hint" data-macro-library-empty>{copy.macroLibraryEmpty}</p>}
			{templates && <div className="audio-editor-macro-manager__templates" data-macro-templates>
				<h3>{templates.heading}</h3>
				<Button variant="secondary" onClick={templates.onCreateRestoration}>{templates.restoration}</Button>
			</div>}
		</section>
	);
}

function LibraryAction({ icon, label, disabled = false, onClick }) {
	return (
		<button
			className="audio-editor-macro-manager__icon-button"
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon name={icon} size={16} />
		</button>
	);
}
