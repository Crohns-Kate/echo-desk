# Cursor + GitHub Workflow Guide

## Working with Cursor Chat to Build Features

### Quick Workflow

1. **Plan in Chat**: Just tell me what you want to build or change
2. **I'll Implement**: I'll make all the code changes directly in your workspace
3. **Commit & Push**: I can commit and push changes to GitHub for you
4. **Merge on GitHub**: Review and merge on GitHub's web interface

### Typical Development Cycle

#### Option A: Direct to Main (for small changes)
```
1. You: "Add a dark mode toggle"
2. Me: [Makes changes]
3. Me: [Commits & pushes to main]
4. You: Merge on GitHub if needed
```

#### Option B: Feature Branch (for larger features)
```
1. You: "Build user profile page"
2. Me: [Creates branch: feature/user-profile]
3. Me: [Implements feature]
4. Me: [Commits & pushes branch]
5. You: Create PR on GitHub, review, merge
```

### What I Can Do

- ✅ Create new files and components
- ✅ Edit existing code
- ✅ Create feature branches (`feature/*`, `fix/*`, etc.)
- ✅ Commit changes with descriptive messages
- ✅ Push to GitHub (main or branches)
- ✅ Create pull requests (via GitHub CLI if configured)

### What You Control

- 🔒 Merge permissions (you approve on GitHub)
- 🔒 Production deployments
- 🔒 Environment variables and secrets

### Example Conversations

**Small fix:**
> "Fix the login button color"
> 
> I'll fix it, commit, and push directly to main.

**New feature:**
> "Add a notifications system"
> 
> I'll create a `feature/notifications` branch, build it, commit, and push.
> Then you can review and merge the PR.

**Complex planning:**
> "I want to add multi-language support"
> 
> I'll break it down, plan the architecture, implement step-by-step,
> and keep you updated on progress.

---

**Tip**: You can always say "commit and push this" or "create a PR for this" 
and I'll handle the Git operations for you!
