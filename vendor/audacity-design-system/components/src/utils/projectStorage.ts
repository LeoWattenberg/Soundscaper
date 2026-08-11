/**
 * Project Storage Utility
 * Manages saving and loading projects from browser localStorage
 */

export interface StoredProject {
  id: string;
  title: string;
  dateCreated: number;
  dateModified: number;
  thumbnailUrl?: string;
  isCloudProject: boolean;
  isUploading?: boolean;
  data?: any; // Project-specific data (tracks, clips, etc.)
}

const STORAGE_KEY = 'audacity-projects';

/**
 * Get all saved projects from localStorage
 */
export function getProjects(): StoredProject[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading projects from localStorage:', error);
    return [];
  }
}

/**
 * Save a project to localStorage
 */
export function saveProject(project: StoredProject): void {
  try {
    const projects = getProjects();
    const existingIndex = projects.findIndex(p => p.id === project.id);

    if (existingIndex >= 0) {
      // Update existing project
      projects[existingIndex] = {
        ...project,
        dateModified: Date.now(),
      };
    } else {
      // Add new project
      projects.push({
        ...project,
        dateCreated: Date.now(),
        dateModified: Date.now(),
      });
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.error('Error saving project to localStorage:', error);
    throw error;
  }
}

/**
 * Get a single project by ID
 */
export function getProject(id: string): StoredProject | null {
  const projects = getProjects();
  return projects.find(p => p.id === id) || null;
}

/**
 * Delete a project from localStorage
 */
export function deleteProject(id: string): void {
  try {
    const projects = getProjects();
    const filtered = projects.filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting project from localStorage:', error);
    throw error;
  }
}

/**
 * Delete multiple projects
 */
export function deleteProjects(ids: string[]): void {
  try {
    const projects = getProjects();
    const filtered = projects.filter(p => !ids.includes(p.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting projects from localStorage:', error);
    throw error;
  }
}

/**
 * Export projects as JSON file
 */
export function exportProjectsToFile(): void {
  const projects = getProjects();
  const dataStr = JSON.stringify(projects, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `audacity-projects-${Date.now()}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Import projects from JSON file
 */
export function importProjectsFromFile(file: File): Promise<StoredProject[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const projects = JSON.parse(e.target?.result as string);
        if (!Array.isArray(projects)) {
          throw new Error('Invalid project file format');
        }

        // Merge with existing projects (avoid duplicates by ID)
        const existing = getProjects();
        const existingIds = new Set(existing.map(p => p.id));
        const newProjects = projects.filter((p: StoredProject) => !existingIds.has(p.id));
        const merged = [...existing, ...newProjects];

        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        resolve(newProjects);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Clear all projects (use with caution!)
 */
export function clearAllProjects(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get storage usage info
 */
export function getStorageInfo(): { used: number; total: number; available: number } {
  try {
    const data = localStorage.getItem(STORAGE_KEY) || '';
    const used = new Blob([data]).size;
    const total = 5 * 1024 * 1024; // ~5MB typical localStorage limit
    return {
      used,
      total,
      available: total - used,
    };
  } catch (error) {
    return { used: 0, total: 0, available: 0 };
  }
}
