import { describe, expect, it } from "vitest";

import { searchTextFor } from "@/lib/publish/media";
import {
  MAX_MEDIA_BYTES,
  isMediaContentType,
  mediaCategory,
  mediaExtension,
} from "@/lib/publish/media-types";
import { manifestObjectKey, mediaObjectKey, mediaUrls, publicationPagePath } from "@/lib/publish/paths";
import { mediaStem, sanitizeMediaName } from "@/lib/publish/text";

describe("searchTextFor", () => {
  it("indexes the group, the label, and the manifest fields a render is searched by", () => {
    const text = searchTextFor(
      { composition: "Wordmark Reveal", profile: "ProRes", format: "mov", frames: 720 },
      "vbtc-unwrapped",
      "v2",
    );
    expect(text).toBe("vbtc-unwrapped v2 wordmark reveal prores mov");
  });

  it("keeps numeric manifest values and drops blank ones", () => {
    expect(searchTextFor({ composition: 4, profile: "  ", format: "" }, null, null)).toBe("4");
  });

  it("de-duplicates case-insensitively so the index holds one bag of words", () => {
    expect(searchTextFor({ composition: "VBTC" }, "vbtc", "vbtc")).toBe("vbtc");
  });

  it("is empty for a media row with nothing to index", () => {
    expect(searchTextFor(null, null, null)).toBe("");
    expect(searchTextFor("not an object", null, null)).toBe("");
    expect(searchTextFor([1, 2], null, null)).toBe("");
  });
});

describe("the upload allowlist", () => {
  it("accepts exactly the six ratified types", () => {
    for (const type of [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "image/png",
      "image/jpeg",
      "application/pdf",
    ]) {
      expect(isMediaContentType(type)).toBe(true);
    }
    for (const type of ["application/zip", "text/html", "image/svg+xml", ""]) {
      expect(isMediaContentType(type)).toBe(false);
    }
  });

  it("maps each type to one canonical extension, so jpeg and jpg agree", () => {
    expect(mediaExtension("video/quicktime")).toBe("mov");
    expect(mediaExtension("image/jpeg")).toBe("jpg");
    expect(mediaExtension("application/pdf")).toBe("pdf");
    expect(mediaExtension(null)).toBe("bin");
  });

  it("groups types into the player the detail page picks", () => {
    expect(mediaCategory("video/webm")).toBe("video");
    expect(mediaCategory("image/png")).toBe("image");
    expect(mediaCategory("application/pdf")).toBe("pdf");
    expect(mediaCategory(null)).toBe("file");
  });

  it("caps uploads at 4 GiB", () => {
    expect(MAX_MEDIA_BYTES).toBe(4294967296);
  });
});

describe("media object keys and urls", () => {
  const folder = "smitty/shares/uuid-1";

  it("puts the file and its manifest in the same share folder", () => {
    expect(mediaObjectKey(folder, "spot", "mp4")).toBe("smitty/shares/uuid-1/spot.mp4");
    expect(manifestObjectKey(folder, "spot")).toBe("smitty/shares/uuid-1/spot.manifest.json");
  });

  it("derives public urls, omitting the manifest when there is none", () => {
    expect(mediaUrls("dropzone.tylersavery.com", folder, "spot", "mp4", true)).toEqual({
      file: "https://dropzone.tylersavery.com/smitty/shares/uuid-1/spot.mp4",
      manifest: "https://dropzone.tylersavery.com/smitty/shares/uuid-1/spot.manifest.json",
    });
    expect(mediaUrls("dropzone.tylersavery.com", folder, "spot", "mp4", false).manifest).toBeNull();
  });

  it("points the detail page at a server-relative path, as /d/:id is", () => {
    expect(publicationPagePath("uuid-1")).toBe("/publications/uuid-1");
  });
});

describe("media filenames", () => {
  it("strips the real extension, not just .md", () => {
    expect(mediaStem("renders/vBTC v2.mp4")).toBe("vBTC v2");
    expect(mediaStem("still.PNG")).toBe("still");
    expect(mediaStem("no-extension")).toBe("no-extension");
    // A dotfile is all name, no extension.
    expect(mediaStem(".manifest")).toBe(".manifest");
  });

  it("slugifies the stem the same way the markdown path slugifies a name", () => {
    expect(sanitizeMediaName("renders/vBTC Unwrapped v2.mp4")).toBe("vbtc-unwrapped-v2");
    expect(sanitizeMediaName("A  Messy__Name!.mov")).toBe("a-messy-name");
  });
});
