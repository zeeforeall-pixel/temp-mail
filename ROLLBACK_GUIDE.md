# Rollback Guide — goofy-carson (临时邮局)

> **Created:** 2026-06-17 23:28 WITA · **Branch:** main · **Ahead of origin:** 3 commits

---

## Decision Tree

```
I want to...
  │
  ├─ Undo to the LAST PUSHED state ────────────► Scenario 1
  ├─ Undo to the LAST COMMITTED checkpoint ────► Scenario 2
  ├─ Restore ALL working changes ──────────────► Scenario 3
  ├─ Restore specific files only ──────────────► Scenario 4
  ├─ Fresh copy from archive (new machine) ────► Scenario 5
  ├─ Recover from corrupted git repo ──────────► Scenario 6
  └─ Remove all backups ───────────────────────► Scenario 7
```

---

## Backup Layers

| # | Type | ID | What's in it | Where |
|---|------|----|-------------|-------|
| 1 | Git tag | `backup-20260617-231908` | Last committed state (dd206ff) — no working changes | Local repo |
| 2 | Git branch | `backup/full-snapshot-20260617` | ALL 22 working changes committed (13 M + 9 untracked) | Local repo |
| 3 | Archive | `goofy-carson-full-20260617-231908.tar.gz` | Complete project snapshot (53 tracked files, 1.0 MB) | `/Users/blessed/Documents/antigravity/backups/` |

---

## Scenario 1 — Undo to last pushed state

Discards everything not on `origin/main`.

```bash
git reset --hard origin/main
git clean -fd
```

## Scenario 2 — Undo to last committed checkpoint

Keeps the backup branch intact; resets main working tree to the tagged commit.

```bash
git reset --hard backup-20260617-231908
```

## Scenario 3 — Restore all working changes from backup

Applies the backup commit's changes without creating a new commit.

```bash
git cherry-pick backup/full-snapshot-20260617 --no-commit
```

## Scenario 4 — Restore specific files only

```bash
# From backup branch (has all working changes)
git checkout backup/full-snapshot-20260617 -- js/app.js css/components.css

# Or from tag (committed state only)
git checkout backup-20260617-231908 -- js/app.js
```

## Scenario 5 — Fresh copy from archive

```bash
mkdir /tmp/goofy-carson-restore && cd /tmp/goofy-carson-restore
tar -xzf /Users/blessed/Documents/antigravity/backups/goofy-carson-full-20260617-231908.tar.gz
```

## Scenario 6 — Recover from corrupted git repo

```bash
# 1. Move the broken repo aside
mv /Users/blessed/Documents/antigravity/goofy-carson /Users/blessed/Documents/antigravity/goofy-carson-broken

# 2. Extract archive into fresh directory
mkdir /Users/blessed/Documents/antigravity/goofy-carson
cd /Users/blessed/Documents/antigravity/goofy-carson
tar -xzf /Users/blessed/Documents/antigravity/backups/goofy-carson-full-20260617-231908.tar.gz

# 3. Re-initialize git
git init && git add . && git commit -m "restore from archive backup-20260617"

# 4. Add remote and fetch history
git remote add origin <your-repo-url>
git fetch origin
```

## Scenario 7 — Remove all backups

```bash
git tag -d backup-20260617-231908
git branch -D backup/full-snapshot-20260617
rm /Users/blessed/Documents/antigravity/backups/goofy-carson-full-20260617-231908.tar.gz
```

---

## Verify Backup Status

```bash
echo "Tag:" && git tag -l 'backup-*'
echo "Branch:" && git branch -v | grep backup
echo "Archive:" && ls -lh /Users/blessed/Documents/antigravity/backups/*.tar.gz
echo "Working tree:" && git status --short | wc -l | xargs echo "  live changes:"
```

---

## Quick Reference

| What you want | Command |
|--------------|---------|
| See what changed since backup | `git diff backup/full-snapshot-20260617` |
| Compare main vs backup | `git diff main backup/full-snapshot-20260617` |
| See untracked files | `git ls-files --others --exclude-standard` |
| Push backup branch to remote | `git push origin backup/full-snapshot-20260617` |

---

## What's NOT in the backups

- `.venv/` — reinstall with `python3 -m venv .venv`
- `node_modules/` — reinstall with `npm install`
- `.vercel/` — deployment state, re-deploy to regenerate
