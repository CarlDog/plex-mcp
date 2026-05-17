// Image fetch tools. Pull raw artwork bytes (poster, art, banner,
// clearLogo, squareArt) back to the MCP client as image content
// blocks so vision-capable models can analyze them directly.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import { asImage, withLogging } from "./helpers.js";

export function registerImageTools(server: McpServer, plex: PlexClient): void {
  server.registerTool(
    "plex_get_image",
    {
      title: "Fetch Plex Item Artwork",
      description:
        "Retrieve poster/art/background/banner/logo image BYTES for a Plex item as an MCP image content block (not text-wrapped base64), so a vision-capable model can actually see the picture. Pass either rating_key (default fetches the selected poster) or image_url (a relative /library/metadata/.../thumb/... path from a previous tool's response). Use max_width or max_height to route through Plex's transcoder when the original is large.",
      inputSchema: {
        rating_key: z
          .string()
          .optional()
          .describe(
            "Plex rating key of the item. Either rating_key or image_url must be set.",
          ),
        image_url: z
          .string()
          .optional()
          .describe(
            "A relative Plex API path from a metadata response (e.g. /library/metadata/209640/thumb/1779038021). Skips the metadata lookup round-trip. Must start with '/'.",
          ),
        image_type: z
          .enum(["thumb", "art", "banner", "squareArt", "clearLogo"])
          .optional()
          .describe(
            "Which artwork to fetch when entry point is rating_key. Defaults to 'thumb' (the selected poster). 'art' is the background; 'banner' is the wide banner; 'squareArt' maps to Plex's clearArt; 'clearLogo' is the transparent show/movie logo. Ignored when image_url is set.",
          ),
        max_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Max width in pixels. When set, routes through Plex's /photo/:/transcode endpoint to resize server-side. Recommended for repeated fetches and large originals.",
          ),
        max_height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max height in pixels. Same semantics as max_width."),
      },
    },
    withLogging(
      "plex_get_image",
      async ({ rating_key, image_url, image_type, max_width, max_height }) => {
        if (!rating_key && !image_url) {
          throw new Error(
            "plex_get_image: either rating_key or image_url must be provided",
          );
        }
        if (image_url && !image_url.startsWith("/")) {
          throw new Error(
            "plex_get_image: image_url must be a relative Plex path starting with '/'",
          );
        }
        const { bytes, mimeType } = await plex.getImageBytes({
          ratingKey: rating_key,
          imageUrl: image_url,
          imageType: image_type,
          maxWidth: max_width,
          maxHeight: max_height,
        });
        return asImage(bytes, mimeType);
      },
    ),
  );
}
