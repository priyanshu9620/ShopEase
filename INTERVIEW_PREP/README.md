# INTERVIEW_PREP — ShopEase

Everything needed to explain this project in an interview without notes. Read in order.

| file | what it gives you | read when |
|---|---|---|
| `01-what-it-is.md` | the 2-minute pitch, architecture, how to demo it | the night before |
| `02-features.md` | every feature, how it is implemented, which file | when asked "how did you build X" |
| `03-how-it-works.md` | the theory behind each system-design concept, with the numbers this project measured | when asked "why" or "what are the trade-offs" |
| `04-problems-faced.md` | the real failures, in story form: symptom → cause → fix → lesson | when asked "what went wrong" or "tell me about a hard bug" |
| `05-codebase-map.md` | folder structure and where to add a new experiment or feature | when asked to walk through the code |
| `06-questions-and-answers.md` | likely questions with answers | the morning of |

Ground rules I hold myself to when talking about it:
- Every number I quote is in `experiments/<id>/report.md` and was produced by a script in this repo. If I do not remember a number, I say "it's in the report" rather than guess.
- I say what each experiment does **not** prove. Every report has that section; interviewers respect it.
- The e-commerce features (auth, catalogue, search, filters, cart, Braintree) are my college work. Everything in `lab/`, `infra/`, `lib/`, `experiments/` and the CI/CD was added to turn it into a system-design lab.
