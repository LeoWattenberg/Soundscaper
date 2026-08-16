import React, { useState, useRef, useEffect } from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../Button';
import { DialogSideNav } from '../DialogSideNav/DialogSideNav';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';
import type { PreferencesPage, PreferencesModalProps } from './types';
import { menuItems } from './menuItems';
import { TabGroupField } from './TabGroupField';
import { EditingPage } from './pages/EditingPage';
import { ShortcutsPage } from './pages/ShortcutsPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { GeneralPage } from './pages/GeneralPage';
import { AppearancePage } from './pages/AppearancePage';
import { PluginsPage } from './pages/PluginsPage';
import { CloudPage } from './pages/CloudPage';
import { AudioSettingsPage } from './pages/AudioSettingsPage';
import { PlaybackRecordingPage } from './pages/PlaybackRecordingPage';
import { SpectralDisplayPage } from './pages/SpectralDisplayPage';
import './PreferencesModal.css';

export type { PreferencesPage, PreferencesModalProps };

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  currentPage = 'general',
  onPageChange,
  os = 'macos',
  className = '',
  zoomToggleLevel1 = 'zoom-default',
  onZoomToggleLevel1Change,
  zoomToggleLevel2 = 'seconds',
  onZoomToggleLevel2Change,
  onResetWarnings,
  onOpenPluginManager,
  accountsContent,
}) => {
  const [selectedPage, setSelectedPage] = useState<PreferencesPage>(currentPage);
  const contentRef = useRef<HTMLDivElement>(null);
  const [focusedRegion, setFocusedRegion] = useState<'sidebar' | 'content'>('sidebar');
  const { activeProfile } = useAccessibilityProfile();

  // Footer tab group state
  const footerRefs = useRef<(HTMLElement | null)[]>([]);
  const footerActiveIndexRef = useRef<number>(0);
  const [footerActiveIndex, setFooterActiveIndex] = useState<number>(0);

  // Sync footer state with ref
  useEffect(() => {
    footerActiveIndexRef.current = footerActiveIndex;
  }, [footerActiveIndex]);

  // Reset footer active index when modal opens or page changes
  useEffect(() => {
    if (isOpen) {
      setFooterActiveIndex(0);
      footerActiveIndexRef.current = 0;
    }
  }, [isOpen, selectedPage]);

  const handlePageChange = (page: PreferencesPage) => {
    setSelectedPage(page);
    onPageChange?.(page);
  };

  // Handle F6 keyboard navigation between regions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F6 to cycle between regions
      if (e.key === 'F6') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+F6: Go to sidebar
          const sidebar = document.querySelector('.dialog-sidenav');
          if (sidebar) {
            const firstButton = sidebar.querySelector<HTMLButtonElement>('button');
            firstButton?.focus();
            setFocusedRegion('sidebar');
          }
        } else {
          // F6: Go to content
          if (contentRef.current) {
            const firstFocusable = contentRef.current.querySelector<HTMLElement>(
              'button:not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([tabindex="-1"]), select:not([tabindex="-1"]), textarea:not([tabindex="-1"])'
            );
            if (firstFocusable) {
              firstFocusable.focus();
              setFocusedRegion('content');
            }
          }
        }
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Preferences"
      os={os}
      className={`preferences-modal ${className}`}
      width="880px"
      maximizable={true}
      closeOnClickOutside={false}
    >
      <div className="preferences-modal__content">
        {/* Sidebar Menu */}
        <DialogSideNav
          items={menuItems}
          selectedId={selectedPage}
          onSelectId={handlePageChange}
          ariaLabel="Preferences navigation"
          className="preferences-modal__sidebar"
        />

        {/* Content Area */}
        <main
          ref={contentRef}
          className="preferences-modal__body"
          role="tabpanel"
          id="preferences-content"
          aria-label={`${selectedPage} preferences`}
        >
          <div className="preferences-modal__scroll-container" tabIndex={-1}>
            {selectedPage === 'general' && <GeneralPage onResetWarnings={onResetWarnings} />}
            {selectedPage === 'accounts' && (
              <div className="preferences-page">{accountsContent}</div>
            )}
            {selectedPage === 'appearance' && <AppearancePage />}
            {selectedPage === 'audio-settings' && <AudioSettingsPage />}
            {selectedPage === 'playback-recording' && <PlaybackRecordingPage />}
            {selectedPage === 'spectral-display' && <SpectralDisplayPage />}
            {selectedPage === 'editing' && (
              <EditingPage
                zoomToggleLevel1={zoomToggleLevel1}
                onZoomToggleLevel1Change={onZoomToggleLevel1Change}
                zoomToggleLevel2={zoomToggleLevel2}
                onZoomToggleLevel2Change={onZoomToggleLevel2Change}
              />
            )}
            {selectedPage === 'shortcuts' && <ShortcutsPage />}
            {selectedPage === 'plugins' && <PluginsPage onOpenPluginManager={onOpenPluginManager} />}
            {selectedPage === 'cloud' && <CloudPage />}
          </div>
        </main>
      </div>

      {/* Footer */}
      <div className="preferences-modal__footer">
        <TabGroupField
          groupId="dialog-footer"
          itemIndex={0}
          totalItems={3}
          itemRefs={footerRefs}
          activeIndexRef={footerActiveIndexRef}
          activeIndex={footerActiveIndex}
          onActiveIndexChange={setFooterActiveIndex}
          resetKey={selectedPage}
        >
          <Button variant="secondary" onClick={() => {/* Reset */}}>
            Reset preferences
          </Button>
        </TabGroupField>
        <div className="preferences-modal__footer-actions">
          <TabGroupField
            groupId="dialog-footer"
            itemIndex={1}
            totalItems={3}
            itemRefs={footerRefs}
            activeIndexRef={footerActiveIndexRef}
            activeIndex={footerActiveIndex}
            onActiveIndexChange={setFooterActiveIndex}
            resetKey={selectedPage}
          >
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </TabGroupField>
          <TabGroupField
            groupId="dialog-footer"
            itemIndex={2}
            totalItems={3}
            itemRefs={footerRefs}
            activeIndexRef={footerActiveIndexRef}
            activeIndex={footerActiveIndex}
            onActiveIndexChange={setFooterActiveIndex}
            resetKey={selectedPage}
          >
            <Button variant="primary" onClick={onClose}>
              OK
            </Button>
          </TabGroupField>
        </div>
      </div>
    </Dialog>
  );
};

export default PreferencesModal;
