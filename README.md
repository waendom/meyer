# Lukas Meyer — portfolio

Static site for GitHub Pages. No build step to run by hand, no server, no database.

## Adding artwork

1. Open the folder for the category on github.com:
   - `albums/digital/`
   - `albums/mixed-media/`
2. **Add file → Upload files**, pick the images, commit.

That is the whole job. Within a minute or two a GitHub Action will have:

- given each new file the next free number (`012-…`) so the order stays fixed and visible,
- produced a large version for the enlarged view and a small one for the grid tiles,
- recalculated which artwork appears where in the endless grid,
- committed everything back to the repository.

Works from a phone — the GitHub app and the website both allow uploads.

### Removing or replacing

Delete a file from the album folder, or upload a new one over it keeping the same name.
The Action cleans up after itself. Numbers of the remaining files stay as they are, so
nothing else shifts around.

## Two things worth knowing

**A category needs at least four artworks, ideally six.** The gallery repeats endlessly in
every direction, and the same piece must never end up beside itself. With only a handful of
images in a category that becomes impossible, so its filter button is hidden until enough
have been added. The build prints a note when this happens; the gallery itself keeps working.

**Order inside an album follows the number prefix.** New uploads go to the end. To move a
piece, rename its prefix — `007-…` becomes `002-…` and it moves up. The categories are
interleaved on the site, so digital and mixed media alternate rather than appearing in blocks.

## Titles, dates and descriptions

Every artwork gets a title derived from its filename (`012-red-tree-study.jpg` becomes
"Red Tree Study") and an image description built from that. To set them deliberately, edit
`albums/meta.json`:

```json
{
  "012-red-tree-study.jpg": {
    "title": "Red Tree Study",
    "date": "03/26",
    "alt": "A red tree growing out of a grey street scene"
  }
}
```

Anything left out falls back to the generated value. A missing title or date shows as
`[ title ]` / `[ date ]` under the enlarged artwork, so gaps are visible rather than silent.

The favicon and the picture shown when the link is shared are both cut from one artwork —
set which one with `"icon"` in `featured.json`.

## Layout

```
albums/            the originals, organised by category — the only folder to touch
  digital/
  mixed-media/
assets/            generated: full/ for the enlarged view, thumb/ for the grid
gallery-data.js    generated: order, proportions, categories, grid mapping
CNAME              the custom domain — GitHub Pages reads this file
index.html         the site
404.html           shown for an address that does not exist
favicon.png        generated: browser tab icon
share-preview.jpg  generated: the picture shown when the link is shared
albums/meta.json   optional titles, dates and descriptions
scripts/           the build
```

Anything under `assets/` and `gallery-data.js` is overwritten on every build — edits there
will be lost. `albums/` is the source of truth.

## Running the build locally

```
npm install sharp
node scripts/build-gallery.mjs      # images, data, favicon, sharing image
node scripts/make-preview.mjs       # optional: one-file preview for testing on a phone
```

`site-preview-DO-NOT-UPLOAD.html` bundles the whole site into a single file with the images
embedded. Handy for checking on a phone before anything goes live — but it is not the site
and must not be uploaded as `index.html`.
