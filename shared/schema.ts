import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  discriminator: text("discriminator"),
  avatar: text("avatar"),
  email: text("email"),
  subscription: text("subscription").$type<'free' | 'basico' | 'pro' | 'ultra'>().notNull().default('free'),
  maxBots: integer("max_bots").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const bots = pgTable("bots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  mainFile: text("main_file").notNull(),
  status: text("status").$type<'running' | 'stopped' | 'starting' | 'error' | 'unresponsive'>().notNull().default('stopped'),
  processId: text("process_id"),
  lastActivity: timestamp("last_activity").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  discordId: true,
  username: true,
  discriminator: true,
  avatar: true,
  email: true,
}).extend({
  discordId: z.string().min(1, "Discord ID is required"),
  username: z.string().min(1, "Username is required").max(32, "Username too long"),
  discriminator: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  email: z.string().email("Invalid email").nullable().optional(),
});

// Enhanced validation with security constraints
export const insertBotSchema = createInsertSchema(bots).pick({
  userId: true,
  name: true,
  mainFile: true,
}).extend({
  userId: z.string().min(1, "User ID is required"),
  // Secure bot name validation - prevent path traversal
  name: z.string()
    .min(1, "Bot name is required")
    .max(50, "Bot name must be 50 characters or less")
    .regex(/^[a-zA-Z0-9_-]+$/, "Bot name can only contain letters, numbers, underscores, and hyphens")
    .refine(name => !name.includes('..') && !name.startsWith('.') && name !== '.' && name !== '..', 
      "Invalid bot name"),
  
  // Secure main file validation - prevent path traversal and limit extensions
  mainFile: z.string()
    .min(1, "Main file is required")
    .max(100, "Main file name must be 100 characters or less")
    .regex(/^[^/\\:*?"<>|]+$/, "Main file name contains invalid characters")
    .regex(/\.(js|ts|py)$/i, "Main file must have .js, .ts, or .py extension")
    .refine(file => !file.includes('..') && !file.startsWith('.') && !file.includes('/') && !file.includes('\\'),
      "Invalid main file path")
});

// Subscription plan definitions
export const subscriptionPlans = {
  free: {
    name: 'Free',
    maxBots: 1,
    price: 'R$0,00',
    ram: '1GB',
    vcpu: '1.5',
  },
  basico: {
    name: 'Básico',
    maxBots: 2,
    price: 'R$9,90',
    ram: '2GB',
    vcpu: '2',
  },
  pro: {
    name: 'Pro',
    maxBots: 5,
    price: 'R$19,90',
    ram: '4GB',
    vcpu: '3',
  },
  ultra: {
    name: 'Ultra',
    maxBots: 10,
    price: 'R$34,90',
    ram: '8GB',
    vcpu: '4',
  },
} as const;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof bots.$inferSelect;
export type BotStatus = Bot['status'];
export type SubscriptionPlan = keyof typeof subscriptionPlans;
