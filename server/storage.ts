import { FileStorage } from './fileStorage';

// Export the FileStorage for persistent data
export const storage = new FileStorage();

// Re-export interfaces for backwards compatibility  
export type { IStorage } from './fileStorage';
