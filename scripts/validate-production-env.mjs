const requiredGroups = [
  ["SITE_URL"],
  ["TMDB_API_TOKEN", "TMDB_API_KEY"],
  ["NEXT_PUBLIC_SUPABASE_URL"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
];

const missing = requiredGroups.filter((group) =>
  group.every((name) => !process.env[name]?.trim()),
);

if (missing.length) {
  console.error(
    `Missing production environment configuration: ${missing
      .map((group) => group.join(" or "))
      .join(", ")}`,
  );
  process.exit(1);
}

const siteUrl = new URL(process.env.SITE_URL);
if (siteUrl.protocol !== "https:" || siteUrl.pathname !== "/") {
  console.error("SITE_URL must be an HTTPS origin with no path.");
  process.exit(1);
}

console.log("Production environment configuration is complete.");
