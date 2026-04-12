export { default } from 'next-auth/middleware';

// Protect all dashboard routes and user-scoped API routes
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/data/:path*',
    '/api/tags/:path*',
    '/api/ai/:path*',
    '/api/upload/:path*',
  ],
};
