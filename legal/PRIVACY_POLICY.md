# Privacy Policy — StockBud

> **⚠️ TEMPLATE — NOT LEGAL ADVICE.** Tailored to StockBud's real data flows and
> sub-processors. Fill the `[BRACKETED]` placeholders and have it reviewed before launch.
> **Crucial accuracy check before publishing:** confirm exactly what user data (if any) is
> sent to Anthropic — see §3. SnapTrade's developer terms *require* a privacy policy that
> discloses the third-party connection, encryption, and deletion-on-request, so this is a
> hard launch requirement, not optional.
>
> **Fill these in:** `[LEGAL ENTITY / OPERATOR NAME]`, `[CONTACT EMAIL]`,
> `[EFFECTIVE DATE]`, `[STATE/JURISDICTION]`.

**Effective date:** [EFFECTIVE DATE]

This Privacy Policy explains how **[LEGAL ENTITY / OPERATOR NAME]** ("we") collects, uses,
and protects information when you use **StockBud** (the "Service").

## 1. Information we collect
- **Account information:** your email address and authentication identifiers (managed by our
  auth provider, Supabase Auth). We do not store your password — authentication is handled by
  the provider.
- **Content you create:** portfolio transactions you enter, watchlist entries, investment
  theses and notes.
- **Brokerage data (only if you connect an account):** read-only positions and transaction
  history retrieved via **SnapTrade**, plus the encrypted access tokens needed to refresh it.
  We **cannot** trade or move money. Tokens are encrypted at rest.
- **Payment information:** processed by **Stripe**. We receive subscription status and a
  customer identifier; **we do not store your full card number.**
- **Usage and device data:** logs, IP address, and basic technical data needed to operate,
  secure, and debug the Service.

## 2. How we use your information
To provide and maintain the Service; to authenticate you; to compute your portfolio
analytics and personalize your watchlist/theses; to process subscriptions; to enforce usage
limits and prevent abuse; to secure the Service and debug errors; and to communicate with you
about your account.

## 3. AI processing
Some features use **Anthropic's Claude** to summarize public filings and market information.
For these features, relevant **public** securities data and filing text are sent to Anthropic
for processing. **[CONFIRM AND STATE PRECISELY: whether any of your personal portfolio
holdings are included in prompts. Based on the current design, AI Decision Briefs and Filing
Q&A operate on per-security public data, not your personal holdings — verify this in
`engine/brief.py` / `engine/filing_qa.py` before publishing and state it accurately here.]**
Anthropic processes this data under its commercial terms and does not train its models on it.

## 4. Sub-processors
We share data with the following service providers strictly to operate the Service:

| Sub-processor | Purpose | Data involved |
|---|---|---|
| Supabase | Database + authentication | Account info, your content, brokerage data |
| Render | Backend hosting | Requests, logs |
| Vercel | Frontend hosting | Requests, logs |
| Anthropic | AI summaries | Public securities/filing data (see §3) |
| SnapTrade | Brokerage connectivity | Read-only brokerage positions/transactions |
| Stripe | Payment processing | Email, payment details (handled by Stripe) |

We do not sell your personal information.

## 5. Data retention and deletion
We retain your data while your account is active. **You may request deletion of your account
and associated data at any time by emailing [CONTACT EMAIL]**; we will delete it within a
reasonable period except where retention is required by law. Disconnecting a brokerage link
deletes the associated stored tokens.

## 6. Security
We use encryption in transit (HTTPS) and encrypt sensitive items such as brokerage tokens at
rest. No method of transmission or storage is perfectly secure, but we take reasonable
measures to protect your data. If a breach affecting your data occurs, we will notify affected
users and relevant providers (including SnapTrade) as required.

## 7. Cookies and local storage
We use browser local storage and/or cookies for authentication sessions and basic
preferences. We do not use third-party advertising trackers.

## 8. Your rights
Depending on your location (e.g., California/CCPA, EU/GDPR if applicable), you may have rights
to access, correct, delete, or port your data, and to object to certain processing. To
exercise these, contact **[CONTACT EMAIL]**.

## 9. Children
The Service is not directed to anyone under 18, and we do not knowingly collect data from
children.

## 10. Changes
We may update this Policy; material changes will be notified via the Service or email.

## 11. Contact
**[CONTACT EMAIL]**
