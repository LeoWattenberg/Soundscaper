/**
 * useTabOrder Hook
 *
 * Returns the numeric tabIndex for a given tab group ID,
 * resolved from the active accessibility profile.
 */

import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';

export function useTabOrder(groupId: string): number {
  const { activeProfile } = useAccessibilityProfile();
  if (activeProfile.config.tabNavigation === 'sequential') return 0;
  return activeProfile.config.tabOrder?.[groupId] ?? 0;
}
