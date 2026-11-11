# handoff/ — everything needed to continue this project from a fresh laptop

This is a personal project; the owner chose to commit secrets and session notes so a clone is complete.
Do not copy this pattern for anything shared or work-related.

## What is here

| path | what | restore to |
|---|---|---|
| `../.env` | app secrets for local runs (JWT, Braintree sandbox, Mongo URL) | stays in place |
| `../infra/terraform.tfvars` | the same secrets for AWS (go to SSM Parameter Store on apply) | stays in place |
| `../infra/terraform.tfstate` | OpenTofu state (empty while the stack is destroyed) | stays in place |
| `notes/` | the project notes: `session/HANDOFF.md` (read first), DECISIONS, BUILD-PLAN, PROGRESS, PROBLEMS, resume lines, the reusable handoff prompt | `~/Desktop/shopease-notes/` (or read in place) |
| `claude-memory/shopease-project.md` | Claude Code's memory file for this project | the Claude memory folder of the project you open (see below) |
| `dotfiles/tofurc` | OpenTofu provider mirror config (only needed on networks where GitHub release downloads hang) | `~/.tofurc` |
| *(not in the repo)* | the AWS access key for profile `shopease` — the one secret deliberately kept out (a public repo + an AWS key = instant abuse). Get it from the AWS console: IAM → Users → `terraform-shopease` → Security credentials → Create access key | `~/.aws/credentials` |

## New laptop, step by step

```bash
git clone https://github.com/priyanshu9620/ShopEase.git ~/Desktop/ShopEase && cd ~/Desktop/ShopEase
brew install awscli opentofu            # Docker Desktop separately; gh (GitHub CLI) and `gh auth login` as priyanshu9620
cp -R handoff/notes ~/Desktop/shopease-notes
cp handoff/dotfiles/tofurc ~/.tofurc    # then see notes/session/PROBLEMS.md P-20 for the provider mirror files
mkdir -p ~/.aws && printf '[shopease]\naws_access_key_id = AKIA...\naws_secret_access_key = ...\n' >> ~/.aws/credentials && chmod 600 ~/.aws/credentials   # key from IAM, see table
printf '[profile shopease]\nregion = ap-southeast-2\noutput = json\n' >> ~/.aws/config
make up && make seed                    # app on :8080;  make lab → Grafana :3000;  make experiment E=01-caching
```

Claude Code memory: open Claude Code in `~/Desktop/ShopEase` and run it once; it creates
`~/.claude/projects/-Users-<you>-Desktop-ShopEase/memory/`. Copy `handoff/claude-memory/shopease-project.md`
there and add a line to that folder's `MEMORY.md`:
`- [ShopEase project](shopease-project.md) — personal system-design lab; read handoff/notes/session/HANDOFF.md`.

First prompt for the new session:

> Read handoff/README.md and handoff/notes/session/HANDOFF.md, then tell me the current state and what is left.

## Bringing AWS back for a demo

`notes/session/HANDOFF.md` has the exact sequence (apply → re-set the two GitHub secrets → deploy → seed →
migrate photos → destroy). Budget: ~$3/day while up, on the account's free-plan credits.
