import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Post Credits",
    short_name: "Post Credits",
    description: "A film diary with comparison-based personal ranking.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0b10",
    theme_color: "#0c0b10",
  };
}
