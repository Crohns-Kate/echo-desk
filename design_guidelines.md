# EchoDesk Design Guidelines

## Design Approach
**System Selected:** Material Design 3 (adapted for healthcare operations)

**Rationale:** EchoDesk is a utility-focused productivity dashboard for clinic receptionists monitoring real-time voice calls, managing alerts, and reviewing call history. The interface prioritizes information density, clarity, and operational efficiency over visual flair. Material Design 3 provides robust patterns for data tables, real-time updates, status indicators, and alert systems essential for monitoring workflows.

## Core Design Principles
1. **Clarity First:** Every element serves a functional purpose - no decorative flourishes
2. **Status Visibility:** Real-time call states, alert counts, and system health must be immediately apparent
3. **Scan-ability:** Dense information organized for quick comprehension during busy clinic hours
4. **Action-Oriented:** Primary actions (view call details, dismiss alerts, create appointments) accessible within 1-2 clicks

---

## Typography System

**Font Family:** 
- Primary: Inter (via Google Fonts CDN)
- Monospace: JetBrains Mono (for phone numbers, timestamps, CallSIDs)

**Hierarchy:**
- Page Headers: text-2xl (24px) font-semibold
- Section Headers: text-lg (18px) font-medium  
- Body Text: text-base (16px) font-normal
- Labels/Meta: text-sm (14px) font-medium
- Timestamps/IDs: text-xs (12px) font-mono

**Line Heights:**
- Headers: leading-tight (1.25)
- Body: leading-normal (1.5)
- Data tables: leading-relaxed (1.625) for better row distinction

---

## Layout System

**Spacing Primitives:** Use Tailwind units of **2, 4, 6, 8, 12, 16**
- Component internal padding: p-4, p-6
- Section spacing: space-y-8, gap-6
- Card padding: p-6
- Tight groupings: space-y-2, gap-4

**Grid Structure:**
- Dashboard Layout: Sidebar navigation (w-64 fixed) + main content area (flex-1)
- Cards: Grid layouts for metrics cards (grid-cols-1 md:grid-cols-3 gap-6)
- Tables: Full-width responsive tables with horizontal scroll on mobile

**Container Widths:**
- Dashboard content: max-w-7xl mx-auto
- Modals/dialogs: max-w-2xl
- Form sections: max-w-xl

---

## Component Library

### Navigation
**Top Bar:**
- Fixed height (h-16), full-width with logo left, system status indicators center, user menu right
- Breadcrumb navigation below top bar for multi-level pages
- Alert counter badge on alerts icon (absolute positioning, top-right)

**Sidebar (Desktop):**
- Fixed left sidebar (w-64) with navigation links
- Active state: subtle left border accent (border-l-4)
- Icon + label pattern for all nav items
- Collapsible on tablet/mobile (hamburger menu)

### Data Display

**Call Status Cards:**
- Compact card design (rounded-lg border shadow-sm p-4)
- Header: Caller name/number + timestamp (flex justify-between)
- Body: Intent badge + current state (text-sm)
- Footer: Action buttons (View Details, Transfer)
- Status indicator dot (absolute top-right, h-3 w-3 rounded-full) for active/idle/ended

**Alerts Queue:**
- List layout with alert cards
- Priority indicators: Left border thickness/styling
- Dismissible with X button (top-right)
- Timestamp in relative format ("2 minutes ago")
- Expandable details on click

**Call Logs Table:**
- Sticky header row
- Columns: Timestamp, From Number, Intent, Duration, Status, Actions
- Row hover state for clarity
- Inline action buttons (View, Listen, Download Transcript)
- Pagination controls at bottom
- Search/filter bar above table

**Call Detail View:**
- Two-column layout: Left (call metadata), Right (transcript/recording)
- Metadata section: Definition list pattern (dt/dd pairs)
- Transcript: Message bubbles alternating caller/system (similar to chat UI)
- Recording player: Standard HTML5 audio element with custom controls

