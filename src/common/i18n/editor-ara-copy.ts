/* SPDX-License-Identifier: AGPL-3.0-only */

const en = Object.freeze({
	clipEditor: 'Edit selected clip with ARA', title: 'ARA clip editor', selectClip: 'Select an audio clip first.',
	plugin: 'VST3 plug-in', choosePlugin: 'Choose a plug-in', scan: 'Enable and scan VST3 folders',
	customFolder: 'Add VST3 folder', refresh: 'Refresh plug-ins', openClip: 'Open clip',
	openEditor: 'Open plug-in editor', render: 'Render to new muted track', cancel: 'Cancel',
	description: 'Edit the selected clip with an installed ARA 2 plug-in. Rendering creates a new muted audio track and preserves the original.',
	noPlugins: 'No VST3 plug-ins are available. Enable scanning or add a plug-in folder.',
	opening: 'Preparing audio for the plug-in', editing: 'The clip is ready. Open the plug-in editor, then render your changes.',
	rendering: 'Rendering edited audio', unavailable: 'The desktop ARA runtime is unavailable.',
})

const de: Readonly<Record<keyof typeof en, string>> = Object.freeze({
	clipEditor: 'Ausgewählten Clip mit ARA bearbeiten', title: 'ARA-Clip-Editor', selectClip: 'Wähle zuerst einen Audioclip aus.',
	plugin: 'VST3-Plug-in', choosePlugin: 'Plug-in auswählen', scan: 'VST3-Ordner aktivieren und durchsuchen',
	customFolder: 'VST3-Ordner hinzufügen', refresh: 'Plug-ins aktualisieren', openClip: 'Clip öffnen',
	openEditor: 'Plug-in-Editor öffnen', render: 'Auf neue stummgeschaltete Spur rendern', cancel: 'Abbrechen',
	description: 'Bearbeite den ausgewählten Clip mit einem installierten ARA-2-Plug-in. Beim Rendern entsteht eine neue stummgeschaltete Audiospur; das Original bleibt erhalten.',
	noPlugins: 'Keine VST3-Plug-ins verfügbar. Aktiviere die Suche oder füge einen Plug-in-Ordner hinzu.',
	opening: 'Audio für das Plug-in vorbereiten', editing: 'Der Clip ist bereit. Öffne den Plug-in-Editor und rendere anschließend deine Änderungen.',
	rendering: 'Bearbeitetes Audio rendern', unavailable: 'Die ARA-Laufzeit der Desktop-App ist nicht verfügbar.',
})

export const ARA_COPY_BY_LOCALE = Object.freeze({ en, de })
