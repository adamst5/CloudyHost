import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';

// Security configuration
const SECURITY_LIMITS = {
  MAX_UNCOMPRESSED_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB per file
  MAX_ENTRIES: 1000, // Maximum number of files in zip
  ALLOWED_EXTENSIONS: ['.js', '.ts', '.py'],
} as const;

// Sanitize file name to prevent path traversal
export function sanitizeFileName(fileName: string): string {
  // Use basename to remove any path components
  const baseName = path.basename(fileName);
  
  // Remove any remaining dangerous characters
  return baseName.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Validate that a path stays within the intended directory
export function validatePath(targetPath: string, basePath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  
  // Ensure the resolved path starts with the base path
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

// Safe zip entry validation
export function validateZipEntry(entryName: string, uncompressedSize: number): {
  isValid: boolean;
  reason?: string;
} {
  // Reject entries with path traversal attempts
  if (entryName.includes('..') || entryName.includes('/..') || entryName.includes('..\\')) {
    return { isValid: false, reason: 'Path traversal attempt detected' };
  }
  
  // Reject absolute paths
  if (path.isAbsolute(entryName)) {
    return { isValid: false, reason: 'Absolute paths not allowed' };
  }
  
  // Reject entries starting with dots (hidden files)
  if (entryName.startsWith('.') || entryName.includes('/.') || entryName.includes('\\.')) {
    return { isValid: false, reason: 'Hidden files not allowed' };
  }
  
  // Check file size
  if (uncompressedSize > SECURITY_LIMITS.MAX_FILE_SIZE) {
    return { isValid: false, reason: `File too large: ${uncompressedSize} bytes` };
  }
  
  // Validate file extension if it's a file (not directory)
  if (!entryName.endsWith('/') && !entryName.endsWith('\\')) {
    const ext = path.extname(entryName).toLowerCase();
    const allowedExtensions = [...SECURITY_LIMITS.ALLOWED_EXTENSIONS, '.txt', '.md', '.json', '.yml', '.yaml', '.env.example'];
    
    if (ext && !allowedExtensions.includes(ext)) {
      return { isValid: false, reason: `File extension not allowed: ${ext}` };
    }
  }
  
  return { isValid: true };
}

// Safe zip extraction with security checks
export async function safeZipExtraction(zipBuffer: Buffer, extractPath: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    
    // Check entry count
    if (entries.length > SECURITY_LIMITS.MAX_ENTRIES) {
      return { 
        success: false, 
        error: `Too many files in zip: ${entries.length} (max: ${SECURITY_LIMITS.MAX_ENTRIES})` 
      };
    }
    
    let totalUncompressedSize = 0;
    
    // Validate all entries first
    for (const entry of entries) {
      const validation = validateZipEntry(entry.entryName, entry.header.size);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Invalid entry "${entry.entryName}": ${validation.reason}`
        };
      }
      
      totalUncompressedSize += entry.header.size;
    }
    
    // Check total uncompressed size (zip bomb protection)
    if (totalUncompressedSize > SECURITY_LIMITS.MAX_UNCOMPRESSED_SIZE) {
      return {
        success: false,
        error: `Archive too large when uncompressed: ${totalUncompressedSize} bytes (max: ${SECURITY_LIMITS.MAX_UNCOMPRESSED_SIZE})`
      };
    }
    
    // Create extraction directory
    await fs.mkdir(extractPath, { recursive: true });
    
    // Extract each entry safely
    for (const entry of entries) {
      const sanitizedName = sanitizeFileName(entry.entryName);
      const targetPath = path.join(extractPath, sanitizedName);
      
      // Double-check the resolved path
      if (!validatePath(targetPath, extractPath)) {
        return {
          success: false,
          error: `Path validation failed for: ${entry.entryName}`
        };
      }
      
      if (entry.isDirectory) {
        await fs.mkdir(targetPath, { recursive: true });
      } else {
        // Ensure parent directory exists
        const parentDir = path.dirname(targetPath);
        await fs.mkdir(parentDir, { recursive: true });
        
        // Extract file
        const fileData = entry.getData();
        await fs.writeFile(targetPath, fileData);
      }
    }
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Magic byte validation for zip files
export function validateZipMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  
  // Check for ZIP file magic bytes
  const zipSignatures = [
    [0x50, 0x4B, 0x03, 0x04], // Standard zip
    [0x50, 0x4B, 0x05, 0x06], // Empty zip
    [0x50, 0x4B, 0x07, 0x08], // Spanned zip
  ];
  
  return zipSignatures.some(signature => 
    signature.every((byte, index) => buffer[index] === byte)
  );
}