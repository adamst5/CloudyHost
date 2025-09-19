import { type User, type InsertUser, type Bot, type InsertBot, type BotStatus } from "@shared/schema";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Bot methods
  getAllBots(): Promise<Bot[]>;
  getBot(id: string): Promise<Bot | undefined>;
  createBot(bot: InsertBot): Promise<Bot>;
  updateBotStatus(id: string, status: BotStatus, processId?: string): Promise<Bot | undefined>;
  updateBotActivity(id: string): Promise<Bot | undefined>;
  deleteBot(id: string): Promise<boolean>;
}

export class FileStorage implements IStorage {
  private dataDir = path.join(process.cwd(), 'data');
  private usersFile = path.join(this.dataDir, 'users.json');
  private botsFile = path.join(this.dataDir, 'bots.json');

  constructor() {
    this.ensureDataDirectory();
  }

  private async ensureDataDirectory() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create data directory:', error);
    }
  }

  private async readUsers(): Promise<Map<string, User>> {
    try {
      const data = await fs.readFile(this.usersFile, 'utf8');
      const users = JSON.parse(data);
      return new Map(Object.entries(users));
    } catch (error) {
      // File doesn't exist or is empty, return empty map
      return new Map();
    }
  }

  private async writeUsers(users: Map<string, User>) {
    const data = Object.fromEntries(users);
    await fs.writeFile(this.usersFile, JSON.stringify(data, null, 2));
  }

  private async readBots(): Promise<Map<string, Bot>> {
    try {
      const data = await fs.readFile(this.botsFile, 'utf8');
      const bots = JSON.parse(data);
      // Convert date strings back to Date objects
      const botMap = new Map<string, Bot>();
      Object.entries(bots).forEach(([id, bot]: [string, any]) => {
        botMap.set(id, {
          ...bot,
          lastActivity: new Date(bot.lastActivity),
          createdAt: new Date(bot.createdAt)
        });
      });
      return botMap;
    } catch (error) {
      // File doesn't exist or is empty, return empty map
      return new Map();
    }
  }

  private async writeBots(bots: Map<string, Bot>) {
    const data = Object.fromEntries(bots);
    await fs.writeFile(this.botsFile, JSON.stringify(data, null, 2));
  }

  async getUser(id: string): Promise<User | undefined> {
    const users = await this.readUsers();
    return users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const users = await this.readUsers();
    return Array.from(users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const users = await this.readUsers();
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    users.set(id, user);
    await this.writeUsers(users);
    return user;
  }

  async getAllBots(): Promise<Bot[]> {
    const bots = await this.readBots();
    return Array.from(bots.values());
  }

  async getBot(id: string): Promise<Bot | undefined> {
    const bots = await this.readBots();
    return bots.get(id);
  }

  async createBot(insertBot: InsertBot): Promise<Bot> {
    const bots = await this.readBots();
    const id = randomUUID();
    const bot: Bot = {
      ...insertBot,
      id,
      status: 'stopped',
      processId: null,
      lastActivity: new Date(),
      createdAt: new Date(),
    };
    bots.set(id, bot);
    await this.writeBots(bots);
    return bot;
  }

  async updateBotStatus(id: string, status: BotStatus, processId?: string): Promise<Bot | undefined> {
    const bots = await this.readBots();
    const bot = bots.get(id);
    if (!bot) return undefined;
    
    const updatedBot = {
      ...bot,
      status,
      processId: processId || bot.processId,
      lastActivity: new Date(),
    };
    
    bots.set(id, updatedBot);
    await this.writeBots(bots);
    return updatedBot;
  }

  async updateBotActivity(id: string): Promise<Bot | undefined> {
    const bots = await this.readBots();
    const bot = bots.get(id);
    if (!bot) return undefined;
    
    const updatedBot = {
      ...bot,
      lastActivity: new Date(),
    };
    
    bots.set(id, updatedBot);
    await this.writeBots(bots);
    return updatedBot;
  }

  async deleteBot(id: string): Promise<boolean> {
    const bots = await this.readBots();
    const result = bots.delete(id);
    if (result) {
      await this.writeBots(bots);
      
      // Also clean up bot directory and logs
      try {
        const botDir = path.join(process.cwd(), 'bots', id);
        await fs.rm(botDir, { recursive: true, force: true });
      } catch (error) {
        console.error('Failed to clean up bot directory:', error);
      }
    }
    return result;
  }
}