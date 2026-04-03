import { redirect } from "next/navigation";

function adminInfraTarget() {
  const base =
    process.env.NEXT_PUBLIC_ADMIN_SITE_URL?.trim() ||
    "https://admin.interviewgenie.teckiz.com";
  return `${base.replace(/\/$/, "")}/#/admin/infrastructure`;
}

export default function AdminInfrastructurePage() {
  redirect(adminInfraTarget());
}