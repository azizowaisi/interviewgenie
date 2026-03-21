/** Main public product (marketing + interview app), for outbound links only. */
export const publicAppUrl =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PUBLIC_APP_URL) ||
  "https://interviewgenie.teckiz.com";
