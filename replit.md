# Cloudy Host

## Overview

This is a local bot hosting platform built with a modern full-stack architecture. The application allows users to upload, manage, and monitor bots through a clean, dashboard-style interface. Users can upload bot files as ZIP archives, start/stop bots, view real-time logs, and monitor bot status and activity.

The platform is designed to be a self-contained hosting solution for various types of bots (Discord, Telegram, WhatsApp, etc.) with support for JavaScript, TypeScript, and Python bot files. It provides a comprehensive management interface with real-time monitoring capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for development and production builds
- **UI Framework**: Radix UI components with shadcn/ui design system
- **Styling**: Tailwind CSS with custom design tokens and dark mode support
- **State Management**: TanStack Query for server state management
- **Routing**: Wouter for lightweight client-side routing

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Process Management**: Built-in child process spawning for bot execution
- **File Handling**: Multer for file uploads with security validation
- **Security**: ZIP extraction validation, path traversal prevention, file type restrictions

### Data Storage Solutions
- **Database**: PostgreSQL with Drizzle ORM for schema management
- **File Storage**: Local file system for bot files and uploads
- **Log Storage**: JSON-based file storage for bot logs with rotation
- **Session Storage**: PostgreSQL-backed sessions with connect-pg-simple

### Design System
- **Visual Style**: Clean, utility-focused dashboard design inspired by Vercel/Railway
- **Color Scheme**: Dark mode primary with carefully chosen semantic colors
- **Typography**: Inter for UI text, JetBrains Mono for code/logs
- **Components**: Comprehensive component library with consistent styling

### Bot Management System
- **Lifecycle Management**: Start, stop, restart operations with status tracking
- **Process Monitoring**: Real-time status updates and process health checks
- **Log Management**: Structured logging with different severity levels
- **Recovery**: Automatic bot state recovery after platform restarts

### Security Features
- **File Upload Security**: Magic byte validation, size limits, path traversal prevention
- **ZIP Extraction**: Safe extraction with compression bomb protection
- **Input Validation**: Zod schema validation for all user inputs
- **File System Security**: Sandboxed bot execution with restricted file access

## External Dependencies

### Core Framework Dependencies
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database queries and schema management
- **express**: Web application framework
- **multer**: Multipart form data handling for file uploads

### UI and Styling Dependencies
- **@radix-ui/***: Comprehensive collection of unstyled, accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Component variant management
- **clsx**: Conditional className utility

### Development and Build Tools
- **vite**: Fast build tool and development server
- **typescript**: Static type checking
- **tsx**: TypeScript execution for Node.js
- **esbuild**: Fast bundling for production builds

### Utility Dependencies
- **adm-zip**: ZIP file extraction and validation
- **zod**: Runtime type validation and schema definition
- **date-fns**: Date manipulation utilities
- **nanoid**: Unique ID generation

### Planned Integrations
- PostgreSQL database (configured but may need setup)
- WebSocket support for real-time log streaming (architecture ready)
- Process monitoring and alerting systems