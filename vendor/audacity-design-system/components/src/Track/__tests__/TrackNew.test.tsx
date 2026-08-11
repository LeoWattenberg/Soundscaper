import { render, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { TrackNew } from '../TrackNew';
import { AccessibilityProfileProvider } from '../../contexts/AccessibilityProfileContext';
import { ThemeProvider } from '../../ThemeProvider/ThemeProvider';

afterEach(cleanup);

const CLIPS = [
  { id: 1, name: 'Clip 1', start: 0, duration: 2 },
  { id: 2, name: 'Clip 2', start: 3, duration: 2 },
];

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AccessibilityProfileProvider>
        {children}
      </AccessibilityProfileProvider>
    </ThemeProvider>
  );
}

function renderTrack(props: Record<string, unknown> = {}) {
  const result = render(
    <Providers>
      <TrackNew clips={CLIPS} width={800} trackIndex={0} {...props} />
    </Providers>,
  );
  return {
    ...result,
    clip: (id: number) => result.container.querySelector(`[data-clip-id="${id}"]`) as HTMLElement,
    track: () => result.container.querySelector('.track') as HTMLElement,
  };
}

// ---------- 1. Event propagation ----------

describe('event propagation', () => {
  it('mouseDown on clip bubbles to parent', () => {
    const parentSpy = vi.fn();
    const { container } = render(
      <Providers>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onMouseDown={parentSpy}>
          <TrackNew clips={CLIPS} width={800} trackIndex={0} />
        </div>
      </Providers>,
    );

    const clip1 = container.querySelector('[data-clip-id="1"]') as HTMLElement;
    fireEvent.mouseDown(clip1);
    expect(parentSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------- 2. Focus callbacks ----------

describe('focus callbacks', () => {
  it('focusing a clip fires onFocusChange(true)', () => {
    const onFocusChange = vi.fn();
    const { clip } = renderTrack({ onFocusChange });

    act(() => { clip(1).focus(); });
    expect(onFocusChange).toHaveBeenCalledWith(true);
  });

  it('blurring out of track fires onFocusChange(false)', () => {
    const onFocusChange = vi.fn();
    const { clip } = renderTrack({ onFocusChange });

    act(() => { clip(1).focus(); });
    onFocusChange.mockClear();

    // Move focus to an element outside the track
    const outside = document.createElement('button');
    outside.tabIndex = 0;
    document.body.appendChild(outside);
    act(() => { outside.focus(); });

    expect(onFocusChange).toHaveBeenCalledWith(false);
    document.body.removeChild(outside);
  });
});

// ---------- 3. Roving tabindex ----------

describe('roving tabindex', () => {
  it('first clip gets startTabIndex, rest get -1', () => {
    const { clip } = renderTrack({ tabIndex: 5 });

    // First clip should be the roving tab stop (non-negative), second should be excluded
    expect(clip(1).tabIndex).toBeGreaterThanOrEqual(0);
    expect(clip(2).tabIndex).toBe(-1);
  });

  it('ArrowRight moves focus and tabIndex to next clip', () => {
    const { clip, track } = renderTrack({ tabIndex: 5 });

    const clip1 = clip(1);
    const clip2 = clip(2);
    const startIdx = clip1.tabIndex;

    act(() => { clip1.focus(); });
    fireEvent.keyDown(track(), { key: 'ArrowRight' });

    expect(document.activeElement).toBe(clip2);
    expect(clip2.tabIndex).toBe(startIdx);
    expect(clip1.tabIndex).toBe(-1);
  });

  it('click updates roving tabindex to clicked clip', () => {
    const { clip } = renderTrack({ tabIndex: 5 });

    const clip1 = clip(1);
    const clip2 = clip(2);
    const startIdx = clip1.tabIndex;

    // clickCapture on the track container updates roving index
    fireEvent.click(clip2);

    expect(clip2.tabIndex).toBe(startIdx);
    expect(clip1.tabIndex).toBe(-1);
  });
});

// ---------- 4. Keyboard shortcuts on clips ----------

describe('keyboard shortcuts on clips', () => {
  it('Enter calls onClipClick', () => {
    const onClipClick = vi.fn();
    const { clip } = renderTrack({ onClipClick });

    const el = clip(1);
    act(() => { el.focus(); });
    fireEvent.keyDown(el, { key: 'Enter' });

    expect(onClipClick).toHaveBeenCalledWith(1, false, false);
  });

  it('Shift+F10 calls onClipMenuClick with keyboard flag', () => {
    const onClipMenuClick = vi.fn();
    const { clip } = renderTrack({ onClipMenuClick });

    const el = clip(1);
    act(() => { el.focus(); });
    fireEvent.keyDown(el, { key: 'F10', shiftKey: true });

    expect(onClipMenuClick).toHaveBeenCalledTimes(1);
    // 4th argument is openedViaKeyboard=true
    expect(onClipMenuClick.mock.calls[0][3]).toBe(true);
  });

  it('Cmd+ArrowRight calls onClipMove with positive delta', () => {
    const onClipMove = vi.fn();
    const { clip } = renderTrack({ onClipMove });

    const el = clip(1);
    act(() => { el.focus(); });
    fireEvent.keyDown(el, { key: 'ArrowRight', metaKey: true });

    expect(onClipMove).toHaveBeenCalledWith(1, 0.1);
  });
});

// ---------- 5. Track container keyboard ----------

describe('track container keyboard', () => {
  it('ArrowDown on track container calls onTrackNavigateVertical', () => {
    const onTrackNavigateVertical = vi.fn();
    const { track } = renderTrack({ trackTabIndex: 0, onTrackNavigateVertical });

    const el = track();
    act(() => { el.focus(); });
    fireEvent.keyDown(el, { key: 'ArrowDown' });

    expect(onTrackNavigateVertical).toHaveBeenCalledWith(1, false);
  });
});

// ---------- 6. Escape from clip to track ----------

describe('escape from clip', () => {
  it('Escape on clip moves focus to track container', () => {
    const { clip, track } = renderTrack({ trackTabIndex: 0 });

    const el = clip(1);
    act(() => { el.focus(); });
    fireEvent.keyDown(el, { key: 'Escape' });

    expect(document.activeElement).toBe(track());
  });
});
