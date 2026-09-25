# Sources that were not accessible

## Oak National Academy
- Bulk curriculum + quiz-question JSON exists (open-api.thenational.academy/bulk-download) but requires an API key via registration form. No key available, so nothing was fetched. If Asaf registers (free), the maths-primary bulk JSON would give lesson-level quiz questions with answers and misconceptions - worth adding later.
- https://open-api.thenational.academy/bulk-download

## EngageNY / Eureka Math curriculum modules
- NYSED removed the EngageNY curriculum pages: https://www.nysed.gov/curriculum-instruction/engageny/mathematics returns "Page Not Found" (verified in a real browser 2026-09-25). nysed.gov also blocks plain curl via WAF.
- The NY State **released test items** (a separate NYSED program, hosted on nysedregents.org) are fully downloaded and parsed, which covers the "released items" part of the request. The EngageNY module lesson PDFs themselves were not obtained; Eureka Math (Great Minds) is commercial.
