import { auth } from "@clerk/nextjs/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await auth.protect(); // signed-out visitors are sent to sign-in
  return children;
}