### Forms & Inputs

**Tenant Configuration:**
- Form sections with clear headings
- Label above input pattern
- Input fields: Full-width within form containers, h-10 standard height
- Helper text below inputs (text-sm)
- Validation: Inline error messages in red, success checkmarks

**Search/Filter:**
- Search bar: Leading icon (magnifying glass), h-10, rounded-md border
- Filter dropdowns: Multi-select with chip display for active filters
- Clear all filters button

### Feedback & States

**Loading States:**
- Skeleton screens for initial page loads (animated pulse)
- Spinner for inline actions (h-5 w-5)
- Progress bars for long operations (transcription processing)

**Empty States:**
- Centered illustration placeholder + message
- Call-to-action when applicable ("No alerts - All clear!")

**Toasts/Notifications:**
- Top-right fixed positioning
- Auto-dismiss after 5 seconds
- Success/error/info variants with icons
- Stacking behavior (max 3 visible)

### Overlays

**Modals:**
- Centered overlay with backdrop blur
- Max-width constraints (max-w-2xl)
- Close button (top-right X)
- Primary action button (bottom-right)
- Used for: Appointment confirmation, Call transfer, Settings

**Popovers:**
- Used for: Quick info tooltips, action menus
- Arrow pointing to trigger element
- Drop shadows for depth

---

## Icons
**Library:** Heroicons (via CDN)
- Use outline variants for navigation and secondary actions
- Use solid variants for alerts, status indicators, and primary buttons
- Standard size: h-5 w-5 for inline icons, h-6 w-6 for nav

---

## Responsive Behavior

**Breakpoints:**
- Mobile: < 768px - Single column, hamburger nav
- Tablet: 768px - 1024px - Two-column grids, collapsed sidebar
- Desktop: > 1024px - Full multi-column layouts, expanded sidebar

**Mobile Adaptations:**
- Tables: Horizontal scroll OR card-based responsive view
- Sidebar: Off-canvas drawer
- Multi-column grids collapse to single column
- Reduce padding/spacing (p-6 → p-4, gap-6 → gap-4)

---

## Real-Time Elements

**Live Call Indicators:**
- Pulsing animation for active calls (animate-pulse on status dot)
- Auto-refresh call list every 5 seconds
- WebSocket connection status in header

**Alert Notifications:**
- New alert: Slide-in animation from right
- Sound notification option (toggle in settings)
- Desktop notification permission request

---

## Accessibility

**Focus Management:**
- Visible focus rings on all interactive elements (ring-2 ring-offset-2)
- Keyboard navigation through tables (arrow keys)
- Skip-to-content link

**ARIA:**
- Live regions for call status updates
- Alert role for notification toasts
- Proper table headers and cell associations

**Contrast:**
- All text meets WCAG AA standards minimum
- Interactive elements have clear visual distinction

---

## Images
**Logo/Branding:**
- EchoDesk logo in top-left navigation (h-8)
- Favicon for browser tab
- Empty state illustrations for zero-data views

**No hero images** - This is a functional dashboard, not a marketing site. Focus is entirely on data presentation and controls.

---

## Page-Specific Layouts

**Dashboard (index.html):**
- Top: Metrics cards row (Active Calls, Pending Alerts, Today's Call Volume)
- Middle: Active Calls list (left 60%) + Recent Alerts (right 40%)
- Bottom: Quick actions / System status

**Calls List (calls.html):**
- Header: Search + Filters
- Body: Paginated table
- Sidebar: Date range picker, intent filters

**Call Detail (call-detail.html):**
- Header: Breadcrumb + Call metadata summary
- Two-column: Metadata left, Transcript/Recording right

**Alerts (alerts.html):**
- Filter tabs (Open, Dismissed, All)
- List of alert cards
- Bulk actions at top

**Tenants (tenants.html):**
- Table list of clinics
- Add/Edit forms in modal or dedicated page