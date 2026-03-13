# Installation Guide

## Requirements

- **Node.js** 18+
- **Claude Code** CLI installed and logged in

---

## Option 1: npm (recommended)

```bash
npm install -g clinsight
```

### Setup

```bash
# Register hooks with Claude Code (automatic session recording)
clinsight-setup

# Launch the dashboard
clinsight
```

### Optional: nightly compound analysis

```bash
# Install cron job (runs daily at 23:00)
clinsight-cron-install
```

### Uninstall

```bash
# Remove hooks
clinsight-setup --uninstall

# Remove cron job
clinsight-cron-install remove

# Uninstall package
npm uninstall -g clinsight

# Delete data (optional — removes all analysis data)
rm -rf ~/.claude/clinsight
```

---

## Option 2: From source

```bash
git clone https://github.com/wooo-jin/clinsight.git
cd clinsight
pnpm install && pnpm build
```

### Setup

```bash
# Register hooks with Claude Code
pnpm setup

# Launch the dashboard
pnpm dev
```

### Optional: nightly compound analysis

```bash
pnpm cron:install
```

### Uninstall

```bash
pnpm setup -- --uninstall
pnpm cron:install remove
```

---

## What happens after setup

### Hooks registered in Claude Code

The setup command adds 3 hooks to `~/.claude/settings.json`:

| Hook Event | Action |
|---|---|
| `SessionStart` | Initialize session archive |
| `UserPromptSubmit` | Sync conversation + real-time analysis |
| `Stop` | Create complete archive on session end |

Check hook status:

```bash
# npm install
clinsight-setup --status

# from source
pnpm setup -- --status
```

### Keyboard shortcuts (TUI)

| Key | Action |
|---|---|
| `1`-`7` | Switch tabs |
| `Tab` | Next tab |
| `r` | Refresh data |
| `s` | Export session data as JSON |
| `q` | Quit |

### Data storage

All data is stored under `~/.claude/clinsight/`:

| Path | Contents |
|---|---|
| `archive/` | Full session conversation archives |
| `sessions/` | Exported session data |
| `summaries/` | Daily summaries (from cron) |
| `compounds/` | Compound analysis results |
| `config.json` | User settings |
| `cron.log` | Cron job execution log |

---

## Troubleshooting

### Hooks not working

```bash
# 1. Check hook registration
clinsight-setup --status   # or: pnpm setup -- --status

# 2. Verify hook script exists
ls -la $(which clinsight-hook 2>/dev/null || echo "dist/hook.js")

# 3. Manual test
echo '{"session_id":"test","cwd":"/tmp"}' | clinsight-hook session-start
```

### No sessions in dashboard

- Use Claude Code for at least one conversation first
- Check that `~/.claude/projects/` contains JSONL files

### Cron job failing

```bash
# Check logs
tail -50 ~/.claude/clinsight/cron.log

# Remove stale lock file if present
rm ~/.claude/clinsight/.cron.lock

# Manual test run
clinsight-cron   # or: pnpm cron
```

### Windows notes

- Cron uses Windows Task Scheduler (`schtasks`) instead of crontab
- Data path: `%USERPROFILE%\.claude\clinsight\`
- To delete data: `Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\clinsight"`
