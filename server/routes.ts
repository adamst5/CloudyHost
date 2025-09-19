import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
// import { WebSocketServer } from "ws"; // Temporarily disabled due to Vite conflict
import { storage } from "./storage";
import { botManager } from "./botManager";
import { dependencyManager } from "./dependencyManager";
import { insertBotSchema, subscriptionPlans } from "@shared/schema";
import { 
  safeZipExtraction, 
  validateZipMagicBytes, 
  sanitizeFileName 
} from "./security";
import { ensureAuthenticated, checkBotLimit } from "./auth";
import { db } from "./db";
import { bots, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Ensure required directories exist before starting
async function ensureDirectories() {
  try {
    await fs.mkdir('uploads', { recursive: true });
    await fs.mkdir('bots', { recursive: true });
  } catch (error) {
    console.error('Failed to create required directories:', error);
    throw error;
  }
}

// Configure multer for file uploads with enhanced security
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1, // Only one file
  },
  fileFilter: (req, file, cb) => {
    // Check MIME type
    const validMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream'
    ];
    
    if (validMimeTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Ensure directories exist when setting up routes
  await ensureDirectories();

  // Error handling middleware for multer
  app.use((error: any, req: any, res: any, next: any) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large (max 50MB)' });
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Only one file allowed' });
      }
      return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    next(error);
  });

  // Get all bots (user's bots only)
  app.get('/api/bots', ensureAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const userBots = await db.select().from(bots).where(eq(bots.userId, userId));
      
      const botsWithActivity = userBots.map(bot => ({
        ...bot,
        lastActivity: bot.lastActivity ? formatTimeAgo(new Date(bot.lastActivity)) : 'nunca'
      }));
      res.json(botsWithActivity);
    } catch (error) {
      console.error('Error fetching bots:', error);
      res.status(500).json({ error: 'Failed to fetch bots' });
    }
  });

  // Upload and create bot - SECURE IMPLEMENTATION
  app.post('/api/bots/upload', ensureAuthenticated, upload.single('zipFile'), async (req, res) => {
    let uploadedFilePath: string | null = null;
    let botPath: string | null = null;
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const userId = (req.user as any).id;
      const user = (req.user as any);

      // Check bot limit based on subscription
      const currentBotCount = await db.select().from(bots).where(eq(bots.userId, userId));
      const maxBotsAllowed = user.maxBots || subscriptionPlans[user.subscription || 'free'].maxBots;
      
      if (currentBotCount.length >= maxBotsAllowed) {
        return res.status(403).json({ 
          error: `Limite de bots atingido. Seu plano ${subscriptionPlans[user.subscription || 'free'].name} permite no máximo ${maxBotsAllowed} bots. Faça upgrade para hospedar mais bots.`,
          currentCount: currentBotCount.length,
          maxAllowed: maxBotsAllowed,
          subscription: user.subscription || 'free'
        });
      }

      uploadedFilePath = req.file.path;
      const { botName, mainFile } = req.body;
      
      // Validate input using enhanced schema with security checks
      const validation = insertBotSchema.safeParse({
        userId: userId,
        name: botName,
        mainFile: mainFile,
      });

      if (!validation.success) {
        return res.status(400).json({ 
          error: 'Invalid input', 
          details: validation.error.issues 
        });
      }

      // Additional sanitization for extra security
      const sanitizedName = sanitizeFileName(validation.data.name);
      const sanitizedMainFile = sanitizeFileName(validation.data.mainFile);

      // Create bot in database with user association
      const newBot = await db.insert(bots).values({
        userId: userId,
        name: sanitizedName,
        mainFile: sanitizedMainFile,
      }).returning();
      
      const bot = newBot[0];

      // Use botId for directory path (SECURITY: prevents user-controlled paths)
      botPath = path.join('bots', bot.id);

      // Validate uploaded file using magic bytes
      const fileBuffer = await fs.readFile(req.file.path);
      if (!validateZipMagicBytes(fileBuffer)) {
        await storage.deleteBot(bot.id);
        return res.status(400).json({ 
          error: 'Invalid ZIP file format' 
        });
      }

      // Safe zip extraction with comprehensive security checks
      const extractResult = await safeZipExtraction(fileBuffer, botPath);
      if (!extractResult.success) {
        await storage.deleteBot(bot.id);
        return res.status(400).json({ 
          error: `Extraction failed: ${extractResult.error}` 
        });
      }

      // Verify main file exists in the extracted content
      const mainFilePath = path.join(botPath, sanitizedMainFile);
      try {
        await fs.access(mainFilePath);
        
        // Additional security check: ensure it's a regular file
        const stats = await fs.stat(mainFilePath);
        if (!stats.isFile()) {
          throw new Error('Main file is not a regular file');
        }
      } catch {
        // Clean up on error
        await storage.deleteBot(bot.id);
        await fs.rm(botPath, { recursive: true, force: true });
        return res.status(400).json({ 
          error: `Main file '${sanitizedMainFile}' not found in uploaded archive or is not a valid file` 
        });
      }

      // AUTOMATIC DEPENDENCY DETECTION AND INSTALLATION
      console.log(`[Bot ${bot.id}] Detecting and installing dependencies...`);
      const dependencyResult = await dependencyManager.detectAndInstallDependencies(botPath, bot.id);
      
      let dependencyMessage = '';
      if (dependencyResult.success) {
        if (dependencyResult.dependencies && dependencyResult.dependencies.length > 0) {
          dependencyMessage = ` Dependencies installed: ${dependencyResult.dependencies.length} packages`;
          if (dependencyResult.lockFileGenerated) {
            dependencyMessage += ' (lock file generated)';
          }
        } else {
          dependencyMessage = ' No dependencies found';
        }
        console.log(`[Bot ${bot.id}] ${dependencyResult.message}`);
      } else {
        console.error(`[Bot ${bot.id}] Dependency installation failed: ${dependencyResult.message}`);
        // Don't fail the upload, but warn the user
        dependencyMessage = ` Warning: ${dependencyResult.message}`;
      }

      res.json({
        success: true,
        bot: {
          ...bot,
          lastActivity: bot.lastActivity ? formatTimeAgo(new Date(bot.lastActivity)) : 'nunca'
        },
        dependencyInstallation: {
          success: dependencyResult.success,
          message: dependencyResult.message,
          dependencies: dependencyResult.dependencies || [],
          lockFileGenerated: dependencyResult.lockFileGenerated || false
        }
      });
    } catch (error) {
      console.error('Error uploading bot:', error);
      
      // Clean up on any error
      if (botPath) {
        try {
          await fs.rm(botPath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
      }
      
      res.status(500).json({ error: 'Failed to upload bot' });
    } finally {
      // Always clean up uploaded zip file
      if (uploadedFilePath) {
        try {
          await fs.unlink(uploadedFilePath);
        } catch (cleanupError) {
          console.error('Failed to cleanup uploaded file:', cleanupError);
        }
      }
    }
  });

  // Start bot
  app.post('/api/bots/:id/start', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await botManager.startBot(id);
      
      if (success) {
        res.json({ success: true, message: 'Bot started successfully' });
      } else {
        res.status(400).json({ error: 'Failed to start bot' });
      }
    } catch (error) {
      console.error('Error starting bot:', error);
      res.status(500).json({ error: 'Failed to start bot' });
    }
  });

  // Stop bot
  app.post('/api/bots/:id/stop', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await botManager.stopBot(id);
      
      if (success) {
        res.json({ success: true, message: 'Bot stopped successfully' });
      } else {
        res.status(400).json({ error: 'Failed to stop bot' });
      }
    } catch (error) {
      console.error('Error stopping bot:', error);
      res.status(500).json({ error: 'Failed to stop bot' });
    }
  });

  // Delete bot
  app.delete('/api/bots/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await botManager.deleteBot(id);
      
      if (success) {
        res.json({ success: true, message: 'Bot deleted successfully' });
      } else {
        res.status(400).json({ error: 'Failed to delete bot' });
      }
    } catch (error) {
      console.error('Error deleting bot:', error);
      res.status(500).json({ error: 'Failed to delete bot' });
    }
  });

  // Get bot logs
  app.get('/api/bots/:id/logs', async (req, res) => {
    try {
      const { id } = req.params;
      const logs = await botManager.getLogs(id);
      res.json(logs);
    } catch (error) {
      console.error('Error fetching logs:', error);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // Clear bot logs
  app.delete('/api/bots/:id/logs', async (req, res) => {
    try {
      const { id } = req.params;
      await botManager.clearLogs(id);
      res.json({ success: true, message: 'Logs cleared' });
    } catch (error) {
      console.error('Error clearing logs:', error);
      res.status(500).json({ error: 'Failed to clear logs' });
    }
  });

  // Get bot dependency information
  app.get('/api/bots/:id/dependencies', async (req, res) => {
    try {
      const { id } = req.params;
      const bot = await storage.getBot(id);
      
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      
      const botPath = path.join('bots', id);
      const dependencyInfo = await dependencyManager.getDependencyInfo(botPath);
      
      res.json({
        success: true,
        ...dependencyInfo
      });
    } catch (error) {
      console.error('Error fetching dependency info:', error);
      res.status(500).json({ error: 'Failed to fetch dependency information' });
    }
  });

  // Reinstall bot dependencies
  app.post('/api/bots/:id/dependencies/reinstall', async (req, res) => {
    try {
      const { id } = req.params;
      const bot = await storage.getBot(id);
      
      if (!bot) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      
      const botPath = path.join('bots', id);
      const dependencyResult = await dependencyManager.detectAndInstallDependencies(botPath, id);
      
      res.json({
        success: dependencyResult.success,
        message: dependencyResult.message,
        dependencies: dependencyResult.dependencies || [],
        lockFileGenerated: dependencyResult.lockFileGenerated || false
      });
    } catch (error) {
      console.error('Error reinstalling dependencies:', error);
      res.status(500).json({ error: 'Failed to reinstall dependencies' });
    }
  });

  const httpServer = createServer(app);
  
  // Note: WebSocket temporarily disabled due to conflicts with Vite HMR
  // Real-time logs will be implemented with polling for now
  
  return httpServer;
}

// Helper function to format time ago
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'agora';
  if (diffMins < 60) return `${diffMins} minuto${diffMins !== 1 ? 's' : ''} atrás`;
  if (diffHours < 24) return `${diffHours} hora${diffHours !== 1 ? 's' : ''} atrás`;
  return `${diffDays} dia${diffDays !== 1 ? 's' : ''} atrás`;
}
