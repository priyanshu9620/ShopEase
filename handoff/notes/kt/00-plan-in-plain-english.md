# The plan in plain English (what each resume line will mean when we're done)

**Bullet 2 — "Containerized with Docker, deployed on AWS EC2 behind an ALB across 3 replicas, with CI/CD via GitHub Actions."**
The app becomes one Docker image. Terraform creates three small EC2 machines in Mumbai, each
running that image, and an Application Load Balancer in front that sends each request to a
healthy machine (it checks `/healthz`). When you `git push` to master, GitHub Actions builds the
image, pushes it to GitHub's registry, and restarts the three machines one by one so the site
never goes down. `terraform destroy` deletes all of it so it costs nothing while idle.

**Bullet 3 — "Integrated Redis caching, reducing API response time by X% (A ms to B ms), benchmarked at N RPS."**
We first measure the app *without* Redis using a load-testing tool (k6) on a seeded catalogue of
~5,000 products: how slow each endpoint is, and how many requests per second it can take before
it falls over. Then we add Redis as a cache in front of MongoDB for the read endpoints (product
lists, search, categories, product pages, photos), with invalidation when an admin edits
something. Then we measure again, same script, same machine. The numbers that go on the resume
are the ones we measure.

**Bullet 4 — "Migrated static assets to AWS S3 with CloudFront CDN and implemented real-time order tracking via WebSockets."**
Today product photos are stored *inside* MongoDB and served by the app on every page view — the
heaviest thing it does. We move them to S3 (object storage) and serve them through CloudFront
(a CDN with edge caches near the user), so the app never touches image bytes again; the React
build is served the same way. For order tracking, when an admin changes an order's status, the
server pushes the update over a WebSocket (socket.io) to the buyer's browser, which updates
instantly — no refresh. With three replicas, a Redis "adapter" makes sure an event emitted on
one machine reaches a browser connected to another.

**Why this order:** measure → cache → containerize → AWS → CDN/WebSockets. Everything measurable
happens locally first (free), the AWS stack is up for as short a time as possible, and the
WebSocket feature is built last because it depends on both Redis and the multi-replica setup.
