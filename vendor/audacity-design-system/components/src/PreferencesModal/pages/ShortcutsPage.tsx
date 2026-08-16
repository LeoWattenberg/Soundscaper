import { useState } from 'react';
import { Button } from '../../Button';
import { LabeledRadio } from '../../LabeledRadio';
import { SearchField } from '../../SearchField';
import { ShortcutTableHeader } from '../../ShortcutTableHeader';
import { ShortcutTableRow } from '../../ShortcutTableRow';

// Shortcuts Page Content
export function ShortcutsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBy, setSearchBy] = useState<'name' | 'shortcut'>('name');
  const [selectedShortcut, setSelectedShortcut] = useState<string | null>(null);

  const shortcuts = [
    { id: '1', action: 'About Audacity', shortcut: '' },
    { id: '2', action: 'About MuseScore...', shortcut: '' },
    { id: '3', action: 'About MuseXML...', shortcut: '' },
    { id: '4', action: 'About Qt...', shortcut: '' },
    { id: '5', action: 'Add label', shortcut: '⌘B' },
    { id: '6', action: 'Add realtime effects', shortcut: 'E' },
    { id: '7', action: 'Align end to end', shortcut: '' },
    { id: '8', action: 'Align end to playhead', shortcut: '' },
    { id: '9', action: 'Align end to selection end', shortcut: '' },
    { id: '10', action: 'Align start to playhead', shortcut: '' },
    { id: '11', action: 'Align start to selection end', shortcut: '' },
    { id: '12', action: 'Align start to zero', shortcut: '' },
    { id: '13', action: 'Apply effect to selection', shortcut: '⌘E' },
    { id: '14', action: 'Auto duck', shortcut: '' },
    { id: '15', action: 'Bass and treble', shortcut: '' },
    { id: '16', action: 'Change pitch', shortcut: '' },
    { id: '17', action: 'Change speed', shortcut: '' },
    { id: '18', action: 'Change tempo', shortcut: '' },
    { id: '19', action: 'Click removal', shortcut: '' },
    { id: '20', action: 'Close project', shortcut: '⌘W' },
    { id: '21', action: 'Compressor', shortcut: '' },
    { id: '22', action: 'Copy', shortcut: '⌘C' },
    { id: '23', action: 'Cut', shortcut: '⌘X' },
    { id: '24', action: 'Delete', shortcut: '⌫' },
    { id: '25', action: 'Distortion', shortcut: '' },
    { id: '26', action: 'Duplicate', shortcut: '⌘D' },
    { id: '27', action: 'Echo', shortcut: '' },
    { id: '28', action: 'Edit labels', shortcut: '' },
    { id: '29', action: 'Effect last used', shortcut: '⌘R' },
    { id: '30', action: 'Equalization', shortcut: '' },
    { id: '31', action: 'Export audio', shortcut: '⌘⇧E' },
    { id: '32', action: 'Export multiple', shortcut: '' },
    { id: '33', action: 'Export selection', shortcut: '' },
    { id: '34', action: 'Fade in', shortcut: '' },
    { id: '35', action: 'Fade out', shortcut: '' },
    { id: '36', action: 'Find clipping', shortcut: '' },
    { id: '37', action: 'Fit project', shortcut: '⌘F' },
    { id: '38', action: 'Fit to height', shortcut: '⌘⇧F' },
    { id: '39', action: 'Fit to width', shortcut: '' },
    { id: '40', action: 'Generate', shortcut: '' },
    { id: '41', action: 'Generate silence', shortcut: '⌘L' },
    { id: '42', action: 'Generate tone', shortcut: '' },
    { id: '43', action: 'Import audio', shortcut: '⌘⇧I' },
    { id: '44', action: 'Invert', shortcut: '' },
    { id: '45', action: 'Join', shortcut: '⌘J' },
    { id: '46', action: 'Labels to selections', shortcut: '' },
    { id: '47', action: 'Leveller', shortcut: '' },
    { id: '48', action: 'Limiter', shortcut: '' },
    { id: '49', action: 'Low pass filter', shortcut: '' },
    { id: '50', action: 'Macro manager', shortcut: '' },
    { id: '51', action: 'Mute all tracks', shortcut: '⌘U' },
    { id: '52', action: 'New project', shortcut: '⌘N' },
    { id: '53', action: 'Noise reduction', shortcut: '' },
    { id: '54', action: 'Normalize', shortcut: '' },
    { id: '55', action: 'Notch filter', shortcut: '' },
    { id: '56', action: 'Open project', shortcut: '⌘O' },
    { id: '57', action: 'Paste', shortcut: '⌘V' },
    { id: '58', action: 'Pause', shortcut: 'P' },
    { id: '59', action: 'Phaser', shortcut: '' },
    { id: '60', action: 'Play', shortcut: 'Space' },
    { id: '61', action: 'Play/Stop', shortcut: 'Space' },
    { id: '62', action: 'Preferences', shortcut: '⌘,' },
  ];

  return (
    <div className="preferences-page preferences-page--shortcuts">
      <div className="preferences-page__section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="preferences-page__field--medium">
            <SearchField
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              fontWeight: 400,
              color: '#14151a'
            }}>
              Search by:
            </span>
            <LabeledRadio
              label="Name"
              checked={searchBy === 'name'}
              onChange={() => setSearchBy('name')}
              name="search-by"
              value="name"
            />
            <LabeledRadio
              label="Shortcut"
              checked={searchBy === 'shortcut'}
              onChange={() => setSearchBy('shortcut')}
              name="search-by"
              value="shortcut"
            />
          </div>
        </div>

        <div className="shortcuts-table">
          <ShortcutTableHeader />
          <div className="shortcuts-table__body">
            {shortcuts.map((shortcut) => (
              <ShortcutTableRow
                key={shortcut.id}
                action={shortcut.action}
                shortcut={shortcut.shortcut}
                selected={selectedShortcut === shortcut.id}
                onClick={() => setSelectedShortcut(shortcut.id)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary">Import</Button>
            <Button variant="secondary">Export</Button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary">Clear</Button>
            <Button variant="secondary">Reset to default</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
