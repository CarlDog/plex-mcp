// Image fetch tools. Pull raw artwork bytes (poster, art, banner,
// clearLogo, squareArt) back to the MCP client as image content
// blocks so vision-capable models can analyze them directly.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import {
  READ_ONLY_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  asImage,
  asText,
  withLogging,
} from "./helpers.js";

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
      annotations: READ_ONLY_ANNOTATIONS,
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

  server.registerTool(
    "plex_save_image",
    {
      title: "Save Plex Item Artwork to Disk",
      description:
        "Fetch a Plex image (same resolution as plex_get_image) and WRITE it to disk inside the container under MCP_IMAGE_SAVE_DIR (default /data/images/). Returns the path, byte count, and MIME type as JSON — NOT an image content block. Use this when a downstream pipeline (ImageMagick composite, filesystem-mcp consumer, etc.) needs the bytes at a file path rather than rendered inline. The operator typically bind-mounts a host directory onto MCP_IMAGE_SAVE_DIR so the file is reachable from outside the container. `filename` must be a basename (no '/', '\\', '..', or leading '.') — defense against directory traversal.",
      inputSchema: {
        filename: z
          .string()
          .min(1)
          .describe(
            "Basename to write under MCP_IMAGE_SAVE_DIR. No path separators or traversal sequences. Include the extension matching your expected MIME (e.g. 'young-guns-ii.jpg').",
          ),
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
            "A relative Plex API path (e.g. /library/metadata/209640/thumb/1779038021). Skips metadata lookup. Must start with '/'.",
          ),
        image_type: z
          .enum(["thumb", "art", "banner", "squareArt", "clearLogo"])
          .optional()
          .describe(
            "Which artwork to fetch when entry point is rating_key. Defaults to 'thumb'. Ignored when image_url is set.",
          ),
        max_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Max width in pixels. When set, routes through Plex's transcoder.",
          ),
        max_height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max height in pixels."),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    withLogging(
      "plex_save_image",
      async ({
        filename,
        rating_key,
        image_url,
        image_type,
        max_width,
        max_height,
      }) => {
        if (!rating_key && !image_url) {
          throw new Error(
            "plex_save_image: either rating_key or image_url must be provided",
          );
        }
        if (image_url && !image_url.startsWith("/")) {
          throw new Error(
            "plex_save_image: image_url must be a relative Plex path starting with '/'",
          );
        }
        const result = await plex.saveImage({
          filename,
          ratingKey: rating_key,
          imageUrl: image_url,
          imageType: image_type,
          maxWidth: max_width,
          maxHeight: max_height,
        });
        return asText(result);
      },
    ),
  );
}
