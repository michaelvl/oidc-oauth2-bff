# BFF for SPA Experiment

This repository contain a a prototype of the OIDC backend for frontend pattern
(BFF) for a single-page-application (SPA).

The principle behind the OIDC BFF is to extract functionality from the frontend
and move it to the backend, which should be better suited for implementing the
given functionality, e.g. for performance, latency or, as in the case of OIDC
authorization code flow, for security. With the OIDC BFF we keep tokens and
client secrets secret at the BFF while the frontend use
[SameSite=strict](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
cookies to track the security session.

In summary, the security benefits of the OIDC BFF are:

- OIDC tokens and client secrets are kept at the backend, which should
  be more secure than the browser.

- The security session between browser and BFF is a 'HTTP-only'
  cookie, i.e. this is not available to potential malicious
  Javascript.

A working example with single-page application and identity provider
can be found in
[michaelvl/oidc-bff-apigw-workshop](https://github.com/michaelvl/oidc-bff-apigw-workshop.git)

## Overall Principle



## API Endpoints

With a BFF, accessing the functionality extracted to the backend basically
becomes a remote procedure call. The BFF exposes the following API endpoints for
the frontend to the OIDC functionality:

1. POST `/start`
2. POST `/pageload`
3. GET `/userinfo`
4. POST `/logout`
5. POST `/refresh`

### POST `/start`

This endpoint is used to start an OIDC Authorization Code Flow login
procedure. The request returns a redirection URL to the identity provider. The
SPA should navigate to this URL where the user can authenticate and authorize
the SPA. The BFF is configured with a SPA redirection URL and the OIDC scope to
request, which will be used in the returned URL. Hence, the identity provider
will redirect back to the SPA after a successful authentication. The BFF will
include PKCE in the authorization code flow as defined by OAuth2.1.

Responses are JSON, and an example is shown here:

```
{
  authRedirUrl: https://idp.example.com/authorize?client_id=CLIENT-ID&scope=openid%20profile&response_type=code&redirect_uri=https://spa.example.com&code_challenge=zzz&code_challenge_method=S256&state=yyy&nonce=xxx
}
```

### POST `/pageload`

The SPA should call this endpoint on at least the pageload that may be the
identity provider redirects, i.e. this is how the identity provider code is
passed to the BFF such that it complete the authorization code flow and retrieve
tokens.

Request should contain a JSON structure with the loaded page URL:

```
{
  pageUrl: https://spa.example.com?code=1234
}
```

The response is a JSON object with information about login state and whether the
BFF used the pageload to finish the authorization code flow:

```
{
  loggedIn: true,
  handledAuth: true
}
```

### GET `/userinfo`

This endpoint returns a JSON object with the ID token claims, or an empty object
if the user is not logged in.

### POST `/logout`

This endpoint is used to get a logout URL, to which the SPA should navigate to
log out the user. The post-logout URL is the same SPA URL as used when
initiating the authorization code flow.

```
{
  logoutUrl: https://idp.example.com/endsession?id_token_hint=xxx&post_logout_redirection_uri=https://spa.example.com
}
```

### POST `/refresh`

This endpoint refreshes the tokens.

```
{
  expiresAt: 1234567,
  loggedIn: true,
  refreshOk: true
}
```

The `expiresAt` attribute is the access token expiration timestamp, represented
as the number of seconds since the epoch (January 1, 1970 00:00:00 UTC).

The SPA may call the `/refresh` endpoint strategically based on the `expiresAt`
attribute or when other API calls return a [HTTP 401
Unauthorized](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401)
error.

## References

This work in inspired by:

- https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps-08
- https://datatracker.ietf.org/doc/draft-bertocci-oauth2-tmi-bff/
- https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-03
- https://curity.io/resources/learn/the-bff-pattern/
- https://datatracker.ietf.org/doc/html/rfc7636

## Testing

Tests are built using the Identity Provider from:

https://github.com/MichaelVL/oidc-oauth2-workshop
