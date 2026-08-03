// Image fetch tools. Pull raw artwork bytes (poster, art, banner,
// clearLogo, squareArt) back to the MCP client as image content
// blocks so vision-capable models can analyze them directly.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlexClient } from "../plex.js";
import {
  READ_ONLY_ANNOTATIONS,
  SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  asImage,
  asText,
  assertImageEntryPoint,
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
        assertImageEntryPoint("plex_get_image", rating_key, image_url);
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
        assertImageEntryPoint("plex_save_image", rating_key, image_url);
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

  server.registerTool(
    "plex_list_posters",
    {
      title: "List Plex Item Poster Candidates",
      description:
        "List every poster candidate Plex knows about for an item — agent-supplied (TMDB/TVDB), locally-scanned, and previously uploaded — including which one is currently active. Use before plex_set_poster to find a poster_rating_key, or to review what plex_upload_poster added.",
      inputSchema: {
        rating_key: z.string().describe("Plex rating key of the item."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withLogging("plex_list_posters", async ({ rating_key }) => {
      const posters = await plex.listPosters(rating_key);
      return asText(posters);
    }),
  );

  server.registerTool(
    "plex_set_poster",
    {
      title: "Select an Existing Plex Poster Candidate",
      description:
        "Make an existing poster candidate the active one for an item. Pass poster_rating_key from a prior plex_list_posters call (or plex_upload_poster's response) — this is the CANDIDATE's own identifier (e.g. 'upload://posters/<hash>' or an external image URL), not the item's rating_key. Reversible: call again with a different candidate's poster_rating_key to switch back.",
      inputSchema: {
        rating_key: z.string().describe("Plex rating key of the item."),
        poster_rating_key: z
          .string()
          .min(1)
          .describe(
            "The candidate poster's own ratingKey from plex_list_posters. Not the item's rating_key.",
          ),
      },
      annotations: SAFE_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    withLogging(
      "plex_set_poster",
      async ({ rating_key, poster_rating_key }) => {
        await plex.setPoster(rating_key, poster_rating_key);
        return asText({ rating_key, selected: poster_rating_key });
      },
    ),
  );

  server.registerTool(
    "plex_upload_poster",
    {
      title: "Upload a New Plex Poster",
      description:
        "Add a new poster candidate for an item, either from an external URL (Plex fetches it server-side) or a local file already saved under MCP_IMAGE_SAVE_DIR (e.g. by plex_save_image or a local compositor) — exactly one of url or filename must be set. Plex auto-selects a freshly uploaded poster by default (select=true), immediately changing what's displayed; pass select=false to add it as a candidate without changing the current poster (useful for review-before-applying workflows) — the previously active poster is restored after upload. Not idempotent: each call adds a new candidate.",
      inputSchema: {
        rating_key: z.string().describe("Plex rating key of the item."),
        url: z
          .string()
          .optional()
          .describe(
            "External URL for Plex to fetch server-side as the new poster. Either url or filename must be set.",
          ),
        filename: z
          .string()
          .optional()
          .describe(
            "Basename of a file already on disk under MCP_IMAGE_SAVE_DIR to upload as the new poster. Either url or filename must be set.",
          ),
        select: z
          .boolean()
          .optional()
          .describe(
            "Whether to make the uploaded poster active immediately. Default true.",
          ),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    withLogging(
      "plex_upload_poster",
      async ({ rating_key, url, filename, select }) => {
        if (!url && !filename) {
          throw new Error(
            "plex_upload_poster: either url or filename must be provided",
          );
        }
        if (url && filename) {
          throw new Error(
            "plex_upload_poster: only one of url or filename may be provided",
          );
        }
        const result = await plex.uploadPoster({
          ratingKey: rating_key,
          url,
          filename,
          select,
        });
        return asText(result);
      },
    ),
  );
}
