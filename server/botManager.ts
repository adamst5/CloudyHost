import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { storage } from './storage';
import { logStorage } from './logStorage';
import type { Bot, BotStatus } from '@shared/schema';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

interface HealthCheckInfo {
  lastCheck: Date;
  lastResponse: Date | null;
  consecutiveFailures: number;
  isWaitingForResponse: boolean;
  healthCheckId?: string;
  timeoutHandle?: NodeJS.Timeout;
}

interface RetryInfo {
  attempts: number;
  lastAttempt: Date;
  nextRetryAt?: Date;
  retryTimeoutHandle?: NodeJS.Timeout;
}

class BotManager extends EventEmitter {
  private runningBots: Map<string, ChildProcess> = new Map();
  private healthCheckData: Map<string, HealthCheckInfo> = new Map();
  private retryData: Map<string, RetryInfo> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_TIMEOUT = 30000; // 30 seconds
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly BASE_RETRY_DELAY = 2000; // 2 seconds base delay

  constructor() {
    super();
    this.setupDirectories();
    // Delay recovery to allow system to initialize
    setTimeout(() => this.recoverRunningBots(), 1000);
    // Start health check monitoring
    this.startHealthCheckMonitoring();
  }

  private async setupDirectories() {
    try {
      await fs.mkdir('bots', { recursive: true });
      await fs.mkdir('uploads', { recursive: true });
    } catch (error) {
      console.error('Failed to create directories:', error);
    }
  }

  /**
   * Start health check monitoring system
   */
  private startHealthCheckMonitoring() {
    // Run health checks every minute
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL);
    
