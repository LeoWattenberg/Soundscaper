import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreferencesProvider, usePreferences } from '../PreferencesContext';
import { useEditingBehaviorPrefs } from '../PreferencesContext';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function Probe({ onValue }: { onValue: (v: ReturnType<typeof usePreferences>) => void }) {
  onValue(usePreferences());
  return null;
}

describe('PreferencesContext persistence', () => {
  it('merges stored values over defaults on load', () => {
    localStorage.setItem('audacity-preferences', JSON.stringify({ theme: 'dark' }));
    let value!: ReturnType<typeof usePreferences>;
    render(<PreferencesProvider><Probe onValue={(v) => (value = v)} /></PreferencesProvider>);
    expect(value.preferences.theme).toBe('dark');
    expect(value.preferences.clipStyle).toBe('colourful'); // default survives partial blob
  });

  it('updatePreference persists the whole blob', () => {
    let value!: ReturnType<typeof usePreferences>;
    render(<PreferencesProvider><Probe onValue={(v) => (value = v)} /></PreferencesProvider>);
    act(() => value.updatePreference('theme', 'dark'));
    const stored = JSON.parse(localStorage.getItem('audacity-preferences')!);
    expect(stored.theme).toBe('dark');
    expect(stored).toHaveProperty('trackSelectionMode'); // full blob, not a diff
  });

  it('resetPreferences restores defaults', () => {
    let value!: ReturnType<typeof usePreferences>;
    render(<PreferencesProvider><Probe onValue={(v) => (value = v)} /></PreferencesProvider>);
    act(() => value.updatePreference('theme', 'dark'));
    act(() => value.resetPreferences());
    expect(value.preferences.theme).toBe('light');
  });

  it('editing-behavior consumers do not re-render on appearance changes', () => {
    let editingRenders = 0;
    let value!: ReturnType<typeof usePreferences>;
    function EditingProbe() {
      useEditingBehaviorPrefs();
      editingRenders++;
      return null;
    }
    const Memoized = React.memo(EditingProbe);
    render(
      <PreferencesProvider>
        <Probe onValue={(v) => (value = v)} />
        <Memoized />
      </PreferencesProvider>
    );
    const before = editingRenders;
    act(() => value.updatePreference('theme', 'dark'));
    expect(editingRenders).toBe(before); // context value memoized on trackSelectionMode only
  });
});
