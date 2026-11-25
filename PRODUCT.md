# Product

<!-- impeccable:product-schema 1 -->

The product record that the Impeccable design skill reads (`/impeccable`). Here the product is
the preview images this tool makes, not the tool's own command line. [README.md](README.md)
stays the authority (conventions, sizes, the data rule); where this file and the README
disagree, the README wins, and this file is corrected.

## Platform

web (the images are shown in GitHub READMEs and on a personal website)

## Users

Two kinds of viewer see each image. A visitor who opens one of the owner's repos on GitHub sees
the README's top image. A visitor to [yi-li-yang.github.io](https://yi-li-yang.github.io/)
browses project tiles and opens a project's detail panel. Both glance for a second or two, so
the image must say what the app is before they read a word. The person who runs the tool is the
repo owner, working with Claude, when an app's interface changes.

## Product Purpose

One image per app that shows what the app does and what is special about it, taken from the
real running app the same way every time. Success: a viewer understands the app from the image
alone, and an image never goes out of date without `status` saying so.

## Positioning

The real interface, not a mock-up: each image comes from the running app (with invented data
about people), so it cannot drift away from the product the way a hand-made mock-up did.

## Operating Context

- An image is seen at three sizes: the README column (about 830 px wide), the homepage detail
  panel (cropped to 16:9, about 480 px wide), and the homepage tile (a background at 38%
  opacity under the tile's text). It must still read when small and cropped.
- An animation plays only in the README and in the homepage detail panel, never on a tile, and
  never for a visitor who asks for reduced motion.
- The homepage is dark. GitHub shows a README on a light or a dark theme.

## Capabilities and Constraints

- Static image: 1200x750 WebP, under 250 KB. Animation: 960x600 WebP, under 3 MB.
- Data about people is always invented; public reference data may stay real. Every preview
  spec says which, and why.
- The frame is the app's real interface at a real window size: no device frames, no added
  captions, no marketing overlays.
- Each app keeps its own look; the tool never restyles an app.

## Brand Commitments

None beyond each app's own look. The tool's own words (README, messages) are plain English:
short sentences and common words.

## Evidence on Hand

The apps themselves: travel-map, Livability-Atlas, desktop-dashboard, Bookkeeping-auto, the
Octopus Agile email, and the homepage. Any data about a person in an image is invented. Never
add user numbers, testimonials or press.

## Product Principles

1. One idea per image: the thing that makes this app worth opening.
2. Readable at thumbnail size: large shapes and strong contrast before small text.
3. The real interface, never a mock-up.
4. No real data about a person, ever.
5. The same frame every time, so a change in the image means a change in the app.

## Accessibility & Inclusion

- The README image has alt text that names the app and says what the image shows.
- An animation is short (a few seconds), loops calmly, and never flashes more than three times
  a second.
- On the homepage, the animation respects reduced motion, and the static image carries the
  meaning alone.