    console.log('Health check monitoring started');
  }

  /**
   * Stop health check monitoring (cleanup on shutdown)
   */
  private stopHealthCheckMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Graceful shutdown - cleanup resources
   */
  public shutdown() {
    console.log('BotManager shutting down...');
    
    // Stop health check monitoring
    this.stopHealthCheckMonitoring();
    
    // Clear any pending health check timeouts
    for (const [botId, healthInfo] of this.healthCheckData.entries()) {
      if (healthInfo.timeoutHandle) {
        clearTimeout(healthInfo.timeoutHandle);
      }
    }
    
    this.healthCheckData.clear();
    console.log('BotManager shutdown complete');
  }

  /**
   * Perform health checks on all running bots
   */
  private async performHealthChecks() {
    const runningBots = Array.from(this.runningBots.keys());
    
    if (runningBots.length === 0) {
      return;
    }

    console.log(`Performing health checks on ${runningBots.length} running bots`);
    
    for (const botId of runningBots) {
      await this.performBotHealthCheck(botId);
    }
  }

  /**
   * Perform health check on a specific bot
   */
  private async performBotHealthCheck(botId: string) {
    const childProcess = this.runningBots.get(botId);
    if (!childProcess || childProcess.killed) {
      // Bot process no longer exists, clean up
      this.runningBots.delete(botId);
      this.healthCheckData.delete(botId);
      await storage.updateBotStatus(botId, 'error');
      await this.addLog(botId, 'error', 'Bot process no longer exists');
      return;
    }

    // Get or create health check info
    let healthInfo = this.healthCheckData.get(botId);
    if (!healthInfo) {
      healthInfo = {
        lastCheck: new Date(),
        lastResponse: null,
        consecutiveFailures: 0,
        isWaitingForResponse: false,
      };
      this.healthCheckData.set(botId, healthInfo);
    }

    // Skip if already waiting for response
    if (healthInfo.isWaitingForResponse) {
      // Check if timeout exceeded
      const timeSinceLastCheck = Date.now() - healthInfo.lastCheck.getTime();
      if (timeSinceLastCheck > this.HEALTH_CHECK_TIMEOUT) {
        await this.handleHealthCheckFailure(botId, 'Health check timeout');
      }
      return;
    }

    // Send health check ping
    const healthCheckId = this.generateHealthCheckId();
    const healthCheckCommand = `__HEALTH_CHECK__:${healthCheckId}\n`;
    
    try {
      healthInfo.lastCheck = new Date();
      healthInfo.isWaitingForResponse = true;
      healthInfo.healthCheckId = healthCheckId;
      
      // Send health check command via stdin
      if (childProcess.stdin && !childProcess.stdin.destroyed) {
        childProcess.stdin.write(healthCheckCommand);
        
        // Set timeout for response and store handle to prevent double counting
        const timeoutHandle = setTimeout(() => {
          if (healthInfo && healthInfo.isWaitingForResponse && healthInfo.healthCheckId === healthCheckId) {
            this.handleHealthCheckFailure(botId, 'Health check response timeout');
          }
        }, this.HEALTH_CHECK_TIMEOUT);
        
        healthInfo.timeoutHandle = timeoutHandle;
        
        await this.addLog(botId, 'debug', `Health check sent: ${healthCheckId}`);
      } else {
        await this.handleHealthCheckFailure(botId, 'Cannot send health check - stdin not available');
      }
    } catch (error) {
      await this.handleHealthCheckFailure(botId, `Health check send error: ${error}`);
    }
  }

  /**
   * Generate unique health check ID
   */
  private generateHealthCheckId(): string {
    return `hc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle health check failure
   */
  private async handleHealthCheckFailure(botId: string, reason: string) {
    const healthInfo = this.healthCheckData.get(botId);
    if (!healthInfo) return;

    // Clear timeout to prevent double counting
    if (healthInfo.timeoutHandle) {
      clearTimeout(healthInfo.timeoutHandle);
      healthInfo.timeoutHandle = undefined;
    }

    healthInfo.isWaitingForResponse = false;
    healthInfo.consecutiveFailures++;
    
    await this.addLog(botId, 'warn', `Health check failed: ${reason} (failures: ${healthInfo.consecutiveFailures})`);
    
    if (healthInfo.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      // Mark bot as unresponsive
      await storage.updateBotStatus(botId, 'unresponsive');
      await this.addLog(botId, 'error', `Bot marked as unresponsive after ${healthInfo.consecutiveFailures} consecutive failures`);
      
      // Optionally restart the bot
      // await this.restartUnresponsiveBot(botId);
    }
  }

  /**
   * Handle health check success
   */
  private async handleHealthCheckSuccess(botId: string, healthCheckId: string) {
    const healthInfo = this.healthCheckData.get(botId);
    if (!healthInfo || healthInfo.healthCheckId !== healthCheckId) {
      return; // Ignore outdated responses
    }

    // Clear timeout to prevent double counting
    if (healthInfo.timeoutHandle) {
      clearTimeout(healthInfo.timeoutHandle);
      healthInfo.timeoutHandle = undefined;
    }

    healthInfo.isWaitingForResponse = false;
    healthInfo.lastResponse = new Date();
    healthInfo.consecutiveFailures = 0;
    
    // Update bot status to running if it was unresponsive
    const bot = await storage.getBot(botId);
    if (bot && bot.status === 'unresponsive') {
      await storage.updateBotStatus(botId, 'running');
      await this.addLog(botId, 'info', 'Bot is now responsive again');
    }
    
    await this.addLog(botId, 'debug', `Health check passed: ${healthCheckId}`);
  }

  /**
   * Recover bots that were marked as running before restart
   * This runs on startup to restore bot states
   */
  private async recoverRunningBots() {
    try {
      const allBots = await storage.getAllBots();
      const runningBots = allBots.filter(bot => bot.status === 'running');
      
      if (runningBots.length > 0) {
        console.log(`Found ${runningBots.length} bots that were running before restart`);
        
        for (const bot of runningBots) {
          // Reset status to stopped as we need to restart them
          await storage.updateBotStatus(bot.id, 'stopped');
          await this.addLog(bot.id, 'info', 'Bot status reset after platform restart');
          
          // Optionally auto-restart them
          // Uncomment the line below to auto-restart bots after platform restart
          // await this.startBot(bot.id);
        }
      }
      
      console.log('Bot recovery completed');
    } catch (error) {
      console.error('Failed to recover running bots:', error);
    }
  }

  private generateLogId(): string {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  private async addLog(botId: string, level: LogEntry['level'], message: string) {
    const logEntry: LogEntry = {
      id: this.generateLogId(),
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      level,
      message,
    };

    // Save to persistent storage
    await logStorage.addLog(botId, logEntry);
    
    // Emit log event for real-time updates
    this.emit('log', { botId, log: logEntry });
  }

  /**
   * Check if a message is a health check response
   */
  private isHealthCheckResponse(message: string): boolean {
    return message.includes('__HEALTH_CHECK_RESPONSE__:');
  }

  /**
   * Process health check response from bot
   */
  private processHealthCheckResponse(botId: string, message: string) {
    try {
      // Extract health check ID from response using precise regex
      // Expected format: __HEALTH_CHECK_RESPONSE__:hc_timestamp_randomid
      const match = message.match(/__HEALTH_CHECK_RESPONSE__:(\S+)/);
      if (match && match[1]) {
        const healthCheckId = match[1].trim();
        this.handleHealthCheckSuccess(botId, healthCheckId);
      } else {
        this.addLog(botId, 'warn', 'Malformed health check response received');
      }
    } catch (error) {
      this.addLog(botId, 'error', `Error processing health check response: ${error}`);
    }
  }

  async startBot(botId: string): Promise<boolean> {
    try {
      const bot = await storage.getBot(botId);
      if (!bot) {
        throw new Error(`Bot ${botId} not found`);
      }

      if (this.runningBots.has(botId)) {
        await this.addLog(botId, 'warn', 'Bot already running');
        return false;
      }

      await storage.updateBotStatus(botId, 'starting');
      await this.addLog(botId, 'info', `Starting bot: ${bot.name}`);

      // SECURITY: Use botId for directory path instead of user-controlled bot.name
      const botPath = path.join('bots', botId);
      const mainFilePath = path.join(botPath, bot.mainFile);

      // Check if main file exists
      try {
        await fs.access(mainFilePath);
      } catch {
        await storage.updateBotStatus(botId, 'error');
        await this.addLog(botId, 'error', `Main file not found: ${bot.mainFile}`);
        return false;
      }

      // Determine command based on file extension
      let command: string;
      let args: string[];

      const ext = path.extname(bot.mainFile).toLowerCase();
      if (ext === '.js' || ext === '.ts') {
        command = 'node';
        args = [bot.mainFile];
      } else if (ext === '.py') {
        // Check if virtual environment exists
        const venvPath = path.join(botPath, 'venv');
        const pythonVenvPath = process.platform === 'win32' 
          ? path.join(venvPath, 'Scripts', 'python')
          : path.join(venvPath, 'bin', 'python');
        
        try {
          await fs.access(pythonVenvPath);
          // Use virtual environment Python
          command = pythonVenvPath;
          args = [bot.mainFile];
          await this.addLog(botId, 'info', 'Using Python virtual environment');
        } catch {
          // Fallback to system Python if venv doesn't exist
          command = 'python3';
          args = [bot.mainFile];
          await this.addLog(botId, 'warn', 'Virtual environment not found, using system Python');
        }
      } else {
        await storage.updateBotStatus(botId, 'error');
        await this.addLog(botId, 'error', `Unsupported file type: ${ext}`);
        return false;
      }

      const childProcess = spawn(command, args, {
        cwd: botPath,
        stdio: 'pipe',
        env: { ...process.env },
      });

      this.runningBots.set(botId, childProcess);

      // Handle stdout
      childProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        // Split into lines to handle chunks properly
        const lines = output.split('\n');
        
        for (const line of lines) {
          const message = line.trim();
          if (message) {
            // Check for health check response
            if (this.isHealthCheckResponse(message)) {
              this.processHealthCheckResponse(botId, message);
            } else {
              this.addLog(botId, 'info', message);
            }
          }
        }
      });

      // Handle stderr
      childProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          this.addLog(botId, 'error', message);
        }
      });

      // Handle process exit
      childProcess.on('exit', async (code, signal) => {
        this.runningBots.delete(botId);
        this.healthCheckData.delete(botId); // Clean up health check data
        
        const status: BotStatus = code === 0 ? 'stopped' : 'error';
        await storage.updateBotStatus(botId, status);
        
        if (signal) {
          await this.addLog(botId, 'warn', `Bot process terminated by signal: ${signal}`);
        } else {
          await this.addLog(botId, 'info', `Bot process exited with code: ${code}`);
        }

        // Attempt smart retry if bot crashed unexpectedly
        if (code !== 0 && signal !== 'SIGTERM') {
          await this.scheduleSmartRetry(botId);
        }
      });

      // Handle process errors
      childProcess.on('error', async (error) => {
        this.runningBots.delete(botId);
        
        // Clean up health check data and clear any pending timeouts
        const healthInfo = this.healthCheckData.get(botId);
        if (healthInfo?.timeoutHandle) {
          clearTimeout(healthInfo.timeoutHandle);
        }
        this.healthCheckData.delete(botId);
        
        await storage.updateBotStatus(botId, 'error');
        await this.addLog(botId, 'error', `Process error: ${error.message}`);
      });

      // Mark as running after successful start
      setTimeout(async () => {
        if (this.runningBots.has(botId) && !childProcess.killed) {
          await storage.updateBotStatus(botId, 'running', childProcess.pid?.toString());
          await this.addLog(botId, 'info', 'Bot is now running');
        }
      }, 1000);

      return true;
    } catch (error) {
      await storage.updateBotStatus(botId, 'error');
      await this.addLog(botId, 'error', `Failed to start bot: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async stopBot(botId: string): Promise<boolean> {
    try {
      const childProcess = this.runningBots.get(botId);
      if (!childProcess) {
        await this.addLog(botId, 'warn', 'Bot is not running');
        return false;
      }

      await this.addLog(botId, 'info', 'Stopping bot...');

      // Remove from running bots immediately to prevent race conditions
      this.runningBots.delete(botId);
      
      // Update status to stopping
      await storage.updateBotStatus(botId, 'stopped');

      return new Promise<boolean>((resolve) => {
        let isResolved = false;
        
        // Handle process exit cleanly
        const onExit = (code: number | null, signal: string | null) => {
          if (isResolved) return;
          isResolved = true;
          
          if (signal) {
            this.addLog(botId, 'info', `Bot stopped by signal: ${signal}`);
          } else {
            this.addLog(botId, 'info', `Bot stopped with code: ${code}`);
          }
          resolve(true);
        };

        const onError = (error: Error) => {
          if (isResolved) return;
          isResolved = true;
          this.addLog(botId, 'error', `Error stopping bot: ${error.message}`);
          resolve(false);
        };

        // Set up event listeners
        childProcess.once('exit', onExit);
        childProcess.once('error', onError);

        // Try graceful shutdown first
        try {
          childProcess.kill('SIGTERM');
        } catch (killError) {
          if (isResolved) return;
          isResolved = true;
          this.addLog(botId, 'error', `Failed to send SIGTERM: ${killError instanceof Error ? killError.message : 'Unknown error'}`);
          resolve(false);
          return;
        }

        // Force kill after 5 seconds if still running
        const forceKillTimeout = setTimeout(() => {
          if (isResolved) return;
          
          try {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
              this.addLog(botId, 'warn', 'Bot force-killed after timeout');
            }
          } catch (killError) {
            this.addLog(botId, 'error', `Failed to force kill: ${killError instanceof Error ? killError.message : 'Unknown error'}`);
          }
          
          // Clean up listeners and resolve
          if (!isResolved) {
            isResolved = true;
            childProcess.removeListener('exit', onExit);
            childProcess.removeListener('error', onError);
            resolve(true);
          }
        }, 5000);

        // Clean up timeout when process exits normally
        childProcess.once('exit', () => {
          clearTimeout(forceKillTimeout);
        });
      });
    } catch (error) {
      this.addLog(botId, 'error', `Failed to stop bot: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  async getLogs(botId: string): Promise<LogEntry[]> {
    return await logStorage.getLogs(botId);
  }

  async clearLogs(botId: string): Promise<void> {
    await logStorage.clearLogs(botId);
    await this.addLog(botId, 'info', 'Logs cleared');
  }

  async deleteBot(botId: string): Promise<boolean> {
    try {
      // Stop bot if running
      if (this.runningBots.has(botId)) {
        await this.stopBot(botId);
      }

      const bot = await storage.getBot(botId);
      if (bot) {
        // Remove bot files - SECURITY: Use botId for directory path
        const botPath = path.join('bots', botId);
        try {
          await fs.rm(botPath, { recursive: true, force: true });
          this.addLog(botId, 'info', `Removed bot files: ${botPath}`);
        } catch (error) {
          console.error(`Failed to remove bot files: ${error}`);
        }
      }

      // Remove from storage
      await storage.deleteBot(botId);
      
      // Clear logs from persistent storage
      await logStorage.deleteBotLogs(botId);

      return true;
    } catch (error) {
      console.error(`Failed to delete bot ${botId}:`, error);
      return false;
    }
  }

  /**
   * Schedule a smart retry with exponential backoff
   */
  private async scheduleSmartRetry(botId: string): Promise<void> {
    try {
      const retryInfo = this.retryData.get(botId) || {
        attempts: 0,
        lastAttempt: new Date(),
      };

      // Check if we've exceeded max retries
      if (retryInfo.attempts >= this.MAX_RETRY_ATTEMPTS) {
        await this.addLog(botId, 'error', `Max retry attempts (${this.MAX_RETRY_ATTEMPTS}) reached. Bot will not restart automatically.`);
        this.retryData.delete(botId);
        return;
      }

      // Calculate exponential backoff delay: 2^attempts * base_delay + jitter
      const baseDelay = this.BASE_RETRY_DELAY * Math.pow(2, retryInfo.attempts);
      const jitter = Math.random() * 1000; // Add up to 1 second of jitter
      const retryDelay = baseDelay + jitter;

      retryInfo.attempts++;
      retryInfo.lastAttempt = new Date();
      retryInfo.nextRetryAt = new Date(Date.now() + retryDelay);

      // Clear any existing retry timeout
      if (retryInfo.retryTimeoutHandle) {
        clearTimeout(retryInfo.retryTimeoutHandle);
      }

      await this.addLog(botId, 'info', `Scheduling restart attempt ${retryInfo.attempts}/${this.MAX_RETRY_ATTEMPTS} in ${Math.round(retryDelay / 1000)}s`);

      retryInfo.retryTimeoutHandle = setTimeout(async () => {
        await this.addLog(botId, 'info', `Attempting automatic restart (${retryInfo.attempts}/${this.MAX_RETRY_ATTEMPTS})`);
        
        const success = await this.startBot(botId);
        
        if (success) {
          await this.addLog(botId, 'info', 'Automatic restart successful');
          // Reset retry counter on successful restart
          this.retryData.delete(botId);
        } else {
          await this.addLog(botId, 'warn', 'Automatic restart failed');
          // The startBot failure will trigger another retry cycle
        }
      }, retryDelay);

      this.retryData.set(botId, retryInfo);
    } catch (error) {
      await this.addLog(botId, 'error', `Failed to schedule retry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cancel pending retries for a bot
   */
  private cancelRetries(botId: string): void {
    const retryInfo = this.retryData.get(botId);
    if (retryInfo?.retryTimeoutHandle) {
      clearTimeout(retryInfo.retryTimeoutHandle);
    }
    this.retryData.delete(botId);
  }

  // Cleanup on shutdown
  async shutdown(): Promise<void> {
    // Clear all retry timeouts
    for (const [botId, retryInfo] of this.retryData.entries()) {
      if (retryInfo.retryTimeoutHandle) {
        clearTimeout(retryInfo.retryTimeoutHandle);
      }
    }
    this.retryData.clear();
    
    const promises = Array.from(this.runningBots.keys()).map(botId => this.stopBot(botId));
    await Promise.all(promises);
  }
}

export const botManager = new BotManager();

// Graceful shutdown
process.on('SIGTERM', () => botManager.shutdown());
process.on('SIGINT', () => botManager.shutdown());