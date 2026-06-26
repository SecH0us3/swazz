import { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

export const csrfMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const method = c.req.method;
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(method);

    // Read csrf_token from cookies
    let csrfToken = getCookie(c, 'csrf_token');

    // If missing, generate a new token (UUID) and set the csrf_token cookie
    if (!csrfToken) {
      csrfToken = crypto.randomUUID();
      const isSecure = c.req.url.startsWith('https://') || c.req.url.includes('localhost') || c.req.url.includes('127.0.0.1');
      setCookie(c, 'csrf_token', csrfToken, {
        path: '/',
        httpOnly: true,
        secure: isSecure,
        sameSite: 'Lax',
      });
    }

    if (isSafeMethod) {
      // Set the X-CSRF-Token response header with the current token value
      c.header('X-CSRF-Token', csrfToken);
      return await next();
    }

    // For state-changing requests (POST, PUT, DELETE, PATCH):
    // Check if the request has an Authorization or X-Upload-Token header.
    // If it does, we bypass CSRF checking.
    const authHeader = c.req.header('Authorization');
    const uploadToken = c.req.header('X-Upload-Token');
    if (authHeader || uploadToken) {
      return await next();
    }

    // Check if the X-CSRF-Token header matches the csrf_token cookie
    const requestCsrfToken = c.req.header('X-CSRF-Token');
    if (!requestCsrfToken || requestCsrfToken !== csrfToken) {
      return c.json({ error: 'Invalid or missing CSRF token' }, 403);
    }

    return await next();
  };
};
