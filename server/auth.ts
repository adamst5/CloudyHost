import passport from 'passport';
import { Strategy as DiscordStrategy } from '@oauth-everything/passport-discord';
import session from 'express-session';
import ConnectPGSimple from 'connect-pg-simple';
import { db, pool } from './db';
import { users, insertUserSchema } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';

const PostgresStore = ConnectPGSimple(session);

// Configure passport for Discord OAuth
export function configureAuth(app: Express) {
  // Trust proxy for secure cookies behind reverse proxy
  app.set('trust proxy', 1);
  
  // Session configuration
  let sessionSecret = process.env.SESSION_SECRET;
  
  // Development fallback only
  if (!sessionSecret && process.env.NODE_ENV !== 'production') {
    console.log('Using development fallback SESSION_SECRET');
    sessionSecret = '542ENJIVsSMX1m/4Rtfidv1y068Vq9o3j/Jz3pN7L8J8VZsTVX1SpHDcQ7Td0WNF5iAhlgNAbq7vYyIDC3HOcQ==';
  }
  
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  
  app.use(session({
    store: new PostgresStore({
      pool: pool,
      createTableIfMissing: true
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  }));

  // Initialize Passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport serialization
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await db.select().from(users).where(eq(users.id, id)).limit(1);
      done(null, user[0] || null);
    } catch (error) {
      done(error, null);
    }
  });

  // Discord Strategy
  let discordClientId = process.env.DISCORD_CLIENT_ID;
  let discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
  let discordCallbackUrl = process.env.DISCORD_CALLBACK_URL;
  
  // Development fallbacks only
  if (!discordClientId && process.env.NODE_ENV !== 'production') {
    console.log('Using development fallback Discord credentials');
    discordClientId = '1418634184930365582';
    discordClientSecret = 'XD4t32mASdX4TonlUL009obUE62vvXN-';
    discordCallbackUrl = 'https://9402aca3-103d-4db1-8846-4c2c5e3939ae-00-1j6kguvxzdpsp.kirk.replit.dev/auth/discord/callback';
  }
  
  if (!discordClientId || !discordClientSecret || !discordCallbackUrl) {
    throw new Error('Discord OAuth environment variables are required: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL');
  }
  
  passport.use(new DiscordStrategy({
    clientID: discordClientId,
    clientSecret: discordClientSecret,
    callbackURL: discordCallbackUrl,
    scope: ['identify', 'email']
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    try {
      // Check if user already exists
      const existingUser = await db.select().from(users)
        .where(eq(users.discordId, profile.id)).limit(1);

      if (existingUser.length > 0) {
        // Update existing user info
        const updatedUser = await db.update(users)
          .set({
            username: profile.username,
            discriminator: profile.discriminator,
            avatar: profile.avatar,
            email: profile.email,
            updatedAt: new Date()
          })
          .where(eq(users.id, existingUser[0].id))
          .returning();

        return done(null, updatedUser[0]);
      } else {
        // Create new user
        const newUserData = {
          discordId: profile.id,
          username: profile.username,
          discriminator: profile.discriminator || null,
          avatar: profile.avatar || null,
          email: profile.email || null,
        };

        // Validate the data
        const validatedData = insertUserSchema.parse(newUserData);

        const newUser = await db.insert(users).values(validatedData).returning();
        return done(null, newUser[0]);
      }
    } catch (error) {
      console.error('Discord auth error:', error);
      return done(error, null);
    }
  }));

  // Auth routes
  app.get('/auth/discord', passport.authenticate('discord'));

  app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/login-failed' }),
    (req, res) => {
      // Successful authentication
      res.redirect('/');
    }
  );

  app.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie('connect.sid');
        res.redirect('/');
      });
    });
  });

  app.get('/auth/user', (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  });
}

// Middleware to ensure user is authenticated
export function ensureAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Middleware to check bot limits based on subscription
export function checkBotLimit(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = req.user;
  // The bot count check will be implemented when we update the bot routes
  next();
}