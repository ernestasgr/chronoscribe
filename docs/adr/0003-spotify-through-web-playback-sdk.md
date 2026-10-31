# Spotify plays in the tab through the Web Playback SDK, signed in with PKCE and no backend

The Soundtrack plays through Spotify's [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk): the tab itself registers as a Spotify Connect device, whose `device_id` comes from the SDK's `ready` event, and tracks are started on it with `PUT /v1/me/player/play?device_id=…`. We chose this over steering another Spotify app through the Web API because nothing else has to be open. The cost is that it plays only for Premium accounts and only in browsers with DRM support (EME).

Chronoscribe has no server, so sign-in is the Authorization Code flow with PKCE (`S256`), with no client secret. The verifier is stored in IndexedDB across the trip to Spotify's sign-in page, and the tokens afterwards, through the `db` module like everything else; the access token is refreshed shortly before its hour is up, and a refresh token Spotify rotates replaces the old one. A backend would only have held a secret PKCE doesn't need.

Spotify no longer accepts `localhost` as a redirect address, only the loopback IP ([redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)). The dev server, `.claude/launch.json` and the Playwright servers therefore serve on `http://127.0.0.1`, and Spotify sends the browser back to the app's root, which finishes the sign-in from `?code=…` and removes it from the address bar. A static host registers its HTTPS root as a second redirect address.

The app is one Spotify app, registered by its owner, whose Client ID is built in as `VITE_SPOTIFY_CLIENT_ID`; a build without it shows no Spotify at all. In Development Mode Spotify lets at most 5 allowlisted accounts use an app, and its owner needs Premium; anyone else is refused with a 403, which the app reports.

## Consequences

- Running the app locally means opening `http://127.0.0.1:5273`, not `localhost`, or the sign-in can't come back.
- More than 5 users needs Spotify's Extended Quota Mode, which it grants only to organisations, or each user registering their own app and building with its Client ID.
- Premium is detected only when Spotify refuses: the SDK's `account_error`, or a 403 from a player command. `GET /me` no longer returns `product`.
- Spotify sits behind the `SpotifyPort` the composition root injects, so the tests use a fake (`test-support/spotify.ts`) and CI makes no real Spotify calls.
