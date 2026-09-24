/* SPDX-License-Identifier: AGPL-3.0-only */

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
	scripts,
	onSelect,
	onCreate,
	onDelete,
	onExport,
	onImport,
}) {
	return (
		<section className="audio-editor-macros-palette__library" aria-label={copy.macros}>
			<header className="audio-editor-macros-palette__library-header">
				<h3>{copy.macros}</h3>
				<LibraryActions
					labels={{ create: copy.newMacro, import: copy.importMacro, export: copy.exportMacro, delete: copy.deleteMacro }}
					selectedId={selectedId}
					exportDisabled={exportDisabled}
					onCreate={onCreate} onImport={onImport} onExport={onExport} onDelete={onDelete}
				/>
			</header>
			{macros.length
				? <ul className="audio-editor-macros-palette__macro-list" data-macro-list>
					{macros.map((macro) => (
						<li key={macro.id}>
							<button
								type="button"
								className="audio-editor-macros-palette__macro"
								data-macro-id={macro.id}
								aria-current={macro.id === selectedId ? 'true' : undefined}
								onClick={() => onSelect(macro.id)}
							>{macro.name}</button>
						</li>
					))}
				</ul>
				: <p className="audio-editor-panel-hint" data-macro-library-empty>{copy.macroLibraryEmpty}</p>}
			{scripts && <section className="audio-editor-macros-palette__programs" aria-label={scripts.heading} data-macro-programs>
				<header className="audio-editor-macros-palette__library-header">
					<h3>{scripts.heading}</h3>
					<LibraryActions
						labels={{ create: scripts.newProgram, import: scripts.importProgram, export: scripts.exportProgram, delete: scripts.deleteProgram }}
						selectedId={scripts.selectedId}
						exportDisabled={!scripts.selectedId}
						onCreate={scripts.onCreate} onImport={scripts.onImport} onExport={scripts.onExport} onDelete={scripts.onDelete}
					/>
				</header>
				{scripts.entries.length ? <ul>
					{scripts.entries.map((script) => (
						<li key={script.id}>
							<button
								type="button"
								data-macro-script-id={script.id}
								data-macro-script-trust={script.trust}
								aria-current={script.id === scripts.selectedId}
								onClick={() => scripts.onSelect(script.id)}
							>
								{script.name}
								{/* A program waiting to be read says so in the list, so the
								    state is visible before it is opened. */}
								{script.trust === 'imported-untrusted' && (
									<span className="audio-editor-macros-palette__program-untrusted">{scripts.notTrusted}</span>
								)}
							</button>
						</li>
					))}
				</ul> : null}
			</section>}
		</section>
	);
}

function LibraryActions({ labels, selectedId, exportDisabled, onCreate, onImport, onExport, onDelete }) {
	return (
		<div className="audio-editor-macros-palette__library-actions">
			<LibraryAction icon="plus" label={labels.create} onClick={onCreate} />
			<LibraryAction icon="import" label={labels.import} onClick={onImport} />
			<LibraryAction icon="export" label={labels.export} disabled={exportDisabled} onClick={onExport} />
			<LibraryAction icon="trash" label={labels.delete} disabled={!selectedId} onClick={onDelete} />
		</div>
	);
}

function LibraryAction({ icon, label, disabled = false, onClick }) {
	return (
		<button
			className="audio-editor-macros-palette__icon-button"
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon name={icon} size={16} />
		</button>
	);
}
