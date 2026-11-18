import { clerkMiddleware } from "@clerk/nextjs/server";

// Only attaches Clerk auth to requests; the actual checks live in app/dashboard/layout.tsx
// (page access) and in every Convex function (data access).
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
