import { HttpInterceptorFn } from '@angular/common/http';

/** Sends the HttpOnly `bff_` session cookie with every outgoing HttpClient
 *  request — the transport the generated ng-openapi-gen clients (`src/app/api`)
 *  use. Mirrors hugmesh-user-ui / hugmesh-mod-ui's auth.interceptor.ts.
 *
 *  <p>The browser no longer holds an admin-capable Bearer: the gateway's
 *  BffCookieToBearerWebFilter turns the `bff_` cookie into the upstream Bearer
 *  server-side, so the browser must send the cookie (credentials) and NOT a
 *  localStorage token. We set `withCredentials: true` so the same-origin cookie
 *  rides along on every /bff/wiki/** call; when the cookie is absent the BFF
 *  returns 401, which the service surfaces as a WikiApiError. */
export const authInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
