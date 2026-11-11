# HANDOFF — ShopEase (read this first)

**Status (2026-11-11): DONE.** All four resume bullets are true and measured; 12 experiments reported;
INTERVIEW_PREP written. Only two human steps may still be open — check:
1. PR #5 merged? `https://github.com/priyanshu9620/ShopEase/pull/5`
2. AWS stack destroyed? `cd ~/Desktop/ShopEase && make infra-destroy`, then verify with
   `AWS_PROFILE=shopease aws ec2 describe-instances --region ap-southeast-2 --query 'length(Reservations[].Instances[])'` → 0.

## Where things live
- Repo: `~/Desktop/ShopEase` (github.com/priyanshu9620/ShopEase, default branch `master`, work branch `feat/aws-infra`).
- Results site: https://priyanshu9620.github.io/ShopEase/ · manual: `docs/GUIDE.md` · interview: `INTERVIEW_PREP/`.
- Notes: this folder — DECISIONS (D-1…D-23), BUILD-PLAN (all phases ☑), PROGRESS (dated ledger), PROBLEMS (P-1…P-33), `resume-lines.md`, `handoff-prompt-template.md` (reusable method for other projects).
- AWS: user's "new AWS experience" free-plan project, region-locked to `ap-southeast-2`; profile `shopease` in `~/.aws/credentials` (admin key pasted in chat on 2026-11-11 — rotate it); OpenTofu provider via local mirror (`~/.tofurc`, P-20).
- Policy limits for Claude: cannot run `tofu apply/destroy`, set GitHub secrets, merge PRs, or read secret outputs — the user does those.

## To bring the stack back for a demo
```
cd ~/Desktop/ShopEase && make infra-apply                         # ~5 min
# then re-set the two GitHub secrets (key rotates after a destroy — P-32):
cd infra && export GH_TOKEN=$(gh auth token --user priyanshu9620) && gh secret set AWS_SECRET_ACCESS_KEY -R priyanshu9620/ShopEase --body "$(AWS_PROFILE=shopease tofu output -raw github_deploy_secret_access_key)" && gh secret set AWS_ACCESS_KEY_ID -R priyanshu9620/ShopEase --body "$(AWS_PROFILE=shopease tofu output -raw github_deploy_access_key_id)" && unset GH_TOKEN
# re-run the deploy workflow (gh run rerun / push to master) → image + client published, instances rolled
# seed + photos: SSM `docker exec shopease node scripts/seed.js` then `make aws-migrate-photos`
make infra-destroy                                               # at the end
```

## Measured numbers (resume-grade)
See README table and `resume-lines.md`. Headlines: cache 814→1,542 req/s (laptop), 100→800 req/s (AWS);
scale-out 313→827; failover 56 %→0 % failed; rolling deploy 247/247; CDN photo p95 556→47 ms; realtime 100 % delivery with the adapter.

## Optional follow-ups (not required)
DEMO.md + GIF per experiment; `make lab-tour`; Atlas instead of the data instance; cache stampede (single-flight) experiment; OIDC for CI if the account ever allows it.
