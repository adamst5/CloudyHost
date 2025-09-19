# Cloudy Host Design Guidelines

## Design Approach
**Utility-Focused Design System Approach** - Using a clean, dashboard-style interface inspired by platforms like Vercel, Railway, and Heroku. The focus is on clarity, efficiency, and technical functionality rather than marketing appeal.

## Core Design Elements

### A. Color Palette
**Dark Mode Primary:**
- Background: 220 13% 9% (deep dark blue-gray)
- Surface: 220 13% 13% (elevated surfaces)
- Primary: 217 91% 60% (bright blue for actions)
- Success: 142 69% 58% (green for running bots)
- Warning: 38 92% 50% (orange for pending states)
- Error: 0 84% 60% (red for stopped/failed bots)
- Text Primary: 220 13% 95%
- Text Secondary: 220 9% 65%

### B. Typography
- **Primary Font:** Inter via Google Fonts
- **Monospace:** JetBrains Mono for logs and file paths
- Hierarchy: Clean, technical typography with generous line spacing

### C. Layout System
- **Spacing Units:** Tailwind units of 2, 4, 6, and 8 (p-2, m-4, gap-6, h-8)
- **Grid System:** CSS Grid for main layout, Flexbox for components
- **Max Width:** Contained layouts with proper breathing room

### D. Component Library

**Dashboard Layout:**
- Sidebar navigation with bot list and status indicators
- Main content area for bot details, logs, and upload interface
- Header with platform title and quick actions

**Bot Cards:**
- Clean cards showing bot name, status (running/stopped), and quick actions
- Status indicators using color-coded dots or badges
- Last activity timestamp and resource usage hints

**Upload Interface:**
- Drag-and-drop zone with clear visual feedback
- Form fields for bot name and main file selection
- Progress indicators during upload and extraction

**Log Viewer:**
- Terminal-style interface with monospace font
- Auto-scrolling with option to pause
- Clear/filter controls
- Real-time updates via WebSocket connection

**Action Buttons:**
- Primary actions (Start, Upload) in bright blue
- Destructive actions (Stop, Delete) in red
- Secondary actions (View Logs, Settings) in muted colors

**Status System:**
- Running: Green dot + "Running" label
- Stopped: Gray dot + "Stopped" label  
- Error: Red dot + "Error" label
- Loading: Animated blue dot + "Starting" label

### E. User Experience Patterns

**Upload Flow:**
1. Prominent upload area in center when no bots exist
2. Clear step-by-step process (Upload → Extract → Configure → Start)
3. Real-time feedback during each step

**Bot Management:**
- One-click start/stop functionality
- Instant visual feedback for state changes
- Non-intrusive notifications for success/error states

**Log Interface:**
- Dedicated log panel that can be expanded/collapsed
- Real-time streaming with WebSocket connection
- Search and filter capabilities for debugging

### F. Technical Considerations
- **Responsive Design:** Mobile-friendly sidebar that collapses on smaller screens
- **Loading States:** Skeleton loaders and progress indicators throughout
- **Error Handling:** Clear error messages with suggested actions
- **Performance:** Virtualized log rendering for large log files

### G. No Images Required
This platform is purely functional and doesn't require hero images or marketing visuals. All visual appeal comes from clean typography, thoughtful spacing, and intuitive iconography using Heroicons.

The overall aesthetic should feel like a professional developer tool - clean, efficient, and trustworthy, similar to modern deployment platforms but optimized for the specific workflow of bot hosting and management.