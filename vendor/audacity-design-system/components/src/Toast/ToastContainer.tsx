/**
 * ToastContainer Component
 *
 * Container that positions and manages multiple toast notifications.
 * Positioned 80px from bottom and 80px from right edge.
 */

import React, { useEffect, useState } from 'react';
import { Toast, ToastProps } from './Toast';
import './ToastContainer.css';

export interface ToastContainerProps {
  /** Maximum number of toasts to display at once */
  maxToasts?: number;
  /** Position of the container */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

interface ManagedToast extends ToastProps {
  id: string;
  exiting?: boolean;
}

let toastId = 0;
const listeners: Set<(toasts: ManagedToast[]) => void> = new Set();
let toasts: ManagedToast[] = [];

function emitChange() {
  listeners.forEach((listener) => listener([...toasts]));
}

export const toast = {
  success(title: string, description?: string, actions?: ToastProps['actions'], duration = 5000) {
    return this.show({ type: 'success', title, description, actions, duration });
  },

  error(title: string, description?: string, actions?: ToastProps['actions'], duration = 0) {
    return this.show({ type: 'error', title, description, actions, duration });
  },

  warning(title: string, description?: string, actions?: ToastProps['actions'], duration = 5000) {
    return this.show({ type: 'warning', title, description, actions, duration });
  },

  info(title: string, description?: string, actions?: ToastProps['actions'], duration = 5000) {
    return this.show({ type: 'info', title, description, actions, duration });
  },

  show(props: Omit<ToastProps, 'id' | 'onDismiss'> & { duration?: number }) {
    const id = `toast-${++toastId}`;
    const newToast: ManagedToast = {
      ...props,
      id,
      onDismiss: () => this.dismiss(id),
    };

    toasts = [...toasts, newToast];
    emitChange();

    // Auto-dismiss if duration is set
    if (props.duration && props.duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, props.duration);
    }

    return id;
  },

  dismiss(id: string) {
    // Mark as exiting for animation
    toasts = toasts.map((t) =>
      t.id === id ? { ...t, exiting: true } : t
    );
    emitChange();

    // Remove after animation completes
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      emitChange();
    }, 200); // Match animation duration
  },

  dismissAll() {
    toasts = [];
    emitChange();
  },

  progress(title: string, description?: string, initialProgress = 0) {
    const id = this.show({
      type: 'info',
      title,
      description,
      showProgress: true,
      progress: initialProgress,
      duration: 0, // Don't auto-dismiss
    });
    return id;
  },

  syncing(title: string = 'Syncing to audio.com...', initialProgress = 0) {
    const id = this.show({
      type: 'syncing',
      title,
      showProgress: true,
      progress: initialProgress,
      duration: 0, // Don't auto-dismiss
    });
    return id;
  },

  updateProgress(id: string, progress: number, timeRemaining?: string) {
    toasts = toasts.map((t) =>
      t.id === id ? { ...t, progress, timeRemaining } : t
    );
    emitChange();
  },
};

export function ToastContainer({
  maxToasts = 5,
  position = 'bottom-right',
}: ToastContainerProps) {
  const [currentToasts, setCurrentToasts] = useState<ManagedToast[]>([]);

  useEffect(() => {
    listeners.add(setCurrentToasts);
    return () => {
      listeners.delete(setCurrentToasts);
    };
  }, []);

  // Limit number of visible toasts
  const visibleToasts = currentToasts.slice(-maxToasts);

  if (visibleToasts.length === 0) {
    return null;
  }

  return (
    <div className={`toast-container toast-container--${position}`}>
      {visibleToasts.map((toastProps) => (
        <div
          key={toastProps.id}
          className={toastProps.exiting ? 'toast-wrapper toast-wrapper--exiting' : 'toast-wrapper'}
        >
          <Toast {...toastProps} />
        </div>
      ))}
    </div>
  );
}

export default ToastContainer;
