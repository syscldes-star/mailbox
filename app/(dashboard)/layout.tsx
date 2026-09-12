import DashboardLayout from "@/components/layout/DashboardLayout";
import RequireAuth from "@/components/auth/RequireAuth";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <DashboardLayout>{children}</DashboardLayout>
    </RequireAuth>
  );
}
