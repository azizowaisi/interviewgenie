/** Shared main-app nav (desktop + mobile menu). */
export const MAIN_NAV_LINKS = [
  { href: "/interview", label: "Start" },
  { href: "/upload", label: "ATS" },
  { href: "/mock", label: "Mock" },
  { href: "/live", label: "Live" },
  { href: "/history", label: "History" },
  { href: "/profile", label: "Profile" },
] as const;

/** Recruiter-specific nav links. */
export const RECRUITER_NAV_LINKS = [
  { href: "/recruiter", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
] as const;
