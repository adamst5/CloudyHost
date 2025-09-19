import fs from 'fs/promises';
import path from 'path';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export class LogStorage {
  private logsDir = path.join(process.cwd(), 'data', 'logs');

  constructor() {
    this.ensureLogsDirectory();
  }

  private async ensureLogsDirectory() {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create logs directory:', error);
    }
  }

  private getLogFilePath(botId: string): string {
    return path.join(this.logsDir, `${botId}.json`);
  }

  async getLogs(botId: string): Promise<LogEntry[]> {
    try {
      const logFile = this.getLogFilePath(botId);
      const data = await fs.readFile(logFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is empty, return empty array
      return [];
    }
  }

  async addLog(botId: string, log: LogEntry) {
    const logs = await this.getLogs(botId);
    logs.push(log);
    
    // Keep only last 1000 log entries per bot
    if (logs.length > 1000) {
      logs.shift();
    }

    const logFile = this.getLogFilePath(botId);
    await fs.writeFile(logFile, JSON.stringify(logs, null, 2));
  }

  async clearLogs(botId: string) {
    try {
      const logFile = this.getLogFilePath(botId);
      await fs.writeFile(logFile, JSON.stringify([], null, 2));
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  }

  async deleteBotLogs(botId: string) {
    try {
      const logFile = this.getLogFilePath(botId);
      await fs.unlink(logFile);
    } catch (error) {
      // File doesn't exist, that's ok
    }
  }
}

export const logStorage = new LogStorage();