// The theme a client edits: documentation/theme/theme.css is published as assets/theme/theme.css,
// loaded after the site's own styles, with any images or fonts beside it. Without one, the site
// ships this template, which names every token.
export const THEME_TEMPLATE = `/* Theme for this documentation site.
   Copy this file to documentation/theme/theme.css in the workspace and change what you need.
   Images and fonts in documentation/theme/ are published beside it: refer to them by name.
   Any rule here overrides the site's own styles. */

:root {
  /* Brand: links, the current page, highlights, the icons on the site map. */
  /* --brand: #0C66E4; */
  /* --brandL: #E9F2FF;         light tint of the brand colour, for backgrounds */

  /* Type. Load a web font with @font-face from a file in this folder. */
  /* --font: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; */
  /* --font-heading: var(--font); */

  /* Shape and size. */
  /* --radius: 8px;             corners of cards, menu items and boxes */
  /* --width: 980px;            width of the page text */

  /* Header and menu. */
  /* --header-bg: #FFFFFF; */
  /* --header-ink: #172B4D; */
  /* --side-bg: #FFFFFF;        the sidebar */
  /* --rail-bg: #FFFFFF;        the icon rail */

  /* Text and surfaces. */
  /* --ink: #172B4D;  --ink2: #44546F;  --mute: #626F86;  --line: #DCDFE4; */
  /* --bg: #FFFFFF;   --panel: #F7F8F9; */
}

/* Dark mode: the same tokens inside this block. */
/* @media (prefers-color-scheme: dark) { :root { --brand: #579DFF; --header-bg: #1D2125; } } */

/* Logo: put logo.svg (or .png) in documentation/theme/ and uncomment. */
/* .logo { display: inline-block; background-image: url(logo.svg); --logo-w: 120px; } */
`;
