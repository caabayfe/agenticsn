# 0021. OAuth client credentials, with checks bound to the authenticated session

- Status: Accepted
- Date: 2026-10-07
- Requirements: ASR-02, ASR-08, ASR-15, ASR-16
- Amends: 0012 (production read-only by construction), 0020 (instance trust)
- Relates to: 0016 (instance load)

## Context

Until now snagentic authenticated only with Basic authentication, as a named user. Many
organisations don't hand out user passwords for integrations. They create an OAuth client
in the Application Registry instead, and ADR-0012 already prefers one for production because
an OAuth client can be restricted further (REST API access policies, auth scopes).

ServiceNow (Washington DC and later) supports the OAuth 2.0 client-credentials grant: the
client id and secret alone give a token for the client's **OAuth Application User**. There is
no password, no browser and no refresh token.

The checks of ADR-0012 and ADR-0020 trust the `username` in `instance.yaml`. With Basic
authentication that is the user who signs in. With a client, the signed-in user is whoever
the instance assigns, so a role check on the configured name could check a different user.
Someone who edits `username` to a read-only user would pass the `snc_read_only` check while
the client itself can write.

## Decision

1. **A second auth method, `oauth-client-credentials`.** `instance.yaml` holds the method,
   the `client_id` and the expected `username` (the OAuth Application User). The client
   secret is a credential like a password: it lives only in the OS keychain (account
   `<client_id>@<host>`, bound to `url` and `kind` as in ADR-0020) or in
   `SNAGENTIC_<NAME>_PASSWORD`, pinned by `_URL` and `_KIND`.
2. **Tokens are short-lived and stay in memory.** A connection requests a token from
   `/oauth_token.do` on its first request, through the same request scheduler (rate limit,
   budget, cancellation), and reuses it until a minute before it expires. On a 401 it
   requests one new token and retries the request once. Tokens and secrets never appear in
   errors, logs or files, and token requests never follow redirects.
3. **Every identity check uses the authenticated session, for both methods.** The
   `snc_read_only` check, the role check in `doctor`, and the user whose current update set
   a push sets, all query `javascript:gs.getUserID()` instead of the configured name. Editing
   `username` can no longer change who is checked. If the instance does not evaluate the
   expression, the query finds nothing, and test and production are refused (fail closed).
4. **The configured username must match.** `auth login` and `doctor` read the session's
   `user_name` and refuse (`identity-mismatch`) when it differs from `username`, so the name
   shown in lists, labels and exports is the real one.

## Consequences

- Teams can give snagentic a client limited to read APIs for production, which is the hard
  layer ADR-0012 prefers.
- An OAuth connection makes one token request on its first call, and another only when the
  token expires (ASR-16: it is the authentication itself). Basic connections make no new
  requests. The identity read happens only in `auth login` and `doctor`; the role checks
  stay at one request each.
- The instance must allow the client-credentials grant
  (`glide.oauth.inbound.client.credential.grant_type.enabled`) and the client must have an
  OAuth Application User. Both are documented as prerequisites.
- Basic profiles keep working unchanged, but their checks now also follow the session.

## Alternatives considered

- **Authorization code or password grants.** The first needs a browser and a redirect
  listener; the second needs a user password, which is what clients are meant to avoid.
- **Store the access token in the keychain between runs.** It saves one request per run,
  but adds a second secret to protect and expire. Tokens last minutes; runs are short.
- **Bind `username` into the keychain item.** It stops edits, but a Basic or OAuth user can
  still differ from the session for other reasons; checking the session is exact.
